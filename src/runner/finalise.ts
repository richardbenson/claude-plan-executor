import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readMeta, updateMeta, getLogsDir } from '../storage/meta.js';
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

  const { plan_folder: planFolder = '', worktree_path: worktreePath } = meta;

  // Step 2 — inject plan folder into summarise prompt and write to temp file
  const prompt = SUMMARISE_PROMPT.replace(/PLAN_FOLDER/g, planFolder);
  const tmpFile = path.join(os.tmpdir(), `cpe-summarise-${runId}.md`);
  fs.writeFileSync(tmpFile, prompt);

  // Step 3 — spawn headless claude -p, capturing output to a log file
  const logPath = path.join(getLogsDir(runId), 'finalise.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'w');
  const proc = Bun.spawn(['claude', '-p', '--dangerously-skip-permissions'], {
    cwd: worktreePath,
    stdin: fs.openSync(tmpFile, 'r'),
    stdout: logFd,
    stderr: logFd,
  });
  const exitCode = await proc.exited;
  try { fs.closeSync(logFd); } catch { /* ignore */ }
  if (exitCode !== 0) {
    bus.emit({
      kind: 'error',
      timestamp: new Date(),
      runId,
      phaseNumber: -1,
      message: `claude -p exited ${exitCode} — see ${logPath}`,
    });
  }

  // Step 4 — delete temp file
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

  // Step 5 — verify outputs
  const summaryFile = path.join(worktreePath, 'docs', planFolder + '.md');
  const planDir = path.join(worktreePath, 'docs', planFolder);
  if (!fs.existsSync(summaryFile)) {
    bus.emit({
      kind: 'error',
      timestamp: new Date(),
      runId,
      phaseNumber: -1,
      message: `expected summary ${summaryFile} not found`,
    });
  }
  if (fs.existsSync(planDir)) {
    bus.emit({
      kind: 'error',
      timestamp: new Date(),
      runId,
      phaseNumber: -1,
      message: `plan folder ${planDir} still exists`,
    });
  }

  // Step 6 — commit
  const addProc = Bun.spawnSync(['git', 'add', '-A'], { cwd: worktreePath });
  if (addProc.exitCode !== 0) {
    bus.emit({
      kind: 'error',
      timestamp: new Date(),
      runId,
      phaseNumber: -1,
      message: `git add failed: ${addProc.stderr.toString().trim()}`,
    });
  }
  const commitProc = Bun.spawnSync(
    ['git', 'commit', '-m', `docs: summarise ${planFolder}`],
    { cwd: worktreePath },
  );
  if (commitProc.exitCode !== 0) {
    bus.emit({
      kind: 'error',
      timestamp: new Date(),
      runId,
      phaseNumber: -1,
      message: `git commit failed: ${commitProc.stderr.toString().trim()}`,
    });
  }

  // Step 7 — push + PR (skip gracefully if no remote configured)
  if (!meta.remote) {
    updateMeta(runId, { status: 'complete' });
    bus.emit({
      kind: 'ok',
      timestamp: new Date(),
      runId,
      phaseNumber: -1,
      summary: 'run complete (no remote — skipped push/PR)',
      costUsd: meta.total_cost_usd,
    });
    return { prUrl: '' };
  }

  const pushProc = Bun.spawnSync(
    ['git', 'push', '-u', 'origin', meta.feature_branch],
    { cwd: worktreePath },
  );
  if (pushProc.exitCode !== 0) {
    throw new Error(`git push failed: ${pushProc.stderr.toString().trim()}`);
  }

  // Step 8 — detect VCS and create PR
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

  // Step 10 — emit event
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
