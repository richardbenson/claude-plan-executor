import * as fs from 'fs';
import * as path from 'path';
import { groupWrap, killTree } from '../runner/proc-tree.js';
import type { Harness, HarnessContext, HarnessResult, HarnessOutcome } from './types.js';
import { headSha, runChanged } from './git-changes.js';

/*
 * aider adapter — OPAQUE completion mode.
 *
 * Docs / CLI (aider 0.86.2, verified locally against gemma4-cpe:31b):
 *   aider --message "<prompt>"          single headless instruction, then exit
 *     --model openai/<model>            model selection (LiteLLM provider/model)
 *     --edit-format whole|diff|udiff    how the model returns edits (see below)
 *     --yes-always                      auto-confirm every prompt (required headless)
 *     --no-pretty                       plain output (no live ANSI/markdown repaint)
 *     --no-fancy-input --no-check-update --no-analytics --no-show-model-warnings
 *   We deliberately leave STREAMING ON (no --no-stream): aider then writes the
 *   model response incrementally to stdout, which the bench dispatch's output
 *   tail (startOutputTail) surfaces line-by-line to the live TUI AND feeds to the
 *   activity-based timeout — so a slow-but-progressing run shows progress and
 *   isn't mistaken for idle. `--no-pretty` keeps that stream as clean plain text
 *   (pretty mode repaints with cursor/ANSI codes, which pollute the transcript).
 *   Local model wiring: aider goes through LiteLLM. The most generic route (and
 *   the one that matches the opencode adapter) is OpenAI-compatible: select
 *   `openai/<model>` and point OPENAI_API_BASE at the endpoint's /v1, with
 *   OPENAI_API_KEY for auth (Ollama ignores it, but LiteLLM requires one to be
 *   set). We translate cpe's provider env (ANTHROPIC_BASE_URL/_AUTH_TOKEN) into
 *   those OpenAI_* vars and strip ANTHROPIC_* so aider can't inherit cpe's own
 *   Anthropic credentials.
 *
 * Edit format: aider's selectable strategy for how the model expresses changes.
 *   - `whole`: rewrite entire files (sidesteps exact-`oldString` matching);
 *   - `diff` / `udiff`: search/replace or unified-diff hunks.
 *   This is the most interesting single variable in the matrix: `whole` is the
 *   hypothesis test for rescuing the fast MoE that failed opencode's exact-match
 *   edits. The contract has no per-harness option slot, so the format is read
 *   from CPE_AIDER_EDIT_FORMAT (default `whole`) and validated.
 *
 * Completion mode: OPAQUE. `aider --message` prints human-readable progress
 * ("Tokens: N sent, M received", "Applied edit to X", "Commit <sha> <msg>") and
 * AUTO-COMMITS its changes — there is no machine-readable result envelope. We
 * therefore derive the outcome from the exit code plus whether the run produced
 * any change in the clone:
 *   exit 0 + changes  => 'completed'
 *   exit 0 + no change => 'no-op'
 *   non-zero exit     => 'error'
 * (timeout / bail are owned by the dispatch's RunGuard, not the adapter.)
 *
 * Because aider auto-commits, "changes" is detected from commits (HEAD moved
 * since entry) OR an unexpectedly dirty tree — NOT `git status --porcelain`
 * alone (which is clean right after an auto-commit). The Phase-04 capture diffs
 * the index against the clone's base ref, so committed changes are captured
 * correctly without any double-commit here.
 *
 * Isolation note: aider writes `.aider.chat.history.md`, `.aider.input.history`
 * and a `.aider.tags.cache.*` dir into the repo. We keep them out of the
 * captured diff WITHOUT a committed change: a `.aider*` line is added to the
 * clone's `.git/info/exclude` (local-only, never committed, honoured by
 * `git add -A`), and `--no-gitignore` stops aider touching the tracked
 * `.gitignore`. This matters for the outcome too: if aider managed `.gitignore`
 * it would auto-commit that housekeeping line, moving HEAD and falsely reporting
 * 'completed' even when the model produced no real edit. With the local exclude,
 * HEAD only advances on a genuine task commit, so 'completed' vs 'no-op' is honest.
 */

export type AiderEditFormat = 'whole' | 'diff' | 'udiff';
const DEFAULT_EDIT_FORMAT: AiderEditFormat = 'whole';

/** Read + validate the edit format from the environment (default `whole`). */
export function editFormatFromEnv(env: Record<string, string | undefined> = process.env): AiderEditFormat {
  const raw = (env['CPE_AIDER_EDIT_FORMAT'] ?? '').trim().toLowerCase();
  return raw === 'diff' || raw === 'udiff' || raw === 'whole' ? raw : DEFAULT_EDIT_FORMAT;
}

/** Strip cpe's ANTHROPIC_* keys so aider never inherits them (it uses OpenAI_* vars). */
function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('ANTHROPIC_')) continue;
    out[k] = v;
  }
  return out;
}

/** Derive the OpenAI-compatible base URL (…/v1) for aider from cpe's provider env. */
export function openAiBaseFrom(providerEnv: Record<string, string>): string | null {
  const base = providerEnv['ANTHROPIC_BASE_URL'];
  if (!base) return null;
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/**
 * Opaque-mode outcome: exit 0 + changes => completed; exit 0 + no change => no-op;
 * any non-zero exit => error. (timeout/bail are owned by the dispatch guard.)
 */
export function deriveAiderOutcome(exitCode: number, changed: boolean): HarnessOutcome {
  return exitCode === 0 ? (changed ? 'completed' : 'no-op') : 'error';
}

/** Parse a number that may carry a `k` suffix (aider prints e.g. "1.2k sent"). */
function parseTokenNum(s: string): number {
  const t = s.trim().toLowerCase().replace(/,/g, '');
  if (t.endsWith('k')) return Math.round(parseFloat(t.slice(0, -1)) * 1000);
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Best-effort token/cost extraction from aider's plain output. aider prints a
 * per-message tally like `Tokens: 788 sent, 142 received.` and, for priced
 * models, `Cost: $0.0012 message, $0.0034 session.`. We take the LAST tally
 * (the final/cumulative figures) and the session cost when present. Exported
 * for unit testing against captured output. Local models report no real cost.
 */
export function parseAiderUsage(text: string): {
  costUsd?: number;
  tokens?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
} {
  const result: ReturnType<typeof parseAiderUsage> = {};

  const tokenRe = /Tokens:\s*([\d.,]+k?)\s*sent,\s*([\d.,]+k?)\s*received/gi;
  let lastTok: RegExpExecArray | null = null;
  for (let m = tokenRe.exec(text); m; m = tokenRe.exec(text)) lastTok = m;
  if (lastTok) {
    result.tokens = {
      input_tokens: parseTokenNum(lastTok[1]!),
      output_tokens: parseTokenNum(lastTok[2]!),
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
  }

  const costRe = /Cost:\s*\$([\d.]+)\s*message(?:,\s*\$([\d.]+)\s*session)?/gi;
  let lastCost: RegExpExecArray | null = null;
  for (let m = costRe.exec(text); m; m = costRe.exec(text)) lastCost = m;
  if (lastCost) {
    const session = lastCost[2] !== undefined ? Number(lastCost[2]) : undefined;
    const message = Number(lastCost[1]);
    const cost = session ?? message;
    if (Number.isFinite(cost)) result.costUsd = cost;
  }

  return result;
}

function parseUsage(logPath: string): ReturnType<typeof parseAiderUsage> {
  try {
    return parseAiderUsage(fs.readFileSync(logPath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Keep aider's own dotfiles (`.aider*`) out of the captured diff WITHOUT a
 * committed `.gitignore` change: add a local-only pattern to the repo's
 * `info/exclude` (never committed, honoured by `git add -A`). Paired with
 * `--no-gitignore` so aider doesn't modify the tracked `.gitignore`. The path
 * is resolved via `git rev-parse --git-path` because in a WORKTREE `.git` is a
 * file — the old hardcoded `<cwd>/.git/info/exclude` silently failed there,
 * leaving `.aider*` untracked and (observed 2026-06-10) flipping a zero-edit
 * run to a false 'completed' via the dirty-tree check.
 */
export function excludeAiderArtifacts(cwd: string): void {
  try {
    const proc = Bun.spawnSync(['git', 'rev-parse', '--git-path', 'info/exclude'], { cwd });
    if (proc.exitCode !== 0) return;
    const rel = proc.stdout.toString().trim();
    if (!rel) return;
    const excludePath = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
    let body = '';
    try { body = fs.readFileSync(excludePath, 'utf8'); } catch { /* not created yet */ }
    if (body.split('\n').some(l => l.trim() === '.aider*')) return;
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    fs.appendFileSync(excludePath, `${body && !body.endsWith('\n') ? '\n' : ''}.aider*\n`);
  } catch {
    /* best effort */
  }
}

export const aiderHarness: Harness = {
  name: 'aider',
  completionMode: 'opaque',
  install: { bin: 'aider', url: 'https://aider.chat' },

  async run(ctx: HarnessContext): Promise<HarnessResult> {
    const prompt = ctx.prompt ?? (ctx.promptFile ? fs.readFileSync(ctx.promptFile, 'utf8') : '');
    if (!prompt.trim()) {
      throw new Error('aider harness requires a prompt (prompt or promptFile)');
    }
    if (!ctx.model) {
      throw new Error('aider harness requires a model (provider/model selection)');
    }

    // Translate cpe provider env → OpenAI-compatible vars (kept off ANTHROPIC_*).
    const env = cleanEnv();
    const baseURL = openAiBaseFrom(ctx.providerEnv);
    let modelArg: string;
    if (baseURL) {
      env['OPENAI_API_BASE'] = baseURL;
      // LiteLLM requires a key to be set even when the backend ignores it.
      env['OPENAI_API_KEY'] =
        ctx.providerEnv['ANTHROPIC_AUTH_TOKEN'] ?? ctx.providerEnv['ANTHROPIC_API_KEY'] ?? 'cpe';
      modelArg = `openai/${ctx.model}`;
    } else {
      // No base URL to translate — pass the model verbatim and rely on aider's
      // own resolution / global config (e.g. a real Anthropic/OpenAI model id).
      modelArg = ctx.model;
    }

    const editFormat = editFormatFromEnv();

    // Keep .aider* out of the captured diff via a local-only exclude (no committed
    // .gitignore change) — see the isolation note above.
    excludeAiderArtifacts(ctx.cwd);

    // Auto-commits are left ENABLED (aider's default): its commits are the source
    // of truth for the captured diff / harnesstests branch. `--yes-always` makes
    // it fully non-interactive. `--no-gitignore` stops aider committing a
    // `.gitignore` housekeeping line (the local exclude above handles isolation).
    // Streaming is left ON (no --no-stream) so the output tail can surface
    // progress live; `--no-pretty` keeps the stream as plain, tailable text.
    const args = [
      'aider',
      '--model', modelArg,
      '--edit-format', editFormat,
      '--message', prompt,
      '--yes-always',
      '--no-gitignore',
      '--no-pretty',
      '--no-fancy-input',
      '--no-check-update',
      '--no-analytics',
      '--no-show-model-warnings',
    ];
    const spawnArgs = ctx.signal ? groupWrap(args) : args;

    fs.mkdirSync(path.dirname(ctx.logPath), { recursive: true });
    const logStream = fs.createWriteStream(ctx.logPath, { flags: 'a' });

    const headBefore = headSha(ctx.cwd);

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
    const outcome = deriveAiderOutcome(exitCode, changed);

    const usage = parseUsage(ctx.logPath);
    return {
      exitCode,
      outcome,
      ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
      ...(usage.tokens ? { tokens: usage.tokens } : {}),
    };
  },
};
