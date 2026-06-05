import { runSession } from '../runner/session.js';
import type { ResolvedProvider } from '../runner/provider.js';
import type { ClaudeEnvelope } from '../runner/envelope.js';
import type { Harness, HarnessContext, HarnessResult, HarnessOutcome } from './types.js';

/**
 * Map a parsed claude envelope to a normalised harness outcome.
 *
 * `runSession` never throws on a parse failure — it returns a synthetic
 * envelope with `is_error: true` and `terminal_reason: 'parse-error'`, which we
 * map to `error` (not a crash). A clean envelope is `completed`.
 */
function outcomeFromEnvelope(envelope: ClaudeEnvelope): HarnessOutcome {
  return envelope.is_error ? 'error' : 'completed';
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
  },
};
