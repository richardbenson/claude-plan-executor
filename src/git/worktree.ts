import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

export const WORKTREE_BASE: string = path.join(
  os.homedir(),
  '.local',
  'state',
  'cpe',
  'worktrees',
);

function spawn(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(args, { cwd });
  if (proc.exitCode !== 0) {
    throw new Error(`git error (${args.join(' ')}): ${proc.stderr.toString().trim()}`);
  }
  return proc.stdout.toString().trim();
}

export function getWorktreePath(runId: string): string {
  return path.join(WORKTREE_BASE, runId);
}

export function createWorktree(
  primaryRepo: string,
  runId: string,
  branch: string,
  targetBranch: string,
): string {
  const wtPath = getWorktreePath(runId);
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  spawn(['git', 'worktree', 'add', wtPath, '-b', branch, targetBranch], primaryRepo);
  return wtPath;
}

export function renameWorktreeBranch(
  primaryRepo: string,
  oldBranch: string,
  newBranch: string,
): void {
  spawn(['git', 'branch', '-m', oldBranch, newBranch], primaryRepo);
}

export function moveWorktree(
  primaryRepo: string,
  oldPath: string,
  newPath: string,
): void {
  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  spawn(['git', 'worktree', 'move', oldPath, newPath], primaryRepo);
}

export function removeWorktree(
  primaryRepo: string,
  worktreePath: string,
  force?: boolean,
): void {
  const args = ['git', 'worktree', 'remove'];
  if (force) args.push('--force');
  args.push(worktreePath);
  spawn(args, primaryRepo);
}

export function deleteBranch(primaryRepo: string, branch: string): void {
  spawn(['git', 'branch', '-D', branch], primaryRepo);
}

export function parseWorktreePorcelain(output: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  const blocks = output.trim().split(/\n\n+/);

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.trim().split('\n');

    let wtPath = '';
    let head = '';
    let branch = '';
    let bare = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        wtPath = line.slice('worktree '.length);
      } else if (line.startsWith('HEAD ')) {
        head = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        branch = line.slice('branch refs/heads/'.length);
      } else if (line === 'bare') {
        bare = true;
      }
    }

    if (wtPath) {
      worktrees.push({ path: wtPath, branch, head, bare });
    }
  }

  return worktrees;
}

export function listWorktrees(primaryRepo: string): WorktreeInfo[] {
  const output = spawn(['git', 'worktree', 'list', '--porcelain'], primaryRepo);
  const all = parseWorktreePorcelain(output);
  return all.filter(wt => wt.path !== primaryRepo);
}

export function reconcileWorktrees(
  primaryRepo: string,
  knownRuns: { id: string; worktreePath: string }[],
): { orphaned: WorktreeInfo[]; missing: string[] } {
  const worktrees = listWorktrees(primaryRepo);
  const wtPathSet = new Set(worktrees.map(wt => wt.path));
  const knownPaths = new Set(knownRuns.map(r => r.worktreePath));

  const orphaned = worktrees.filter(wt => {
    if (!wt.path.startsWith(WORKTREE_BASE)) return false;
    return !knownPaths.has(wt.path);
  });

  const missing = knownRuns
    .filter(r => !wtPathSet.has(r.worktreePath))
    .map(r => r.id);

  return { orphaned, missing };
}
