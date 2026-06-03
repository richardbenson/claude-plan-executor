import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getPrimaryRepo, getCurrentBranch, getHead } from './repo.js';

/** Base dir for per-run clones, alongside the worktree convention. */
export const CLONE_BASE: string = path.join(
  os.homedir(),
  '.local',
  'state',
  'cpe',
  'clones',
);

function spawn(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(args, { cwd });
  if (proc.exitCode !== 0) {
    throw new Error(`git error (${args.join(' ')}): ${proc.stderr.toString().trim()}`);
  }
  return proc.stdout.toString().trim();
}

export interface CloneBaseline {
  /** Source repo to clone from. */
  repo: string;
  /** Branch the clone is checked out on. */
  branch: string;
}

export interface CloneResult {
  /** Absolute path to the fresh clone (use as the run cwd). */
  path: string;
  /** The commit the clone started at — diff captures against this. */
  baseRef: string;
  baseline: CloneBaseline;
}

/**
 * Resolve the baseline to clone from: by default the repo cpe was started in
 * (`getPrimaryRepo()`) at its current branch (`getCurrentBranch()`) — the exact
 * detection the plan tool uses. Both are overridable per run. Nothing is
 * hardcoded.
 */
export function resolveBaseline(override?: Partial<CloneBaseline>): CloneBaseline {
  const repo = override?.repo ?? getPrimaryRepo();
  const branch = override?.branch ?? getCurrentBranch(repo);
  return { repo, branch };
}

export function getClonePath(runId: string): string {
  return path.join(CLONE_BASE, runId);
}

/**
 * Clone `baseline.repo` at `baseline.branch` into a fresh unique dir for `runId`.
 * Uses the local repo as the clone source so it works offline. The clone is a
 * full, independent repo — an agent running `git reset --hard` (or worse) inside
 * it cannot touch the real repo.
 */
export function createClone(runId: string, override?: Partial<CloneBaseline>): CloneResult {
  const baseline = resolveBaseline(override);
  const dest = getClonePath(runId);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    throw new Error(`clone destination already exists: ${dest}`);
  }

  // --branch + --single-branch keeps it lean; the local source makes it offline.
  spawn(
    ['git', 'clone', '--quiet', '--branch', baseline.branch, '--single-branch', baseline.repo, dest],
    path.dirname(dest),
  );

  const baseRef = getHead(dest);
  return { path: dest, baseRef, baseline };
}

/**
 * Remove a clone dir. Refuses to delete anything outside CLONE_BASE as a guard
 * against a bad path wiping something important.
 */
export function removeClone(clonePath: string): void {
  const resolved = path.resolve(clonePath);
  if (!resolved.startsWith(CLONE_BASE + path.sep)) {
    throw new Error(`refusing to remove clone outside ${CLONE_BASE}: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}
