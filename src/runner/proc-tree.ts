/**
 * Process-tree control for spawned harnesses. Harnesses fork children (shells,
 * language servers, MCP servers), so killing only the direct child leaves
 * orphans — we observed multi-minute runaways. The fix: start the harness in its
 * own process group (via `setsid`) and signal the whole group.
 */

const SETSID: string | null = Bun.which('setsid');

/** True if we can place spawned processes in their own group. */
export const canGroupKill: boolean = SETSID !== null;

/**
 * Wrap an argv so the spawned process becomes its own session/process-group
 * leader (pid == pgid). If `setsid` is unavailable, returns the argv unchanged
 * and group-kill degrades to a single-process kill.
 */
export function groupWrap(args: string[]): string[] {
  return SETSID ? [SETSID, ...args] : args;
}

/**
 * Kill an entire process tree given the group-leader pid (the pid Bun.spawn
 * returns for a `groupWrap`-ed argv). Sends to the negative pid (the whole
 * group); falls back to the single pid if the group send fails.
 */
export function killTree(pid: number | undefined, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (!pid) return;
  if (SETSID) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // group may already be gone, or we're not the session leader — fall back
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    // already dead
  }
}
