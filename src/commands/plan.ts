import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ulid } from 'ulid';
import { getPrimaryRepo } from '../git/repo.js';
import {
  createWorktree,
  removeWorktree,
  deleteBranch,
  renameWorktreeBranch,
  moveWorktree,
  WORKTREE_BASE,
} from '../git/worktree.js';
import { readConfig } from '../storage/config.js';
import { getLogsDir } from '../storage/meta.js';
import { ensureRepoConfig, readRepoConfig, runBootstrap } from '../config/repo-config.js';
import { resolveProvider } from '../runner/provider.js';
import { PLANBOT_PROMPT } from '../prompts/index.js';
import { queuePlan } from './queue.js';
import { openLiveBox } from '../cli/live-box.js';
import type { LiveBox } from '../cli/live-box.js';

async function readStdinToEof(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function readOneLine(): string {
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

function listDocsFolders(worktreePath: string): Set<string> {
  const docsDir = path.join(worktreePath, 'docs');
  try {
    const entries = fs.readdirSync(docsDir, { withFileTypes: true });
    const result = new Set<string>();
    for (const entry of entries) {
      if (entry.isDirectory() && fs.existsSync(path.join(docsDir, entry.name, 'PROGRESS.md'))) {
        result.add(entry.name);
      }
    }
    return result;
  } catch {
    return new Set();
  }
}

export async function planCommand(details: string[], options?: { disableSandbox?: boolean }): Promise<void> {
  let planDetails: string;

  if (details.length === 0) {
    console.log('Enter plan details (Ctrl+D when done):');
    const input = await readStdinToEof();
    planDetails = input.trim();
    if (!planDetails) {
      console.log('No details provided. Exiting.');
      process.exit(0);
    }
  } else {
    planDetails = details.join(' ').trim();
  }

  console.log('\nSetting up planning environment...');

  let repoPath: string;
  try {
    repoPath = getPrimaryRepo();
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  const config = readConfig();
  const existingRepoConfig = readRepoConfig(repoPath);

  const effectiveProviders = existingRepoConfig?.providers ?? config.providers ?? [];
  const effectiveProviderName = existingRepoConfig?.provider_for_planning ?? config.provider_for_planning;
  const provider = await resolveProvider(effectiveProviders, 'planning', effectiveProviderName);

  const repoConfig = await ensureRepoConfig(repoPath, config.gitea_host, provider);

  const runId = ulid();
  const tempBranch = 'cpe/planning-' + Date.now();

  process.stdout.write('  creating worktree...');
  let worktreePath: string;
  try {
    worktreePath = createWorktree(repoPath, runId, tempBranch, config.target_branch ?? 'main');
    process.stdout.write(' done\n');
  } catch (err) {
    process.stdout.write('\n');
    console.error('Failed to create worktree: ' + (err as Error).message);
    process.exit(1);
  }

  const logsDir = getLogsDir(runId);
  let box: LiveBox | null = null;
  const bootstrapResult = await runBootstrap(
    worktreePath,
    repoConfig.bootstrap,
    logsDir + '/bootstrap.log',
    cmd => {
      box?.close();
      process.stdout.write(`  bootstrap: ${cmd}\n`);
      box = openLiveBox();
    },
    line => box?.addLine(line),
  );
  (box as LiveBox | null)?.close();
  if (!bootstrapResult.success) {
    const logPath = logsDir + '/bootstrap.log';
    console.error(`\nBootstrap failed: ${bootstrapResult.failedCommand} (exit ${bootstrapResult.exitCode})`);
    try {
      const lines = fs.readFileSync(logPath, 'utf8').trimEnd().split('\n');
      const tail = lines.slice(-20);
      console.error('\n--- bootstrap output (last 20 lines) ---');
      tail.forEach(l => console.error(l));
      console.error(`--- full log: ${logPath} ---\n`);
    } catch {
      console.error(`(no log output — see ${logPath})`);
    }
    removeWorktree(repoPath, worktreePath, true);
    deleteBranch(repoPath, tempBranch);
    console.error('Worktree cleaned up.');
    process.exit(1);
  }

  const docsBefore = listDocsFolders(worktreePath);

  const message = PLANBOT_PROMPT + '\n\n---\n\n' + planDetails;
  const tmpFile = os.tmpdir() + '/cpe-plan-' + runId + '.md';
  await Bun.write(tmpFile, message);

  console.log('\n🚀 Starting planning session. Claude will guide you through creating the plan.');
  console.log('   When done, exit Claude (Ctrl+D or type \'exit\').');
  process.stdout.write('\nPress Enter to start...');
  readOneLine();

  const providerEnv = provider?.env ?? {};
  const spawnEnv = Object.keys(providerEnv).length > 0
    ? { ...process.env, ...providerEnv }
    : undefined;
  const modelArgs = provider?.modelArgs ?? [];

  const proc = Bun.spawn(['claude', ...modelArgs], {
    cwd: worktreePath,
    stdin: Bun.file(tmpFile),
    stdout: 'inherit',
    stderr: 'inherit',
    ...(spawnEnv ? { env: spawnEnv } : {}),
  });
  await proc.exited;
  const exitCode = proc.exitCode;

  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

  if (exitCode !== 0) {
    console.log(
      'Claude exited with code ' + exitCode +
      '. If you hit the session limit, wait for the window to reset and re-run `cpe plan`.',
    );
  }

  const docsAfter = listDocsFolders(worktreePath);
  const newFolders = [...docsAfter].filter(f => !docsBefore.has(f));

  if (newFolders.length === 0) {
    console.log('No plan folder found in docs/. Planning cancelled.');
    removeWorktree(repoPath, worktreePath, true);
    deleteBranch(repoPath, tempBranch);
    process.exit(0);
  }

  if (newFolders.length > 1) {
    console.log('Multiple new folders found: ' + newFolders.join(', '));
    console.log('Unexpected — using the first one: ' + newFolders[0]);
  }
  const folder = newFolders[0]!;

  const featureBranch = 'feature/' + folder;
  renameWorktreeBranch(repoPath, tempBranch, featureBranch);
  const newWorktreePath = path.join(WORKTREE_BASE, folder + '-' + runId.slice(0, 8));
  moveWorktree(repoPath, worktreePath, newWorktreePath);
  worktreePath = newWorktreePath;

  console.log('\nPlan created: docs/' + folder + '/');

  process.stdout.write('Queue this plan now? [Y/n] ');
  const answer = readOneLine();
  if (answer.toLowerCase() === 'n') {
    console.log('Run `cpe queue ' + folder + '` to queue it later.');
  } else {
    await queuePlan(repoPath, folder, runId, worktreePath, config, repoConfig, options?.disableSandbox ?? false);
    console.log('Run `cpe start` to begin execution.');
  }
}
