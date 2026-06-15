import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { groupWrap, killTree } from '../runner/proc-tree.js';
import type { Harness, HarnessContext, HarnessResult, HarnessOutcome } from './types.js';
import { headSha, runChanged } from './git-changes.js';

/*
 * crush (Charmbracelet / @charmland/crush) adapter — OPAQUE completion mode.
 *
 * Install source (confirmed): https://github.com/charmbracelet/crush — the
 * `crush` CLI (verified v0.75.0). Pre-flight requires `which crush` to succeed.
 *
 * HEADLESS MODE: YES. Although crush is primarily a Bubble Tea TUI, it ships a
 * non-interactive subcommand `crush run "<prompt>"` that processes one prompt and
 * exits (verified locally against gemma4-cpe:31b — it edited a file and printed
 * "Done"). So this adapter is a normal opaque harness, NOT parked.
 *
 * CLI (verified):
 *   crush --data-dir <dir> --cwd <dir> run --quiet -m <provider/model> "<prompt>"
 *     run                         non-interactive: one prompt, then exit
 *     --quiet                     hide the spinner (clean stdout)
 *     -m provider/model           model selection (disambiguated by provider)
 *     --cwd <dir>                 project dir crush operates in
 *     --data-dir <dir>            relocate crush's per-project data dir (crush.db +
 *                                 logs). REQUIRED for isolation — by default crush
 *                                 writes a `.crush/` dir into the project cwd, which
 *                                 would pollute the captured clone diff.
 *   NOTE: `--yolo` is a root-only (non-persistent) flag and is NOT accepted by the
 *   `run` subcommand. Headless permission auto-approval is instead done via config
 *   (`permissions.allowed_tools`), which we set to crush's full built-in tool set.
 *
 * Provider/model + ISOLATION: crush is config-driven. Custom providers (Ollama,
 * LM Studio, …) are declared as `openai-compat` providers in crush.json. crush
 * resolves config from CRUSH_GLOBAL_CONFIG (a DIRECTORY containing crush.json —
 * not a file path) and global data from CRUSH_GLOBAL_DATA. To never touch the
 * user's real ~/.config/crush and to keep crush state out of the captured diff we
 * point CRUSH_GLOBAL_CONFIG + CRUSH_GLOBAL_DATA + --data-dir at a per-run temp
 * dir and materialise a crush.json there declaring an `ollama` provider:
 *   { providers: { ollama: { type: "openai-compat", base_url: "<base>/v1/",
 *       api_key: "ollama", models: [ { id: "<ctx.model>", ... } ] } },
 *     permissions: { allowed_tools: [<all built-ins>] } }
 * cpe's ANTHROPIC_BASE_URL maps to the provider base_url. We also set
 * CRUSH_DISABLE_PROVIDER_AUTO_UPDATE=1 (no startup provider-list fetch) and strip
 * ANTHROPIC_* from the spawn env so crush can't inherit cpe's own credentials.
 * The temp dir is removed after the run.
 *
 * Completion mode: OPAQUE. `crush run` prints human-readable progress (or just
 * "Done" under --quiet), not a parseable result envelope, and it does NOT
 * auto-commit — it edits the working tree directly (a created file shows as
 * `?? <file>`). Outcome is derived from the exit code plus whether the clone has
 * a non-empty git diff:
 *   exit 0 + changes  => 'completed'
 *   exit 0 + no diff  => 'no-op'
 *   non-zero exit     => 'error'
 * (timeout / bail are owned by the dispatch's RunGuard.) Token usage is summed from
 * the per-request OpenAI `usage` in crush's `--debug` HTTP log
 * (<data-dir>/logs/crush.log) — crush.db only keeps the last turn's snapshot, which
 * badly under-reports output (see parseCrushUsage). Cost is 0 for a local model, omitted.
 */

const PROVIDER_ID = 'ollama';
/** crush's full built-in tool set, allowlisted so headless runs never block on a permission prompt. */
const ALLOWED_TOOLS = ['view', 'ls', 'grep', 'glob', 'edit', 'multiedit', 'write', 'bash', 'fetch', 'download', 'sourcegraph', 'agent'];

/** Strip cpe's ANTHROPIC_* keys so crush never inherits them (it uses crush.json). */
function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('ANTHROPIC_')) continue;
    out[k] = v;
  }
  return out;
}

/** Derive crush's OpenAI-compatible base_url from cpe's provider env (always ends `/v1/`). */
export function crushBaseUrl(providerEnv: Record<string, string>): string | null {
  const base = providerEnv['ANTHROPIC_BASE_URL'];
  if (!base) return null;
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? `${trimmed}/` : `${trimmed}/v1/`;
}

/**
 * Opaque-mode outcome: exit 0 + changes => completed; exit 0 + no diff => no-op;
 * any non-zero exit => error. (timeout/bail are owned by the dispatch guard.)
 */
export function deriveCrushOutcome(exitCode: number, changed: boolean): HarnessOutcome {
  return exitCode === 0 ? (changed ? 'completed' : 'no-op') : 'error';
}

/** The crush.json declaring the `ollama` provider + headless tool permissions. */
export function buildCrushConfig(model: string, baseURL: string, apiKey: string): Record<string, unknown> {
  return {
    $schema: 'https://charm.land/crush.json',
    permissions: { allowed_tools: ALLOWED_TOOLS },
    providers: {
      [PROVIDER_ID]: {
        name: 'Ollama (cpe bench)',
        type: 'openai-compat',
        base_url: baseURL,
        api_key: apiKey,
        models: [
          { name: model, id: model, context_window: 131072, default_max_tokens: 8192 },
        ],
      },
    },
  };
}

/** The headless crush args between `crush` and the trailing prompt (for testability). */
export function crushRunArgs(model: string, cwd: string, dataDir: string): string[] {
  return [
    '--data-dir', dataDir,
    '--cwd', cwd,
    // --debug makes crush log full HTTP round-trips to <data-dir>/logs/crush.log,
    // whose response bodies carry the per-request OpenAI `usage` — the only accurate
    // token source (crush.db only keeps the LAST turn's snapshot; see parseCrushUsage).
    '--debug',
    'run',
    '--quiet',
    '-m', `${PROVIDER_ID}/${model}`,
  ];
}

/**
 * Sum crush's token usage from its `--debug` HTTP round-trip log. crush does NOT
 * persist cumulative usage anywhere usable — its crush.db `sessions` row only holds
 * the LAST turn's snapshot (e.g. completion_tokens: 6 for a multi-turn run), and the
 * `messages` table has no token columns. With `--debug` it logs each provider
 * response body, which carries the OpenAI `usage` ({prompt_tokens, completion_tokens})
 * per request; we sum those across all requests. prompt_tokens / completion_tokens
 * each appear once per response (streaming chunks log `usage: null`), so summing each
 * independently is order-agnostic and correct. Exported for unit testing against a
 * fixture log. Returns {} when the log is missing or has no usage. Cost is not in the
 * usage (local model) so costUsd is omitted.
 */
export function parseCrushUsage(logPath: string): {
  costUsd?: number;
  tokens?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
} {
  let text: string;
  try {
    text = fs.readFileSync(logPath, 'utf8');
  } catch {
    return {};
  }
  // Tolerate both escaped (\"prompt_tokens\":) and plain ("prompt_tokens":) forms.
  const sumOf = (key: string): [number, boolean] => {
    let sum = 0;
    let saw = false;
    for (const m of text.matchAll(new RegExp(`${key}\\\\?"\\s*:\\s*(\\d+)`, 'g'))) {
      sum += Number(m[1]);
      saw = true;
    }
    return [sum, saw];
  };
  const [input, sawIn] = sumOf('prompt_tokens');
  const [output, sawOut] = sumOf('completion_tokens');
  if (!sawIn && !sawOut) return {};
  return {
    tokens: {
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}

export const crushHarness: Harness = {
  name: 'crush',
  completionMode: 'opaque',
  install: { bin: 'crush', url: 'https://github.com/charmbracelet/crush' },

  async run(ctx: HarnessContext): Promise<HarnessResult> {
    const prompt = ctx.prompt ?? (ctx.promptFile ? fs.readFileSync(ctx.promptFile, 'utf8') : '');
    if (!prompt.trim()) {
      throw new Error('crush harness requires a prompt (prompt or promptFile)');
    }
    if (!ctx.model) {
      throw new Error('crush harness requires a model (provider/model selection)');
    }

    const headBefore = headSha(ctx.cwd);

    // Per-run isolated config + data dir so the user's real ~/.config/crush is
    // never touched and no crush state lands in the captured clone diff.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-crush-'));
    const dataDir = path.join(root, 'datadir');
    const globalData = path.join(root, 'globaldata');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(globalData, { recursive: true });

    const baseURL = crushBaseUrl(ctx.providerEnv);
    if (baseURL) {
      const apiKey = ctx.providerEnv['ANTHROPIC_AUTH_TOKEN'] ?? ctx.providerEnv['ANTHROPIC_API_KEY'] ?? 'ollama';
      fs.writeFileSync(
        path.join(root, 'crush.json'),
        JSON.stringify(buildCrushConfig(ctx.model, baseURL, apiKey), null, 2),
      );
    }

    const env = cleanEnv();
    env['CRUSH_GLOBAL_CONFIG'] = root; // directory containing crush.json
    env['CRUSH_GLOBAL_DATA'] = globalData;
    env['CRUSH_DISABLE_PROVIDER_AUTO_UPDATE'] = '1';

    const args = ['crush', ...crushRunArgs(ctx.model, ctx.cwd, dataDir), prompt];
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

    const changed = runChanged(ctx.cwd, headBefore);
    const outcome = deriveCrushOutcome(exitCode, changed);

    // Read usage from the --debug HTTP log BEFORE removing the temp dir.
    const usage = parseCrushUsage(path.join(dataDir, 'logs', 'crush.log'));
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }

    return {
      exitCode,
      outcome,
      ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
      ...(usage.tokens ? { tokens: usage.tokens } : {}),
    };
  },
};
