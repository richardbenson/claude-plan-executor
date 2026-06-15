import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { groupWrap, killTree } from '../runner/proc-tree.js';
import type { Harness, HarnessContext, HarnessResult, HarnessOutcome } from './types.js';
import { headSha, runChanged } from './git-changes.js';

/*
 * opencode adapter — OPAQUE completion mode.
 *
 * Docs / CLI (opencode 1.15.13, verified locally):
 *   opencode run [message..]            headless run; exits when done
 *     -m, --model provider/model        model selection in `provider/model` form
 *     --format default|json             `json` streams raw JSON events to stdout
 *     --dangerously-skip-permissions    auto-approve tool use (required headless)
 *     --print-logs / --log-level        diagnostics to stderr
 * Model wiring: opencode does NOT read ANTHROPIC_*; it uses its own provider
 * registry (an OpenAI-compatible provider for Ollama). We therefore translate
 * cpe's provider env (ANTHROPIC_BASE_URL) into a temporary opencode config
 * (an `@ai-sdk/openai-compatible` provider named `cpe-local`) pointed at the
 * Ollama OpenAI endpoint (<base>/v1), and select `--model cpe-local/<model>`.
 * The config is materialised to a temp file referenced via `OPENCODE_CONFIG`
 * (verified honoured) so it never lands in the clone's captured diff. We spawn
 * with ANTHROPIC_* stripped from the environment so opencode can't accidentally
 * inherit cpe's own credentials.
 *
 * Completion mode: OPAQUE. `opencode run` does not emit a single parseable
 * result envelope like claude's; with --format json it streams a sequence of
 * event objects (and exits 0 on success). We therefore derive the outcome from
 * the exit code plus whether the clone has a non-empty git diff:
 *   exit 0 + changes  => 'completed'
 *   exit 0 + no diff  => 'no-op'
 *   non-zero exit     => 'error'
 * (timeout / bail are owned by the dispatch's RunGuard, not the adapter.) Token
 * and cost figures are populated only if the JSON event stream actually reports
 * them; otherwise they are omitted.
 */

const PROVIDER_ID = 'cpe-local';

/** Strip cpe's ANTHROPIC_* keys so opencode never inherits them (it uses its own config). */
function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('ANTHROPIC_')) continue;
    out[k] = v;
  }
  return out;
}

/** Derive the OpenAI-compatible base URL for opencode from cpe's provider env. */
export function openAiBaseFrom(providerEnv: Record<string, string>): string | null {
  const base = providerEnv['ANTHROPIC_BASE_URL'];
  if (!base) return null;
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/**
 * Opaque-mode outcome: exit 0 + changes => completed; exit 0 + no diff => no-op;
 * any non-zero exit => error. (timeout/bail are owned by the dispatch guard.)
 */
export function deriveOpencodeOutcome(exitCode: number, changed: boolean): HarnessOutcome {
  return exitCode === 0 ? (changed ? 'completed' : 'no-op') : 'error';
}

/**
 * Write a temporary opencode config defining the `cpe-local` provider for the
 * given model + base URL. Returns the config path, or null when no base URL is
 * derivable (caller then passes the model verbatim and relies on global config).
 */
function materialiseConfig(model: string, baseURL: string, authToken?: string): string {
  const cfg = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      [PROVIDER_ID]: {
        npm: '@ai-sdk/openai-compatible',
        name: 'cpe local (bench)',
        options: {
          baseURL,
          ...(authToken ? { apiKey: authToken } : {}),
        },
        models: { [model]: { name: model } },
      },
    },
  };
  const file = path.join(os.tmpdir(), `cpe-opencode-${crypto.randomUUID()}.json`);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}

/**
 * Best-effort token/cost extraction from opencode's `--format json` stream.
 * Each `step_finish` event carries `part.cost` (number) and `part.tokens`
 * ({ input, output, reasoning, cache:{read,write} }). We sum across steps so a
 * multi-turn run reports its total. Exported for unit testing against captured
 * event lines.
 */
export function parseOpencodeUsage(text: string): { costUsd?: number; tokens?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } } {
  let cost = 0;
  let sawCost = false;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let sawTokens = false;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(t) as Record<string, unknown>; } catch { continue; }
    if (obj['type'] !== 'step_finish') continue;
    const part = obj['part'] as Record<string, unknown> | undefined;
    if (!part) continue;
    if (typeof part['cost'] === 'number') { cost += part['cost'] as number; sawCost = true; }
    const tok = part['tokens'] as Record<string, unknown> | undefined;
    if (tok) {
      sawTokens = true;
      if (typeof tok['input'] === 'number') input += tok['input'] as number;
      if (typeof tok['output'] === 'number') output += tok['output'] as number;
      const cache = tok['cache'] as Record<string, unknown> | undefined;
      if (cache && typeof cache['read'] === 'number') cacheRead += cache['read'] as number;
    }
  }
  const result: ReturnType<typeof parseOpencodeUsage> = {};
  if (sawCost) result.costUsd = cost;
  if (sawTokens) {
    result.tokens = {
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: 0,
    };
  }
  return result;
}

function parseUsage(logPath: string): ReturnType<typeof parseOpencodeUsage> {
  try {
    return parseOpencodeUsage(fs.readFileSync(logPath, 'utf8'));
  } catch {
    return {};
  }
}

export const opencodeHarness: Harness = {
  name: 'opencode',
  completionMode: 'opaque',
  install: { bin: 'opencode', url: 'https://opencode.ai' },

  async run(ctx: HarnessContext): Promise<HarnessResult> {
    const prompt = ctx.prompt ?? (ctx.promptFile ? fs.readFileSync(ctx.promptFile, 'utf8') : '');
    if (!prompt.trim()) {
      throw new Error('opencode harness requires a prompt (prompt or promptFile)');
    }
    if (!ctx.model) {
      throw new Error('opencode harness requires a model (provider/model selection)');
    }

    const headBefore = headSha(ctx.cwd);

    // Translate cpe provider env → opencode config (kept out of the clone).
    const baseURL = openAiBaseFrom(ctx.providerEnv);
    let configPath: string | null = null;
    let modelArg: string;
    if (baseURL) {
      configPath = materialiseConfig(ctx.model, baseURL, ctx.providerEnv['ANTHROPIC_AUTH_TOKEN'] ?? ctx.providerEnv['ANTHROPIC_API_KEY']);
      modelArg = `${PROVIDER_ID}/${ctx.model}`;
    } else {
      // No base URL to translate — assume the model is already a provider/model
      // selectable from opencode's global config.
      modelArg = ctx.model;
    }

    // `--dir` is REQUIRED for isolation: opencode does NOT use the spawn cwd as
    // its project root — it resolves the project itself, and for a clone whose
    // git `origin` points at the original local repo it will follow that origin
    // and edit the ORIGINAL working tree (verified: a run without --dir wrote to
    // the baseline repo, not the clone). Passing --dir <clone> pins it to the
    // clone (verified via opencode's own startup logs: `service=project
    // directory=<clone> fromDirectory`).
    const args = [
      'opencode', 'run',
      '--dir', ctx.cwd,
      '--model', modelArg,
      '--format', 'json',
      '--dangerously-skip-permissions',
      prompt,
    ];
    const spawnArgs = ctx.signal ? groupWrap(args) : args;

    fs.mkdirSync(path.dirname(ctx.logPath), { recursive: true });
    const logStream = fs.createWriteStream(ctx.logPath, { flags: 'a' });

    const env = cleanEnv();
    if (configPath) env['OPENCODE_CONFIG'] = configPath;

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

    // Stream both stdout (json events) and stderr to the log for the live tail
    // and transcript capture.
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
    if (configPath) { try { fs.unlinkSync(configPath); } catch { /* ignore */ } }

    const changed = runChanged(ctx.cwd, headBefore);
    const outcome = deriveOpencodeOutcome(exitCode, changed);

    const usage = parseUsage(ctx.logPath);
    return {
      exitCode,
      outcome,
      ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
      ...(usage.tokens ? { tokens: usage.tokens } : {}),
    };
  },
};
