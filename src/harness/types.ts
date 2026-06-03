import type { TokenUsage } from '../types/meta.js';
import type { ClaudeEnvelope } from '../runner/envelope.js';

/**
 * Completion mode of a harness adapter.
 * - `structured`: the harness emits a parseable JSON envelope (claude-style) that
 *   carries the outcome, tokens and cost directly.
 * - `opaque`: the harness gives no machine-readable result; outcome is derived
 *   from the process exit code and the git diff it produced.
 */
export type CompletionMode = 'structured' | 'opaque';

/** Normalised outcome of a single harness invocation. */
export type HarnessOutcome = 'completed' | 'error' | 'timeout' | 'no-op';

/**
 * Everything a harness adapter needs to run one invocation. Either `prompt`
 * (inline text) or `promptFile` (a path) is supplied; structured adapters that
 * shell out to a CLI generally prefer `promptFile`.
 */
export interface HarnessContext {
  /** Working directory the harness runs in (a clone or worktree). */
  cwd: string;
  /** Inline prompt text. Mutually exclusive with `promptFile`. */
  prompt?: string;
  /** Path to a file holding the prompt. Mutually exclusive with `prompt`. */
  promptFile?: string;
  /** Model identifier to run, when the harness/provider supports selection. */
  model?: string;
  /**
   * Pre-resolved CLI model args (e.g. `['--model', 'sonnet']`) derived from the
   * provider config. When present, structured adapters pass these through
   * verbatim; this preserves the existing provider-driven model selection. Takes
   * precedence over `model` for the claude-code adapter.
   */
  modelArgs?: string[];
  /** Provider env vars to inject into the spawned process (e.g. ANTHROPIC_BASE_URL). */
  providerEnv: Record<string, string>;
  /** Whether to pass `--dangerously-skip-permissions` to the harness CLI. */
  dangerouslySkipPermissions?: boolean;
  /** Stable session identifier for this invocation. */
  sessionId: string;
  /** Path the harness should append its raw output / logs to. */
  logPath: string;
  /** Optional hard timeout in milliseconds. */
  timeoutMs?: number;
  /** JSON schema string for structured-mode adapters. */
  schema?: string;
  /**
   * Abort signal for activity-timeout / manual bail. When it fires, the adapter
   * must kill the whole harness process tree. Optional — non-bench runs omit it.
   */
  signal?: AbortSignal;
}

/**
 * Normalised result of a single harness invocation. `envelope`, `tokens`,
 * `costUsd` and `summary` are populated by structured adapters and omitted by
 * opaque ones.
 */
export interface HarnessResult {
  exitCode: number;
  outcome: HarnessOutcome;
  envelope?: ClaudeEnvelope;
  tokens?: TokenUsage;
  costUsd?: number;
  summary?: string;
}

/**
 * The adapter contract. Each harness (claude-code, opencode, aider, …) knows
 * its headless invocation, model wiring and completion mode, and runs a single
 * invocation via `run`.
 */
export interface Harness {
  name: string;
  completionMode: CompletionMode;
  run(ctx: HarnessContext): Promise<HarnessResult>;
}
