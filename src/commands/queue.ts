import * as fs from 'fs';
import * as path from 'path';
import { ulid } from 'ulid';
import { getPrimaryRepo, getRemote } from '../git/repo.js';
import { createWorktree } from '../git/worktree.js';
import { readConfig } from '../storage/config.js';
import { writeMeta, updateMeta, getLogsDir, extractPhaseTitle } from '../storage/meta.js';
import { enqueue } from '../storage/queue.js';
import { ensureRepoConfig, runBootstrap } from '../config/repo-config.js';
import { openLiveBox } from '../cli/live-box.js';
import type { LiveBox } from '../cli/live-box.js';
import { buildSandboxSettings, injectSandboxSettings } from '../runner/sandbox.js';
import type { AppConfig } from '../types/meta.js';
import type { RepoConfig } from '../config/repo-config.js';

function readLine(): string {
  const buf = Buffer.alloc(1024);
  let total = 0;
  while (true) {
    const n = fs.readSync(0, buf, total, 1, null);
    if (n === 0) break;
    if (buf[total] === 0x0a) break;
    total += n;
  }
  return buf.slice(0, total).toString('utf8').trim();
}

export function findPlanFolders(repoPath: string): string[] {
  const docsDir = path.join(repoPath, 'docs');
  try {
    const entries = fs.readdirSync(docsDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(name => fs.existsSync(path.join(docsDir, name, 'PROGRESS.md')));
  } catch {
    return [];
  }
}

export function countPhaseFiles(dir: string): number {
  try {
    return fs
      .readdirSync(dir)
      .filter(f => /^PHASE_\d+\.prompt\.md$/.test(f)).length;
  } catch {
    return 0;
  }
}

export function sortedPhaseFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter(f => /^PHASE_\d+\.prompt\.md$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/PHASE_(\d+)/)![1]!, 10);
      const numB = parseInt(b.match(/PHASE_(\d+)/)![1]!, 10);
      return numA - numB;
    });
}

export async function queuePlan(
  repoPath: string,
  folder: string,
  runId: string,
  worktreePath: string,
  config: AppConfig,
  repoConfig: RepoConfig,
  noSandbox: boolean = false,
): Promise<void> {
  const logPath = path.join(getLogsDir(runId), 'bootstrap.log');
  let box: LiveBox | null = null;
  const bootstrapResult = await runBootstrap(
    worktreePath,
    repoConfig.bootstrap,
    logPath,
    cmd => {
      box?.close();
      process.stdout.write(`  bootstrap: ${cmd}\n`);
      box = openLiveBox();
    },
    line => box?.addLine(line),
  );
  (box as LiveBox | null)?.close();
  if (!bootstrapResult.success) {
    console.error(
      `Bootstrap failed: ${bootstrapResult.failedCommand} (exit ${bootstrapResult.exitCode})`,
    );
    console.error(`Run logs at: ${getLogsDir(runId)}/bootstrap.log`);
    try {
      updateMeta(runId, { status: 'failed' });
    } catch {
      // meta may not exist yet
    }
    process.exit(1);
  }

  const planDir = path.join(worktreePath, 'docs', folder);
  const phaseFiles = sortedPhaseFiles(planDir);
  const phases = phaseFiles.map(f => ({
    number: parseInt(f.match(/PHASE_(\d+)/)![1]!, 10),
    prompt_file: f,
    title: extractPhaseTitle(worktreePath, folder, f),
    status: 'pending' as const,
    retry_count: 0,
  }));

  let remote;
  try {
    remote = getRemote(repoPath, config.gitea_host);
  } catch {
    remote = undefined;
  }

  const featureBranch = 'feature/' + folder;
  const targetBranch = config.target_branch ?? 'main';

  const sandboxSettings = buildSandboxSettings(config, repoConfig, noSandbox);
  const sandboxed = sandboxSettings !== null;
  if (sandboxSettings) {
    injectSandboxSettings(worktreePath, sandboxSettings);
  }

  writeMeta(runId, {
    id: runId,
    primary_repo_path: repoPath,
    worktree_path: worktreePath,
    plan_folder: folder,
    feature_branch: featureBranch,
    target_branch: targetBranch,
    remote,
    status: 'queued',
    total_cost_usd: 0,
    bootstrapped: true,
    sandboxed,
    phases,
  });

  // Commit docs folder to feature branch inside worktree
  Bun.spawnSync(['git', 'add', `docs/${folder}`], { cwd: worktreePath });
  Bun.spawnSync(['git', 'commit', '-m', `docs: plan ${folder}`], { cwd: worktreePath });

  enqueue(runId);

  console.log(`Queued: ${folder} (${phases.length} phases) — run ID ${runId.slice(0, 8)}…`);
  console.log(`Worktree: ${worktreePath}`);
  console.log("Run `cpe start` to begin execution.");
}

export async function queueCommand(folder?: string, options?: { disableSandbox?: boolean }): Promise<void> {
  let repoPath: string;
  try {
    repoPath = getPrimaryRepo();
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  const config = readConfig();
  const repoConfig = await ensureRepoConfig(repoPath, config.gitea_host);

  if (!folder) {
    const found = findPlanFolders(repoPath);
    if (found.length === 0) {
      console.log('No plans found in docs/. Run `cpe plan` to create one.');
      process.exit(0);
    }
    found.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    process.stdout.write('Pick a plan: ');
    const choice = parseInt(readLine(), 10);
    if (isNaN(choice) || choice < 1 || choice > found.length) {
      console.error('Invalid choice.');
      process.exit(1);
    }
    folder = found[choice - 1]!;
  }

  const progressFile = path.join(repoPath, 'docs', folder, 'PROGRESS.md');
  if (!fs.existsSync(progressFile)) {
    console.error(`docs/${folder}/PROGRESS.md not found.`);
    process.exit(1);
  }
  if (countPhaseFiles(path.join(repoPath, 'docs', folder)) === 0) {
    console.error(`No PHASE_*.prompt.md files found in docs/${folder}/.`);
    process.exit(1);
  }

  const runId = ulid();
  const targetBranch = config.target_branch ?? 'main';

  const branchExists = (name: string): boolean => {
    const r = Bun.spawnSync(['git', 'branch', '--list', name], { cwd: repoPath });
    return r.stdout.toString().trim().length > 0;
  };

  const baseBranch = 'feature/' + folder;
  const featureBranch = branchExists(baseBranch) ? `${baseBranch}-${runId.slice(0, 8).toLowerCase()}` : baseBranch;

  let worktreePath: string;
  try {
    worktreePath = createWorktree(repoPath, runId, featureBranch, targetBranch);
  } catch (err) {
    console.error(`Failed to create worktree: ${err}`);
    process.exit(1);
  }

  await queuePlan(repoPath, folder, runId, worktreePath, config, repoConfig, options?.disableSandbox ?? false);
}
