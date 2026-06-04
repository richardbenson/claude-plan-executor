import * as fs from 'fs';
import * as path from 'path';
import { groupWrap, killTree } from '../runner/proc-tree.js';
import type { Harness, HarnessContext, HarnessResult, HarnessOutcome } from './types.js';

/*
 * plandex adapter — OPAQUE completion mode. CLIENT/SERVER tool.
 *
 * Docs / CLI (plandex 2.2.1, installed from the GitHub release tarball — the
 * docs.plandex.ai site was down at implementation time, so the interface below
 * is taken from `plandex help --all` and `plandex <cmd> --help`):
 *   plandex new -n <name> --no-auto        start a plan rooted at the cwd project
 *   plandex tell "<prompt>" --apply --skip-commit --no-exec --skip-menu --stop
 *       --apply        write the plan's pending changes to the project files
 *       --skip-commit  leave applied changes UNCOMMITTED in the working tree
 *                      (so capture diffs them vs the clone's base ref, like the
 *                      other opaque adapters)
 *       --no-exec      do not run shell commands (bench safety)
 *       --skip-menu    no interactive menu after the reply
 *       --stop, -s     stop after a single reply (bounded, no auto-continue)
 *
 * !!! SERVER + AUTH REQUIRED (currently PARKED) !!!
 * plandex is a client/server product: the `plandex` CLI is a thin front-end that
 * talks to a plandex server, and the SERVER is what holds the model providers,
 * makes the LLM calls, and stores plan state. Verified empirically: with no
 * server/account, even `plandex new` blocks on an interactive Cloud-auth prompt
 * and (with stdin closed) errors immediately. Consequences for this adapter:
 *   - It requires a reachable, authenticated plandex server. The client points
 *     at it via PLANDEX_API_HOST (passed through from the environment if set).
 *   - The local model/endpoint (cpe's ANTHROPIC_BASE_URL → Ollama) is NOT wired
 *     by the client; it must be configured as a custom model/provider ON THE
 *     SERVER, and selected there. cpe's provider env therefore does not flow into
 *     plandex the way it does for the other adapters — a genuine impedance
 *     mismatch with cpe's provider model (see docs/harness-bench/
 *     orchestrator-notes.md).
 * Per the Phase-11 decision the server is PARKED, so this adapter is implemented
 * from the documented client interface and registered, but its end-to-end bench
 * run is DEFERRED until a server exists. `stdin: null` ensures a missing server
 * fails fast (EOF on the auth prompt) instead of hanging.
 *
 * Completion mode: OPAQUE. plandex applies changes to the working tree (it does
 * not, with --skip-commit, auto-commit), so the outcome is derived from the exit
 * code plus whether the clone has a non-empty git diff:
 *   exit 0 + changes => completed; exit 0 + no diff => no-op; non-zero => error
 * (timeout/bail owned by the dispatch guard). Tokens/cost are reported by the
 * server, not surfaced on the client stream here, so they are omitted.
 */

/** A filesystem/plan-safe name for the per-run plan. */
export function plandexPlanName(runId: string): string {
  const safe = runId.replace(/[^A-Za-z0-9_-]/g, '').slice(-12) || 'run';
  return `cpe-bench-${safe}`;
}

/** Args for `plandex new` (a fresh plan rooted at the cwd, manual autonomy). */
export function plandexNewArgs(planName: string): string[] {
  return ['plandex', 'new', '-n', planName, '--no-auto'];
}

/** Args for `plandex tell` — one bounded reply that applies changes, uncommitted, no exec. */
export function plandexTellArgs(prompt: string): string[] {
  return ['plandex', 'tell', prompt, '--apply', '--skip-commit', '--no-exec', '--skip-menu', '--stop'];
}

/** Strip cpe's ANTHROPIC_* keys so plandex never inherits them (its models are server-side). */
function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('ANTHROPIC_')) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Opaque-mode outcome: exit 0 + changes => completed; exit 0 + no diff => no-op;
 * any non-zero exit => error. (timeout/bail are owned by the dispatch guard.)
 */
export function derivePlandexOutcome(exitCode: number, changed: boolean): HarnessOutcome {
  return exitCode === 0 ? (changed ? 'completed' : 'no-op') : 'error';
}

/** True when the working tree (clone) has any change vs HEAD (plandex applies, --skip-commit). */
function hasChanges(cwd: string): boolean {
  const proc = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd });
  return proc.exitCode === 0 && proc.stdout.toString().trim().length > 0;
}

export const plandexHarness: Harness = {
  name: 'plandex',
  completionMode: 'opaque',

  async run(ctx: HarnessContext): Promise<HarnessResult> {
    const prompt = ctx.prompt ?? (ctx.promptFile ? fs.readFileSync(ctx.promptFile, 'utf8') : '');
    if (!prompt.trim()) {
      throw new Error('plandex harness requires a prompt (prompt or promptFile)');
    }
    if (!ctx.model) {
      throw new Error('plandex harness requires a model (provider/model selection)');
    }

    const env = cleanEnv();

    fs.mkdirSync(path.dirname(ctx.logPath), { recursive: true });
    const logStream = fs.createWriteStream(ctx.logPath, { flags: 'a' });

    // Run a plandex argv to completion, streaming output to the log; honour the
    // dispatch abort signal with a process-tree kill. `stdin: null` makes a
    // missing/unauthenticated server fail fast (EOF) rather than hang.
    const runStep = async (argv: string[]): Promise<number> => {
      const spawnArgs = ctx.signal ? groupWrap(argv) : argv;
      const proc = Bun.spawn(spawnArgs, {
        cwd: ctx.cwd,
        stdin: null,
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      });
      let onAbort: (() => void) | undefined;
      if (ctx.signal) {
        onAbort = () => killTree(proc.pid);
        if (ctx.signal.aborted) onAbort();
        else ctx.signal.addEventListener('abort', onAbort, { once: true });
      }
      const pumpStdout = (async () => { for await (const c of proc.stdout) logStream.write(c); })();
      const pumpStderr = (async () => { for await (const c of proc.stderr) logStream.write(c); })();
      const code = await proc.exited;
      await Promise.all([pumpStdout, pumpStderr]);
      if (ctx.signal && onAbort) ctx.signal.removeEventListener('abort', onAbort);
      return code;
    };

    // new → tell. If `new` fails (e.g. no server) we skip `tell` and report it.
    let exitCode = await runStep(plandexNewArgs(plandexPlanName(ctx.sessionId)));
    if (exitCode === 0) {
      exitCode = await runStep(plandexTellArgs(prompt));
    }

    await new Promise<void>(resolve => logStream.close(() => resolve()));

    const changed = hasChanges(ctx.cwd);
    const outcome = derivePlandexOutcome(exitCode, changed);

    return { exitCode, outcome };
  },
};
