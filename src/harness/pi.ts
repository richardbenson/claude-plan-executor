import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { groupWrap, killTree } from '../runner/proc-tree.js';
import type { Harness, HarnessContext, HarnessResult, HarnessOutcome } from './types.js';
import { headSha, runChanged } from './git-changes.js';

/*
 * pi (pi.dev / @earendil-works/pi-coding-agent) adapter — OPAQUE completion mode.
 *
 * Install source (confirmed): https://pi.dev/ — the `pi` CLI (verified v0.78.0,
 * the official binary name). Pre-flight requires `which pi` to succeed.
 *
 * Docs / CLI (verified locally against gemma4-cpe:31b; pi ships its own docs at
 * <node_modules>/@earendil-works/pi-coding-agent/docs/{providers,models}.md):
 *   pi -p [messages...]                  non-interactive: process prompt and exit
 *     --provider <name>                  provider name (we use the custom `ollama`)
 *     --model <id>                       model id (matches a models.json entry)
 *     --mode text|json|rpc               output mode (we use `json` for usage parsing)
 *     --no-session                       ephemeral run; don't persist a session file
 *     -t, --tools <list>                 comma-separated tool allowlist
 *   Built-in tools (read/bash/edit/write on by default; grep/find/ls off). In
 *   practice a run is only reliable when the editing tools are explicitly
 *   allowlisted, so we pass `-t read,write,edit,bash,grep,find,ls` — pi's full
 *   built-in tool set — so it can explore and edit deterministically.
 *
 * Provider/model + ISOLATION: pi is config-driven. Custom providers (Ollama,
 * vLLM, LM Studio, …) are declared in `$PI_CODING_AGENT_DIR/models.json`
 * (default dir ~/.pi/agent). To never touch the user's real ~/.pi and to keep
 * pi's own config/state out of the captured clone diff, we point
 * PI_CODING_AGENT_DIR (and PI_CODING_AGENT_SESSION_DIR) at a per-run temp dir and
 * materialise a models.json there declaring an `ollama` provider:
 *   { providers: { ollama: { baseUrl: "<ANTHROPIC_BASE_URL>/v1",
 *       api: "openai-completions", apiKey: <token|"ollama">,
 *       compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
 *       models: [ { id: "<ctx.model>" } ] } } }
 * cpe's provider env (ANTHROPIC_BASE_URL → the local Ollama endpoint) maps to the
 * provider baseUrl (with `/v1` appended for the OpenAI-completions API). The
 * `compat` flags are recommended for OpenAI-compatible servers like Ollama (no
 * `developer` role / `reasoning_effort`). We strip ANTHROPIC_* from the spawn env
 * so pi can't inherit cpe's own credentials, and remove the temp dir after the
 * run.
 *
 * Completion mode: OPAQUE. pi prints assistant text / JSON events, not a single
 * parseable result envelope, and it does NOT auto-commit — it edits the working
 * tree directly (verified: a created file shows as `?? <file>` in git status). So
 * the outcome is derived from the exit code plus whether the clone has a
 * non-empty git diff:
 *   exit 0 + changes  => 'completed'
 *   exit 0 + no diff  => 'no-op'
 *   non-zero exit     => 'error'
 * (timeout / bail are owned by the dispatch's RunGuard, not the adapter.) Token
 * usage is parsed best-effort from the `--mode json` stream: each assistant
 * message carries a `usage` object ({ input, output, cacheRead, cacheWrite,
 * totalTokens, cost }) tagged with a `responseId`; we dedupe by responseId and
 * sum. Cost is 0 for a local model so costUsd is omitted unless reported > 0.
 */

const PROVIDER_ID = 'ollama';
/** pi's full built-in tool set, explicitly allowlisted for deterministic edits. */
const TOOLS = 'read,write,edit,bash,grep,find,ls';

/** Strip cpe's ANTHROPIC_* keys so pi never inherits them (it uses models.json). */
function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('ANTHROPIC_')) continue;
    out[k] = v;
  }
  return out;
}

/** Derive the OpenAI-compatible base URL for pi from cpe's provider env. */
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
export function derivePiOutcome(exitCode: number, changed: boolean): HarnessOutcome {
  return exitCode === 0 ? (changed ? 'completed' : 'no-op') : 'error';
}

/** The models.json object declaring the `ollama` custom provider for one model. */
export function buildModelsJson(model: string, baseURL: string, apiKey: string): {
  providers: Record<string, unknown>;
} {
  return {
    providers: {
      [PROVIDER_ID]: {
        baseUrl: baseURL,
        api: 'openai-completions',
        apiKey,
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        models: [{ id: model }],
      },
    },
  };
}

/** The non-interactive pi invocation (without the leading `pi`/prompt for testability). */
export function piRunArgs(model: string): string[] {
  return [
    '-p',
    '--provider', PROVIDER_ID,
    '--model', model,
    '--mode', 'json',
    '--no-session',
    '-t', TOOLS,
  ];
}

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; costTotal: number };

/** Recursively collect `{usage, responseId}` pairs, deduped by responseId. */
function collectUsage(node: unknown, byId: Map<string, Usage>): void {
  if (Array.isArray(node)) {
    for (const x of node) collectUsage(x, byId);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const usage = obj['usage'] as Record<string, unknown> | undefined;
  const responseId = obj['responseId'];
  if (usage && typeof responseId === 'string') {
    const cost = usage['cost'] as Record<string, unknown> | undefined;
    byId.set(responseId, {
      input: typeof usage['input'] === 'number' ? (usage['input'] as number) : 0,
      output: typeof usage['output'] === 'number' ? (usage['output'] as number) : 0,
      cacheRead: typeof usage['cacheRead'] === 'number' ? (usage['cacheRead'] as number) : 0,
      cacheWrite: typeof usage['cacheWrite'] === 'number' ? (usage['cacheWrite'] as number) : 0,
      costTotal: cost && typeof cost['total'] === 'number' ? (cost['total'] as number) : 0,
    });
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') collectUsage(v, byId);
  }
}

/**
 * Best-effort token/cost extraction from pi's `--mode json` stream. Each assistant
 * message repeats its `usage` across message_update/message_end/turn_end/agent_end
 * events, so we key by `responseId` to count each model response exactly once, then
 * sum. Exported for unit testing against captured event lines.
 */
export function parsePiUsage(text: string): {
  costUsd?: number;
  tokens?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
} {
  const byId = new Map<string, Usage>();
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let obj: unknown;
    try { obj = JSON.parse(t); } catch { continue; }
    collectUsage(obj, byId);
  }
  if (byId.size === 0) return {};
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  for (const u of byId.values()) {
    input += u.input;
    output += u.output;
    cacheRead += u.cacheRead;
    cacheWrite += u.cacheWrite;
    cost += u.costTotal;
  }
  const result: ReturnType<typeof parsePiUsage> = {
    tokens: {
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheWrite,
    },
  };
  if (cost > 0) result.costUsd = cost;
  return result;
}

function parseUsage(logPath: string): ReturnType<typeof parsePiUsage> {
  try {
    return parsePiUsage(fs.readFileSync(logPath, 'utf8'));
  } catch {
    return {};
  }
}

export const piHarness: Harness = {
  name: 'pi',
  completionMode: 'opaque',
  install: { bin: 'pi', url: 'https://pi.dev' },

  async run(ctx: HarnessContext): Promise<HarnessResult> {
    const prompt = ctx.prompt ?? (ctx.promptFile ? fs.readFileSync(ctx.promptFile, 'utf8') : '');
    if (!prompt.trim()) {
      throw new Error('pi harness requires a prompt (prompt or promptFile)');
    }
    if (!ctx.model) {
      throw new Error('pi harness requires a model (provider/model selection)');
    }

    const headBefore = headSha(ctx.cwd);

    // Per-run isolated config/session dir so the user's real ~/.pi is never
    // touched and no pi state lands in the captured clone diff.
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-pi-'));

    const env = cleanEnv();
    env['PI_CODING_AGENT_DIR'] = agentDir;
    env['PI_CODING_AGENT_SESSION_DIR'] = path.join(agentDir, 'sessions');

    // Translate cpe provider env → a custom `ollama` provider in models.json.
    const baseURL = openAiBaseFrom(ctx.providerEnv);
    if (baseURL) {
      const apiKey = ctx.providerEnv['ANTHROPIC_AUTH_TOKEN'] ?? ctx.providerEnv['ANTHROPIC_API_KEY'] ?? 'ollama';
      fs.writeFileSync(
        path.join(agentDir, 'models.json'),
        JSON.stringify(buildModelsJson(ctx.model, baseURL, apiKey), null, 2),
      );
    }

    const args = ['pi', ...piRunArgs(ctx.model), prompt];
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
    const outcome = derivePiOutcome(exitCode, changed);

    const usage = parseUsage(ctx.logPath);
    try { fs.rmSync(agentDir, { recursive: true, force: true }); } catch { /* ignore */ }

    return {
      exitCode,
      outcome,
      ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
      ...(usage.tokens ? { tokens: usage.tokens } : {}),
    };
  },
};
