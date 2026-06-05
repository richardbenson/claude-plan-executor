import { runSession } from '../runner/session.js';
import type { ResolvedProvider } from '../runner/provider.js';
import type { ClaudeEnvelope } from '../runner/envelope.js';
import type { Harness, HarnessContext, HarnessResult, HarnessOutcome } from './types.js';

/*
 * claude-code (Anthropic Claude Code) adapter — STRUCTURED completion mode.
 *
 * Install source: the `claude` CLI (Claude Code, https://docs.claude.com/en/docs/claude-code).
 * Pre-flight detection gates on `which claude` (see src/harness/detect.ts).
 *
 * THE DEFAULT / REFERENCE ADAPTER. claude-code is the default harness and the
 * only STRUCTURED one; it is the harness that drives the full
 * plan → phase → PR → summary loop. The other (opaque) adapters are run via
 * `cpe bench`. Unlike them, this adapter does NOT spawn a CLI itself: it
 * delegates to the existing `runSession` (src/runner/session.ts), so the default
 * claude path stays byte-for-byte identical to the pre-harness-contract behaviour
 * (the regression gate). Process-group spawn, timeout/abort (ctx.signal), JSONL
 * tail and envelope parsing all live in runSession/session.ts — this file only
 * adapts its inputs/outputs to the Harness contract.
 *
 * Model wiring: `ctx.modelArgs` (the provider-resolved `--model …` args) is passed
 * through verbatim, falling back to `['--model', ctx.model]`; `ctx.providerEnv`
 * (ANTHROPIC_BASE_URL/API_KEY/AUTH_TOKEN) is injected via a ResolvedProvider.
 * This preserves the provider-driven model selection used by the rest of cpe and
 * lets claude-code run a local model (e.g. Anthropic-native Ollama) at zero API
 * cost. Requires `promptFile` + `schema` (structured mode mandates a JSON schema;
 * runSession enforces it too).
 *
 * Completion mode: STRUCTURED. claude emits a single parseable result envelope
 * (parsed by src/runner/envelope.ts); the outcome comes from `envelope.is_error`
 * (clean → 'completed', error → 'error'). runSession never throws on a parse
 * failure — it returns a synthetic envelope with `is_error: true` and
 * `terminal_reason: 'parse-error'`, which maps to 'error' (not a crash). Tokens,
 * cost and the summary are taken straight from the envelope (`usage`,
 * `total_cost_usd`, `result`); downstream classification / finalise / PR consume
 * the envelope directly.
 */

/**
 * Map a parsed claude envelope to a normalised harness outcome.
 * A clean envelope is `completed`; an error envelope (incl. the synthetic
 * parse-error one runSession returns) is `error`. Exported for unit testing.
 */
export function outcomeFromEnvelope(envelope: ClaudeEnvelope): HarnessOutcome {
  return envelope.is_error ? 'error' : 'completed';
}

/**
 * Adapt a runSession result (envelope + exit code) into a HarnessResult: outcome
 * from the envelope, tokens/cost/summary lifted straight off it (summary omitted
 * when `result` is empty). Exported for unit testing without spawning claude.
 */
export function buildHarnessResult(envelope: ClaudeEnvelope, exitCode: number): HarnessResult {
  const summary = typeof envelope.result === 'string' && envelope.result.length > 0
    ? envelope.result
    : undefined;
  return {
    exitCode,
    outcome: outcomeFromEnvelope(envelope),
    envelope,
    tokens: envelope.usage,
    costUsd: envelope.total_cost_usd,
    summary,
  };
}

/**
 * Reference adapter wrapping the existing claude execution path. Structured
 * mode: delegates to `runSession` and maps `SessionResult` into a
 * `HarnessResult`. Does not change `runSession`.
 */
export const claudeCodeHarness: Harness = {
  name: 'claude-code',
  completionMode: 'structured',
  install: { bin: 'claude', url: 'https://docs.claude.com/en/docs/claude-code' },

  async run(ctx: HarnessContext): Promise<HarnessResult> {
    if (!ctx.promptFile) {
      throw new Error('claude-code harness requires promptFile');
    }
    if (!ctx.schema) {
      throw new Error('claude-code harness requires a schema (structured mode)');
    }

    const modelArgs = ctx.modelArgs ?? (ctx.model ? ['--model', ctx.model] : []);
    const provider: ResolvedProvider = {
      name: ctx.model ?? 'claude-code',
      env: ctx.providerEnv,
      modelArgs,
    };

    const { envelope, exitCode } = await runSession({
      worktreePath: ctx.cwd,
      promptFile: ctx.promptFile,
      sessionId: ctx.sessionId,
      logPath: ctx.logPath,
      schema: ctx.schema,
      dangerouslySkipPermissions: ctx.dangerouslySkipPermissions,
      provider,
      signal: ctx.signal,
    });

    return buildHarnessResult(envelope, exitCode);
  },
};
