import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { groupWrap, killTree } from '../runner/proc-tree.js';
import type { Harness, HarnessContext, HarnessResult, HarnessOutcome } from './types.js';

/*
 * codex-cli (OpenAI / `codex`) adapter — OPAQUE completion mode.
 *
 * Install source (confirmed): https://github.com/openai/codex — the `codex` CLI
 * (verified `codex-cli 0.137.0`). Pre-flight requires `which codex` to succeed.
 *
 * HEADLESS MODE: `codex exec [PROMPT]` runs non-interactively and exits (alias
 * `codex e`). Verified locally against gemma4-cpe:31b — it ran a shell tool to
 * create a file and exited 0.
 *
 * CLI (verified):
 *   codex exec --json --cd <dir> --skip-git-repo-check \
 *     --dangerously-bypass-approvals-and-sandbox -m <model> "<prompt>"
 *     exec                                   non-interactive: one prompt, then exit
 *     --json                                 emit events to stdout as JSONL
 *     --cd <dir>                             working root the agent operates in
 *     -m, --model <model>                    model selection
 *     --skip-git-repo-check                  don't refuse to run outside/inside odd git states
 *     --dangerously-bypass-approvals-and-sandbox
 *                                            skip approval prompts AND the OS sandbox. codex is
 *                                            sandbox-focused (landlock/seccomp on Linux); the bench
 *                                            already runs in a throwaway CLONE (externally isolated),
 *                                            which is exactly what this flag is documented for, and it
 *                                            sidesteps WSL landlock issues while ensuring the agent's
 *                                            edits actually land in the clone for capture.
 *   NOTE: codex reads the prompt from stdin when stdin is not a TTY; we spawn with
 *   stdin=null so the arg prompt is used and the process never blocks on stdin.
 *
 * Provider / LOCAL-MODEL wiring + ISOLATION: codex is config-driven via
 * $CODEX_HOME/config.toml (default ~/.codex). A custom OpenAI-compatible endpoint
 * is declared as a `model_provider`. IMPORTANT (codex 0.137.0): `wire_api = "chat"`
 * was REMOVED — custom providers must use `wire_api = "responses"` (the OpenAI
 * Responses API, not Chat Completions). Our Ollama (ANTHROPIC_BASE_URL) serves the
 * Responses API natively at <base>/v1/responses (verified: a POST to /v1/responses
 * returned a proper `resp_…` object), so NO Phase-03 proxy is needed — we point a
 * `responses` provider straight at <base>/v1 and select it. We never touch the
 * user's real ~/.codex: CODEX_HOME is pointed at a per-run temp dir holding the
 * generated config.toml (and codex's sessions/logs/auth), and --cd pins the working
 * root to the clone. codex writes NOTHING into the cwd except the task's own file
 * edits (verified: a run left only `?? <file>` in the clone), so the captured diff
 * stays clean. ANTHROPIC_* are stripped from the spawn env. Ollama needs no API key
 * (verified working with no auth); if cpe's provider env carries a token we expose
 * it via env_key so authed OpenAI-compatible endpoints also work. Temp dir removed
 * after the run.
 *
 * Completion mode: OPAQUE. `codex exec` prints human/JSONL progress, not a single
 * parseable result envelope, and does NOT auto-commit — it edits the working tree
 * directly (a created file shows as `?? <file>`). Outcome is derived from the exit
 * code plus whether the clone has a non-empty git diff:
 *   exit 0 + changes  => 'completed'
 *   exit 0 + no diff  => 'no-op'
 *   non-zero exit     => 'error'
 * (timeout / bail are owned by the dispatch's RunGuard.) Token usage is parsed
 * best-effort from the --json stream's terminal `turn.completed` event(s)
 * (usage:{input_tokens,output_tokens,cached_input_tokens,reasoning_output_tokens}),
 * summed across turns; cost is not reported for a local model so costUsd is omitted.
 */

const PROVIDER_ID = 'ollama-cpe';
const API_KEY_ENV = 'CODEX_PROVIDER_API_KEY';

/** Strip cpe's ANTHROPIC_* keys so codex never inherits them (it uses config.toml). */
function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('ANTHROPIC_')) continue;
    out[k] = v;
  }
  return out;
}

/** Derive the OpenAI-compatible base URL for codex from cpe's provider env (ends `/v1`). */
export function codexBaseUrl(providerEnv: Record<string, string>): string | null {
  const base = providerEnv['ANTHROPIC_BASE_URL'];
  if (!base) return null;
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/**
 * Opaque-mode outcome: exit 0 + changes => completed; exit 0 + no diff => no-op;
 * any non-zero exit => error. (timeout/bail are owned by the dispatch guard.)
 */
export function deriveCodexOutcome(exitCode: number, changed: boolean): HarnessOutcome {
  return exitCode === 0 ? (changed ? 'completed' : 'no-op') : 'error';
}

/**
 * Build the codex config.toml selecting the model and declaring an OpenAI-compatible
 * `responses` provider for the given base URL. When `withApiKey` is set, the provider
 * gets an `env_key` so an authed endpoint reads the token from the env (Ollama needs
 * none). Exported for unit testing.
 */
export function buildCodexConfig(model: string, baseURL: string, withApiKey: boolean): string {
  const lines = [
    `model = ${JSON.stringify(model)}`,
    `model_provider = ${JSON.stringify(PROVIDER_ID)}`,
    '',
    `[model_providers.${PROVIDER_ID}]`,
    `name = ${JSON.stringify('Ollama (cpe bench)')}`,
    `base_url = ${JSON.stringify(baseURL)}`,
    `wire_api = ${JSON.stringify('responses')}`,
  ];
  if (withApiKey) lines.push(`env_key = ${JSON.stringify(API_KEY_ENV)}`);
  return lines.join('\n') + '\n';
}

/** The headless codex args between `codex` and the trailing prompt (for testability). */
export function codexExecArgs(model: string, cwd: string): string[] {
  return [
    'exec',
    '--json',
    '--cd', cwd,
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    '-m', model,
  ];
}

/**
 * Best-effort token extraction from codex's `--json` (JSONL) stream. The terminal
 * `turn.completed` event of each turn carries `usage`:
 *   { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens }
 * We sum across turns (reasoning tokens fold into output) and map cached_input_tokens
 * to cache_read_input_tokens. Returns {} when no usage is present. Cost is not
 * reported for a local model, so costUsd is never set here. Exported for unit testing.
 */
export function parseCodexUsage(text: string): {
  costUsd?: number;
  tokens?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
} {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let saw = false;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{') || !t.includes('turn.completed')) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(t) as Record<string, unknown>; } catch { continue; }
    if (obj['type'] !== 'turn.completed') continue;
    const usage = obj['usage'] as Record<string, unknown> | undefined;
    if (!usage) continue;
    saw = true;
    if (typeof usage['input_tokens'] === 'number') input += usage['input_tokens'] as number;
    if (typeof usage['output_tokens'] === 'number') output += usage['output_tokens'] as number;
    if (typeof usage['reasoning_output_tokens'] === 'number') output += usage['reasoning_output_tokens'] as number;
    if (typeof usage['cached_input_tokens'] === 'number') cacheRead += usage['cached_input_tokens'] as number;
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

function parseUsage(logPath: string): ReturnType<typeof parseCodexUsage> {
  try {
    return parseCodexUsage(fs.readFileSync(logPath, 'utf8'));
  } catch {
    return {};
  }
}

/** True when the working tree (clone) has any change vs HEAD (codex doesn't auto-commit). */
function hasChanges(cwd: string): boolean {
  const proc = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd });
  return proc.exitCode === 0 && proc.stdout.toString().trim().length > 0;
}

export const codexHarness: Harness = {
  name: 'codex',
  completionMode: 'opaque',
  install: { bin: 'codex', url: 'https://github.com/openai/codex' },

  async run(ctx: HarnessContext): Promise<HarnessResult> {
    const prompt = ctx.prompt ?? (ctx.promptFile ? fs.readFileSync(ctx.promptFile, 'utf8') : '');
    if (!prompt.trim()) {
      throw new Error('codex harness requires a prompt (prompt or promptFile)');
    }
    if (!ctx.model) {
      throw new Error('codex harness requires a model (provider/model selection)');
    }

    // Per-run isolated CODEX_HOME so the user's real ~/.codex is never touched and
    // no codex state (sessions/logs/auth) lands in the captured clone diff.
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-codex-'));

    const baseURL = codexBaseUrl(ctx.providerEnv);
    const token = ctx.providerEnv['ANTHROPIC_AUTH_TOKEN'] ?? ctx.providerEnv['ANTHROPIC_API_KEY'];
    if (baseURL) {
      fs.writeFileSync(
        path.join(codexHome, 'config.toml'),
        buildCodexConfig(ctx.model, baseURL, Boolean(token)),
      );
    }

    const env = cleanEnv();
    env['CODEX_HOME'] = codexHome;
    if (baseURL && token) env[API_KEY_ENV] = token;

    const args = ['codex', ...codexExecArgs(ctx.model, ctx.cwd), prompt];
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
    const outcome = deriveCodexOutcome(exitCode, changed);

    const usage = parseUsage(ctx.logPath);
    try { fs.rmSync(codexHome, { recursive: true, force: true }); } catch { /* ignore */ }

    return {
      exitCode,
      outcome,
      ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
      ...(usage.tokens ? { tokens: usage.tokens } : {}),
    };
  },
};
