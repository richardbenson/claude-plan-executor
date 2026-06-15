/**
 * Shared run-changed detection for opaque-mode adapters.
 *
 * `git status --porcelain` alone is NOT enough to decide completed vs no-op:
 * an agent that commits its work (we ask them to) leaves a clean tree, which
 * mislabelled real completions as 'no-op' (observed across the 2026-06-10
 * bench matrix — every committing harness except aider was marked no-op while
 * the capture diff showed the task done). A run "changed" the repo when HEAD
 * moved since run entry OR the tree is dirty — the same rule aider always used.
 */

function gitOut(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(['git', ...args], { cwd });
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : '';
}

/** Current HEAD sha ('' outside a repo / before the first commit). */
export function headSha(cwd: string): string {
  return gitOut(['rev-parse', 'HEAD'], cwd);
}

/** True when the working tree has any uncommitted change (incl. untracked). */
export function treeDirty(cwd: string): boolean {
  return gitOut(['status', '--porcelain'], cwd).length > 0;
}

/** True when the run produced changes: HEAD advanced since entry, or a dirty tree. */
export function runChanged(cwd: string, headBefore: string): boolean {
  const headAfter = headSha(cwd);
  return (!!headAfter && headAfter !== headBefore) || treeDirty(cwd);
}
