import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { groupWrap, killTree } from '../runner/proc-tree.js';
import type { Harness, HarnessContext, HarnessResult, HarnessOutcome } from './types.js';

/*
 * openhands (All-Hands) adapter — OPAQUE completion mode.
 *
 * Docs / CLI (OpenHands SDK CLI v1.16.1 / `openhands` 1.14.0, verified locally
 * against gemma4-cpe:31b):
 *   openhands -t "<task>" --headless --json --override-with-envs
 *     --headless              no UI, auto-approve actions (requires -t/-f)
 *     --json                  stream JSONL event objects to stdout
 *     --override-with-envs    take LLM settings from env (LLM_API_KEY/_BASE_URL/_MODEL)
 *     --exit-without-confirmation   exit cleanly when done
 *   LLM wiring (LiteLLM under the hood): LLM_MODEL=ollama/<model>,
 *   LLM_BASE_URL=<ollama root> (cpe's ANTHROPIC_BASE_URL), LLM_API_KEY=<any>
 *   (Ollama ignores it but LiteLLM wants one set). OPENHANDS_SUPPRESS_BANNER=1
 *   silences the startup box.
 *
 * RUNTIME / WORKSPACE: despite the phase's "sandboxed runtime (Docker)"
 * expectation, the SDK v1 CLI uses a LOCAL runtime — it runs its bash/file tools
 * directly in the process CWD. Verified empirically: no Docker image/container
 * was created and the agent's file edits landed in the spawn cwd (untracked, NOT
 * auto-committed). So we simply spawn in ctx.cwd (the clone) and the changes are
 * captured there — no mount/workspace config needed.
 *
 * ISOLATION: openhands persists conversations/cache/profiles under ~/.openhands
 * (no env to relocate it, but it keys off HOME). We point HOME at a per-run temp
 * dir so nothing lands in the user's real ~/.openhands and nothing leaks into the
 * clone diff (it writes no state into the cwd). The temp HOME is removed after
 * the run. ANTHROPIC_* is stripped from the spawn env. (Verified: a run with the
 * temp HOME left the real ~/.openhands with no new conversation.)
 *
 * Completion mode: OPAQUE. The `--json` stream is a sequence of event objects,
 * not a single result envelope; outcome is derived from exit code + whether the
 * clone has a non-empty git diff (changes + exit 0 => completed; exit 0 + no diff
 * => no-op; non-zero => error; timeout/bail owned by the dispatch guard). The
 * JSONL stream is captured to the transcript as a bonus. Token usage is parsed
 * best-effort from the persisted conversation's base_state.json
 * (stats.usage_to_metrics.<component>.accumulated_token_usage, summed); cost is
 * 0 for a local model so costUsd is omitted.
 */

/** LiteLLM model id for openhands' Ollama provider. */
export function openhandsModelArg(model: string): string {
  return model.startsWith('ollama/') ? model : `ollama/${model}`;
}

/** LLM_BASE_URL for openhands from cpe's provider env (ollama root, slash-trimmed). */
export function baseUrlFrom(providerEnv: Record<string, string>): string | null {
  const base = providerEnv['ANTHROPIC_BASE_URL'];
  if (!base) return null;
  return base.replace(/\/+$/, '');
}

/** Strip cpe's ANTHROPIC_* keys so openhands never inherits them (it uses LLM_* vars). */
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
export function deriveOpenhandsOutcome(exitCode: number, changed: boolean): HarnessOutcome {
  return exitCode === 0 ? (changed ? 'completed' : 'no-op') : 'error';
}

/** True when the working tree (clone) has any change vs HEAD (openhands doesn't auto-commit). */
function hasChanges(cwd: string): boolean {
  const proc = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd });
  return proc.exitCode === 0 && proc.stdout.toString().trim().length > 0;
}

/**
 * Sum token usage from openhands' persisted conversation state under a HOME dir:
 * `<home>/.openhands/conversations/<id>/base_state.json` carries
 * `stats.usage_to_metrics.<component>.accumulated_token_usage` — we sum
 * prompt/completion/cache-read tokens across components and conversations.
 * Exported for unit testing against a fabricated state file.
 */
export function parseOpenhandsUsage(homeDir: string): {
  tokens?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
} {
  const convDir = path.join(homeDir, '.openhands', 'conversations');
  let convs: string[];
  try {
    convs = fs.readdirSync(convDir);
  } catch {
    return {};
  }
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let saw = false;
  for (const c of convs) {
    const statePath = path.join(convDir, c, 'base_state.json');
    let state: Record<string, unknown>;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const stats = state['stats'] as Record<string, unknown> | undefined;
    const u2m = stats?.['usage_to_metrics'] as Record<string, unknown> | undefined;
    if (!u2m) continue;
    for (const comp of Object.values(u2m)) {
      const a = (comp as Record<string, unknown> | null)?.['accumulated_token_usage'] as Record<string, unknown> | undefined;
      if (!a) continue;
      saw = true;
      if (typeof a['prompt_tokens'] === 'number') input += a['prompt_tokens'];
      if (typeof a['completion_tokens'] === 'number') output += a['completion_tokens'];
      if (typeof a['cache_read_tokens'] === 'number') cacheRead += a['cache_read_tokens'] as number;
    }
  }
  if (!saw) return {};
  return {
    tokens: {
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: 0,
    },
  };
}

export const openhandsHarness: Harness = {
  name: 'openhands',
  completionMode: 'opaque',

  async run(ctx: HarnessContext): Promise<HarnessResult> {
    const prompt = ctx.prompt ?? (ctx.promptFile ? fs.readFileSync(ctx.promptFile, 'utf8') : '');
    if (!prompt.trim()) {
      throw new Error('openhands harness requires a prompt (prompt or promptFile)');
    }
    if (!ctx.model) {
      throw new Error('openhands harness requires a model (provider/model selection)');
    }

    // Per-run isolated HOME so ~/.openhands state never touches the user's home
    // and never leaks into the clone diff.
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-openhands-'));

    const env = cleanEnv();
    env['HOME'] = homeDir;
    env['OPENHANDS_SUPPRESS_BANNER'] = '1';
    env['LLM_MODEL'] = openhandsModelArg(ctx.model);
    const baseUrl = baseUrlFrom(ctx.providerEnv);
    if (baseUrl) env['LLM_BASE_URL'] = baseUrl;
    env['LLM_API_KEY'] =
      ctx.providerEnv['ANTHROPIC_AUTH_TOKEN'] ?? ctx.providerEnv['ANTHROPIC_API_KEY'] ?? 'ollama';

    const args = [
      'openhands',
      '--headless',
      '--json',
      '--override-with-envs',
      '--exit-without-confirmation',
      '-t', prompt,
    ];
    const spawnArgs = ctx.signal ? groupWrap(args) : args;

    fs.mkdirSync(path.dirname(ctx.logPath), { recursive: true });
    const logStream = fs.createWriteStream(ctx.logPath, { flags: 'a' });

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

    const pumpStdout = (async () => {
      for await (const chunk of proc.stdout) logStream.write(chunk);
    })();
    const pumpStderr = (async () => {
      for await (const chunk of proc.stderr) logStream.write(chunk);
    })();

    const exitCode = await proc.exited;
    await Promise.all([pumpStdout, pumpStderr]);

    if (ctx.signal && onAbort) ctx.signal.removeEventListener('abort', onAbort);
    await new Promise<void>(resolve => logStream.close(() => resolve()));

    const changed = hasChanges(ctx.cwd);
    const outcome = deriveOpenhandsOutcome(exitCode, changed);

    // Parse usage from the isolated HOME state BEFORE removing it.
    const usage = parseOpenhandsUsage(homeDir);
    try { fs.rmSync(homeDir, { recursive: true, force: true }); } catch { /* ignore */ }

    return {
      exitCode,
      outcome,
      ...(usage.tokens ? { tokens: usage.tokens } : {}),
    };
  },
};
