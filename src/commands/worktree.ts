import * as fs from 'fs';
import * as path from 'path';
import { listAllRunIds, readMeta } from '../storage/meta.js';
import type { RunMeta } from '../types/meta.js';

function readLine(): string {
  const buf = Buffer.alloc(256);
  let total = 0;
  while (true) {
    const n = fs.readSync(0, buf, total, 1, null);
    if (n === 0) break;
    if (buf[total] === 0x0a) break;
    total += n;
  }
  return buf.slice(0, total).toString('utf8').trim();
}

function getGitRoot(): string | null {
  const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { cwd: process.cwd() });
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim();
}

const STATUS_PRIORITY: Record<string, number> = {
  executing: 0, retrying: 1, finalising: 2,
  'paused-limit': 3, paused: 4, queued: 5, pending: 6,
  'pr-created': 7, complete: 8, failed: 9, archived: 10,
};

export async function worktreeCommand(options: { all?: boolean }): Promise<void> {
  const gitRoot = getGitRoot();

  const candidates: RunMeta[] = [];
  for (const id of listAllRunIds()) {
    try {
      const meta = readMeta(id);
      if (meta.status === 'archived') continue;
      if (!fs.existsSync(meta.worktree_path)) continue;
      if (!options.all && gitRoot && meta.primary_repo_path !== gitRoot) continue;
      candidates.push(meta);
    } catch { /* skip unreadable */ }
  }

  candidates.sort((a, b) =>
    (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99),
  );

  if (candidates.length === 0) {
    const scope = (!options.all && gitRoot) ? path.basename(gitRoot) : null;
    console.log(scope ? `No worktrees found for ${scope}.` : 'No worktrees found.');
    console.log('Use --all to show worktrees for all repos.');
    return;
  }

  const repoLabel = (!options.all && gitRoot) ? ` for ${path.basename(gitRoot)}` : '';
  console.log(`\nWorktrees${repoLabel}:\n`);

  for (let i = 0; i < candidates.length; i++) {
    const meta = candidates[i]!;
    const phases = meta.phases ?? [];
    const done = phases.filter(p => p.status === 'complete' || p.status === 'pr-created').length;
    const total = phases.length;
    const progress = total > 0 ? ` ${done}/${total} phases` : '';
    const branch = meta.feature_branch ? `  ${meta.feature_branch}` : '';
    console.log(`  ${i + 1}.  ${meta.plan_folder || '(single-prompt)'}  [${meta.status}]${progress}${branch}`);
  }

  let selected: RunMeta;
  if (candidates.length === 1) {
    process.stdout.write(`\nEnter ${candidates[0]!.worktree_path}? [Y/n] `);
    const answer = readLine();
    if (answer.toLowerCase() === 'n') return;
    selected = candidates[0]!;
  } else {
    process.stdout.write(`\nSelect (1–${candidates.length}): `);
    const answer = readLine();
    const idx = parseInt(answer, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= candidates.length) {
      console.log('Invalid selection.');
      return;
    }
    selected = candidates[idx]!;
  }

  const shell = process.env['SHELL'] ?? '/bin/bash';
  console.log(`\ncd ${selected.worktree_path}`);
  console.log('Type "exit" or Ctrl-D to return.\n');

  const proc = Bun.spawn([shell], {
    cwd: selected.worktree_path,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  await proc.exited;
}
