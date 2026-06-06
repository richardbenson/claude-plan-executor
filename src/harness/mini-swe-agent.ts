import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { groupWrap, killTree } from '../runner/proc-tree.js';
import type { Harness, HarnessContext, HarnessResult, HarnessOutcome } from './types.js';

/*
 * mini-swe-agent (Princeton / SWE-agent) adapter — OPAQUE completion mode.
 *
 * Install source (confirmed): https://github.com/SWE-agent/mini-swe-agent — the
 * minimalist successor to the original SWE-agent (`pipx install mini-swe-agent`
 * → `mini` / `mini-extra`, verified `mini-swe-agent version 2.3.0`). Pre-flight
 * requires `which mini` to succeed. (The plan's Phase 15 named the original
 * `swe-agent`; per the user it has been superseded by mini-swe-agent, which is
 * what this adapter wires — registered under the name `mini-swe-agent`.)
 *
 * HEADLESS MODE: `mini` is interactive by default; the NON-interactive path is the
 * `default` agent class (DefaultAgent) which loops query→execute until the model
 * submits / a limit trips, with NO stdin prompts. The bare default (interactive)
 * agent raises EOFError under closed stdin, so we force `--agent-class default`.
 * CLI (verified against gemma4-cpe:31b):
 *   mini --agent-class default -y --exit-immediately -l 0 \
 *        -c mini.yaml -c agent.step_limit=<N> -c agent.wall_time_limit_seconds=<M> \
 *        -m ollama/<model> -t "<task>" -o <traj.json>
 *     --agent-class default        non-interactive run loop (headless)
 *     -y / --yolo                  run bash actions without confirmation
 *     --exit-immediately           don't prompt at end-of-task
 *     -l 0                         disable the $ cost limit (local model = $0)
 *     -c mini.yaml                 KEEP the builtin default config (resolved by bare
 *                                  name from the package config dir). REQUIRED: any
 *                                  `-c` drops the implicit default, so we re-add it
 *                                  before layering key=value overrides on top.
 *     -c agent.step_limit / wall_time_limit_seconds
 *                                  BACKSTOPS: with both limits at 0 a model that
 *                                  never submits loops forever. We bound calls + wall
 *                                  time; on a limit the agent exits GRACEFULLY
 *                                  (exit_status LimitsExceeded/TimeExceeded, exit 0).
 *                                  Tunable via CPE_MINI_STEP_LIMIT (default 40) and
 *                                  CPE_MINI_WALL_SECONDS (default 1800).
 *     -m ollama/<model>            LiteLLM model string (see below)
 *     -o <traj.json>               trajectory JSON (used for token accounting)
 *
 * LOCAL-MODEL wiring (LiteLLM/Ollama): mini queries models via LiteLLM. We select
 * `ollama/<ctx.model>` and point LiteLLM's Ollama provider at our endpoint with
 * OLLAMA_API_BASE = the ROOT of cpe's ANTHROPIC_BASE_URL (Ollama's native API, NOT
 * the /v1 OpenAI shim — any trailing /v1 is stripped). mini parses bash commands
 * from the chat TEXT (no native tool-calling needed), so any chat model works.
 * Local models are not in LiteLLM's cost map, which otherwise raises
 * "Cost must be > 0.0"; we set MSWEA_COST_TRACKING=ignore_errors to tolerate it.
 *
 * ISOLATION + config: mini reads/writes a global config dir (default
 * ~/.config/mini-swe-agent: .env, last-run trajectory, interactive history). We
 * relocate it via MSWEA_GLOBAL_CONFIG_DIR to a per-run temp dir (verified honoured),
 * set MSWEA_CONFIGURED=true to skip the first-run interactive setup wizard, and
 * MSWEA_SILENT_STARTUP=1 to mute the banner. The trajectory is written into that
 * temp dir and parsed before it is removed. ANTHROPIC_* are stripped from the spawn
 * env so mini can't inherit cpe's own credentials. The LocalEnvironment runs bash
 * directly in the spawn cwd (the clone) — edits land there for capture; mini writes
 * NOTHING else into the cwd (verified: a created file shows as `?? <file>`), so the
 * captured diff stays clean.
 *
 * Completion mode: OPAQUE. mini prints human progress, not a single parseable result
 * envelope, and does NOT auto-commit — it edits the working tree directly. Outcome
 * from exit code + git diff:
 *   exit 0 + changes  => 'completed'
 *   exit 0 + no diff  => 'no-op'
 *   non-zero exit     => 'error'
 * (timeout / bail are owned by the dispatch's RunGuard.) Token usage is parsed from
 * the trajectory JSON: each assistant message carries extra.response.usage
 * ({prompt_tokens, completion_tokens}); we sum across calls. Cost is 0 for a local
 * model (model_stats.instance_cost), so costUsd is omitted.
 */

const DEFAULT_STEP_LIMIT = 40;
// A non-submitting agent on a slow local model can burn the whole window producing
// nothing (observed: a 30-min no-op at 1800s); fail faster. Override via CPE_MINI_WALL_SECONDS.
const DEFAULT_WALL_SECONDS = 600;

/** Strip cpe's ANTHROPIC_* keys so mini never inherits them (it uses LiteLLM env). */
function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('ANTHROPIC_')) continue;
    out[k] = v;
  }
  return out;
}

/** LiteLLM Ollama base = the ROOT of cpe's provider URL (no trailing slash, no /v1). */
export function ollamaApiBase(providerEnv: Record<string, string>): string | null {
  const base = providerEnv['ANTHROPIC_BASE_URL'];
  if (!base) return null;
  return base.replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** The LiteLLM model string for mini: prefix `ollama/` unless already provider-qualified. */
export function miniModelArg(model: string): string {
  return model.includes('/') ? model : `ollama/${model}`;
}

/**
 * Opaque-mode outcome: exit 0 + changes => completed; exit 0 + no diff => no-op;
 * any non-zero exit => error. (timeout/bail are owned by the dispatch guard.)
 */
export function deriveMiniOutcome(exitCode: number, changed: boolean): HarnessOutcome {
  return exitCode === 0 ? (changed ? 'completed' : 'no-op') : 'error';
}

/** The headless mini args between `mini` and the trailing `-t <task>` (for testability). */
export function miniRunArgs(model: string, trajPath: string, stepLimit: number, wallSeconds: number): string[] {
  return [
    '--agent-class', 'default',
    '-y',
    '--exit-immediately',
    '-l', '0',
    '-c', 'mini.yaml',
    '-c', `agent.step_limit=${stepLimit}`,
    '-c', `agent.wall_time_limit_seconds=${wallSeconds}`,
    '-m', miniModelArg(model),
    '-o', trajPath,
  ];
}

/**
 * Best-effort token extraction from mini's trajectory JSON. Each assistant message
 * has extra.response.usage ({prompt_tokens, completion_tokens}); we sum across the
 * run. Returns {} when no usage is present. Cost is not reported for a local model
 * (instance_cost 0), so costUsd is never set. Exported for unit testing.
 */
export function parseMiniUsage(trajJson: string): {
  costUsd?: number;
  tokens?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
} {
  let data: unknown;
  try { data = JSON.parse(trajJson); } catch { return {}; }
  const messages = (data as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return {};
  let input = 0;
  let output = 0;
  let saw = false;
  for (const m of messages) {
    const usage = (m as { extra?: { response?: { usage?: Record<string, unknown> } } })?.extra?.response?.usage;
    if (!usage) continue;
    saw = true;
    if (typeof usage['prompt_tokens'] === 'number') input += usage['prompt_tokens'] as number;
    if (typeof usage['completion_tokens'] === 'number') output += usage['completion_tokens'] as number;
  }
  if (!saw) return {};
  return {
    tokens: {
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}

function parseUsage(trajPath: string): ReturnType<typeof parseMiniUsage> {
  try {
    return parseMiniUsage(fs.readFileSync(trajPath, 'utf8'));
  } catch {
    return {};
  }
}

/** True when the working tree (clone) has any change vs HEAD (mini doesn't auto-commit). */
function hasChanges(cwd: string): boolean {
  const proc = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd });
  return proc.exitCode === 0 && proc.stdout.toString().trim().length > 0;
}

export const miniSweAgentHarness: Harness = {
  name: 'mini-swe-agent',
  completionMode: 'opaque',
  install: { bin: 'mini', url: 'https://github.com/SWE-agent/mini-swe-agent' },

  async run(ctx: HarnessContext): Promise<HarnessResult> {
    const prompt = ctx.prompt ?? (ctx.promptFile ? fs.readFileSync(ctx.promptFile, 'utf8') : '');
    if (!prompt.trim()) {
      throw new Error('mini-swe-agent harness requires a prompt (prompt or promptFile)');
    }
    if (!ctx.model) {
      throw new Error('mini-swe-agent harness requires a model (provider/model selection)');
    }

    // Per-run isolated global config dir so the user's real ~/.config/mini-swe-agent
    // is never touched and no mini state lands in the captured clone diff.
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-mini-'));
    const trajPath = path.join(configDir, 'run.traj.json');

    const stepLimit = Number(process.env['CPE_MINI_STEP_LIMIT']) || DEFAULT_STEP_LIMIT;
    const wallSeconds = Number(process.env['CPE_MINI_WALL_SECONDS']) || DEFAULT_WALL_SECONDS;

    const env = cleanEnv();
    env['MSWEA_GLOBAL_CONFIG_DIR'] = configDir;
    env['MSWEA_CONFIGURED'] = 'true';
    env['MSWEA_SILENT_STARTUP'] = '1';
    env['MSWEA_COST_TRACKING'] = 'ignore_errors';
    const apiBase = ollamaApiBase(ctx.providerEnv);
    if (apiBase) env['OLLAMA_API_BASE'] = apiBase;

    const args = [
      'mini',
      ...miniRunArgs(ctx.model, trajPath, stepLimit, wallSeconds),
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
    const outcome = deriveMiniOutcome(exitCode, changed);

    // Read usage from the trajectory BEFORE removing the temp dir.
    const usage = parseUsage(trajPath);
    try { fs.rmSync(configDir, { recursive: true, force: true }); } catch { /* ignore */ }

    return {
      exitCode,
      outcome,
      ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
      ...(usage.tokens ? { tokens: usage.tokens } : {}),
    };
  },
};
