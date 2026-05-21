import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readMeta, updateMeta } from '../storage/meta.js';
import { SUMMARISE_PROMPT } from '../prompts/index.js';
import { isGitHub, isGitea } from '../vcs/detect.js';
import { createGitHubPr } from '../vcs/github.js';
import { createGiteaPr } from '../vcs/gitea.js';
import type { ActivityBus } from '../events/bus.js';

export interface FinaliseResult {
  prUrl: string;
}

export async function finaliseRun(runId: string, bus: ActivityBus): Promise<FinaliseResult> {
  // Step 1 — set status finalising
  updateMeta(runId, { status: 'finalising' });
  const meta = readMeta(runId);

  bus.emit({
    kind: 'phase',
    timestamp: new Date(),
    runId,
    phaseNumber: -1,
    phaseName: 'finalise',
  });

  const { plan_folder: planFolder, worktree_path: worktreePath } = meta;

  // Step 2 — inject plan folder into summarise prompt and write to temp file
  const prompt = SUMMARISE_PROMPT.replace(/PLAN_FOLDER/g, planFolder);
  const tmpFile = path.join(os.tmpdir(), `cpe-summarise-${runId}.md`);
  fs.writeFileSync(tmpFile, prompt);

  // Step 3 — spawn headless claude -p
  const proc = Bun.spawn(['claude', '-p', '--dangerously-skip-permissions'], {
    cwd: worktreePath,
    stdin: fs.openSync(tmpFile, 'r'),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.stderr.write(`[finalise] claude -p exited ${exitCode} — continuing anyway\n`);
  }

  // Step 4 — delete temp file
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

  // Step 5 — verify outputs
  const summaryFile = path.join(worktreePath, 'docs', planFolder + '.md');
  const planDir = path.join(worktreePath, 'docs', planFolder);
  if (!fs.existsSync(summaryFile)) {
    process.stderr.write(`[finalise] warning: expected summary ${summaryFile} not found\n`);
  }
  if (fs.existsSync(planDir)) {
    process.stderr.write(`[finalise] warning: plan folder ${planDir} still exists\n`);
  }

  // Step 6 — commit
  const addProc = Bun.spawnSync(['git', 'add', '-A'], { cwd: worktreePath });
  if (addProc.exitCode !== 0) {
    process.stderr.write(`[finalise] git add failed: ${addProc.stderr.toString().trim()}\n`);
  }
  const commitProc = Bun.spawnSync(
    ['git', 'commit', '-m', `docs: summarise ${planFolder}`],
    { cwd: worktreePath },
  );
  if (commitProc.exitCode !== 0) {
    process.stderr.write(`[finalise] git commit failed: ${commitProc.stderr.toString().trim()}\n`);
  }

  // Step 7 — push
  const pushProc = Bun.spawnSync(
    ['git', 'push', '-u', 'origin', meta.feature_branch],
    { cwd: worktreePath },
  );
  if (pushProc.exitCode !== 0) {
    throw new Error(`git push failed: ${pushProc.stderr.toString().trim()}`);
  }

  // Step 8 — detect VCS and create PR
  if (!meta.remote) {
    throw new Error('No remote configured on run meta');
  }

  let prResult: { url: string };
  if (isGitHub(meta.remote)) {
    prResult = await createGitHubPr(worktreePath, meta.feature_branch, meta.target_branch);
  } else if (isGitea(meta.remote)) {
    prResult = await createGiteaPr(worktreePath, meta.feature_branch, meta.target_branch, meta.remote);
  } else {
    throw new Error('Unsupported VCS host: ' + (meta.remote?.host ?? 'unknown'));
  }

  // Step 9 — mark pr-created
  updateMeta(runId, { status: 'pr-created' });

  // Step 10 — emit events
  bus.emit({
    kind: 'ok',
    timestamp: new Date(),
    runId,
    phaseNumber: -1,
    summary: 'PR opened: ' + prResult.url,
    costUsd: meta.total_cost_usd,
  });

  return { prUrl: prResult.url };
}
