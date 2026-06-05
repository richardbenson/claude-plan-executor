import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { groupWrap, killTree } from '../runner/proc-tree.js';
import type { Harness, HarnessContext, HarnessResult, HarnessOutcome } from './types.js';

/*
 * goose (Block) adapter — OPAQUE completion mode.
 *
 * Docs / CLI (goose 1.37.0, verified locally against gemma4-cpe:31b):
 *   goose run -t "<prompt>"             headless run from inline text, then exit
 *     --no-session                      don't create/use a session file (automated runs)
 *     --max-turns <n>                   cap agent iterations (loop backstop on weak models)
 *   File editing works out of the box: goose's built-in developer tools
 *   (`write`, text edit, shell, `todo_write`) are enabled by default — no extra
 *   MCP extension config is needed for this setup.
 *
 * Provider/model + ISOLATION: goose is configured via a global config
 * (`$XDG_CONFIG_HOME/goose/config.yaml`) plus env vars, and it persists sessions
 * ($XDG_DATA_HOME/goose) and logs ($XDG_STATE_HOME/goose). To never touch the
 * user's real goose config/state we point all four XDG base dirs at a per-run
 * temp dir and select the provider/model purely via env:
 *   GOOSE_PROVIDER=ollama
 *   GOOSE_MODEL=<ctx.model>
 *   OLLAMA_HOST=<provider base url>   (full URL; goose prepends http:// if absent)
 * cpe's ANTHROPIC_BASE_URL maps directly to OLLAMA_HOST. We strip ANTHROPIC_*
 * from the spawn env so goose can't inherit cpe's own credentials. (Verified:
 * `goose info` honours XDG_CONFIG_HOME; a run with the override wrote only to the
 * temp dirs and left the real ~/.config/goose untouched.) The temp dir is removed
 * after the run, so none of goose's state lands in the captured clone diff.
 *
 * Completion mode: OPAQUE. `goose run` prints human-readable progress + tool-call
 * traces, not a parseable result envelope. goose also does NOT auto-commit — it
 * edits files in the working tree — so the outcome is derived from the exit code
 * plus whether the clone has a non-empty git diff:
 *   exit 0 + changes  => 'completed'
 *   exit 0 + no diff  => 'no-op'
 *   non-zero exit     => 'error'
 * (timeout / bail are owned by the dispatch's RunGuard.) Token usage is parsed
 * best-effort from goose's per-request logs ($XDG_STATE_HOME/goose/logs/
 * llm_request.*.jsonl), which carry a `usage` object; cost is not reported for a
 * local model so costUsd is omitted.
 */

const DEFAULT_MAX_TURNS = 50;

/** Turn cap for `goose run` (loop backstop), overridable via CPE_GOOSE_MAX_TURNS. */
export function gooseMaxTurns(env: Record<string, string | undefined> = process.env): number {
  const raw = parseInt((env['CPE_GOOSE_MAX_TURNS'] ?? '').trim(), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_TURNS;
}

/** OLLAMA_HOST for goose from cpe's provider env (full URL, trailing slash trimmed). */
export function ollamaHostFrom(providerEnv: Record<string, string>): string | null {
  const base = providerEnv['ANTHROPIC_BASE_URL'];
  if (!base) return null;
  return base.replace(/\/+$/, '');
}

/** Strip cpe's ANTHROPIC_* keys so goose never inherits them (it uses GOOSE_ / OLLAMA_ vars). */
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
export function deriveGooseOutcome(exitCode: number, changed: boolean): HarnessOutcome {
  return exitCode === 0 ? (changed ? 'completed' : 'no-op') : 'error';
}

/** True when the working tree (clone) has any change vs HEAD (goose doesn't auto-commit). */
function hasChanges(cwd: string): boolean {
  const proc = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd });
  return proc.exitCode === 0 && proc.stdout.toString().trim().length > 0;
}

/**
 * Sum token usage from goose's per-request logs under an isolated state dir.
 * Each `<state>/goose/logs/llm_request.N.jsonl` ends with a line carrying a
 * `usage` object ({ input_tokens, output_tokens, total_tokens, cache_* }); we
 * take the last parseable line of each file and sum across requests. Exported
 * for unit testing against captured log lines.
 */
export function parseGooseUsage(stateDir: string): {
  tokens?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
} {
  const logsDir = path.join(stateDir, 'goose', 'logs');
  let files: string[];
  try {
    files = fs.readdirSync(logsDir).filter(f => /^llm_request\.\d+\.jsonl$/.test(f));
  } catch {
    return {};
  }
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let saw = false;
  for (const f of files) {
    let lines: string[];
    try {
      lines = fs.readFileSync(path.join(logsDir, f), 'utf8').split('\n').filter(l => l.trim());
    } catch {
      continue;
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      let obj: Record<string, unknown>;
      try { obj = JSON.parse(lines[i]!) as Record<string, unknown>; } catch { continue; }
      const usage = obj['usage'] as Record<string, unknown> | undefined;
      if (!usage) continue;
      saw = true;
      if (typeof usage['input_tokens'] === 'number') input += usage['input_tokens'];
      if (typeof usage['output_tokens'] === 'number') output += usage['output_tokens'];
      if (typeof usage['cache_read_input_tokens'] === 'number') cacheRead += usage['cache_read_input_tokens'] as number;
      break; // last usage-bearing line of this request only
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

export const gooseHarness: Harness = {
  name: 'goose',
  completionMode: 'opaque',
  install: { bin: 'goose', url: 'https://block.github.io/goose' },

  async run(ctx: HarnessContext): Promise<HarnessResult> {
    const prompt = ctx.prompt ?? (ctx.promptFile ? fs.readFileSync(ctx.promptFile, 'utf8') : '');
    if (!prompt.trim()) {
      throw new Error('goose harness requires a prompt (prompt or promptFile)');
    }
    if (!ctx.model) {
      throw new Error('goose harness requires a model (provider/model selection)');
    }

    // Per-run isolated config/state/cache so the user's real goose config is
    // never touched and goose state never lands in the captured clone diff.
    const xdgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-goose-'));
    const stateDir = path.join(xdgRoot, 'state');

    const env = cleanEnv();
    env['XDG_CONFIG_HOME'] = path.join(xdgRoot, 'config');
    env['XDG_DATA_HOME'] = path.join(xdgRoot, 'data');
    env['XDG_STATE_HOME'] = stateDir;
    env['XDG_CACHE_HOME'] = path.join(xdgRoot, 'cache');
    env['GOOSE_PROVIDER'] = 'ollama';
    env['GOOSE_MODEL'] = ctx.model;
    const host = ollamaHostFrom(ctx.providerEnv);
    if (host) env['OLLAMA_HOST'] = host;

    const args = [
      'goose', 'run',
      '--no-session',
      '--max-turns', String(gooseMaxTurns()),
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
    const outcome = deriveGooseOutcome(exitCode, changed);

    // Parse usage from the isolated logs BEFORE removing the temp dir.
    const usage = parseGooseUsage(stateDir);
    try { fs.rmSync(xdgRoot, { recursive: true, force: true }); } catch { /* ignore */ }

    return {
      exitCode,
      outcome,
      ...(usage.tokens ? { tokens: usage.tokens } : {}),
    };
  },
};
