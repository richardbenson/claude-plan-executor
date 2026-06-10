import type { RunStatus, PhaseStatus } from './state.js';

export interface SandboxConfig {
  enabled?: boolean;
  allowedDomains?: string[];
  allowWrite?: string[];
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/**
 * Where a run's token counts came from. 'litellm' = summed from the gateway's
 * spend logs (authoritative, wire-accurate); 'adapter' = the harness adapter's
 * own parsing (envelope / CLI log scraping — fallback).
 */
export type TokenSource = 'litellm' | 'adapter';

export interface PhaseEntry {
  number: number;
  prompt_file: string;
  title?: string;
  status: PhaseStatus;
  retry_count: number;
  head_before?: string;
  commit_sha?: string;
  started_at?: string;
  completed_at?: string;
  session_id?: string;
  cost_usd?: number;
  tokens?: TokenUsage;
  token_source?: TokenSource;
  summary?: string;
  commit_message?: string;
  notes_for_next_phase?: string;
  blockers?: string[];
}

export interface RunRemote {
  host: string;
  owner: string;
  repo: string;
  type: 'github' | 'gitea' | 'other';
}

export interface RunMeta {
  id: string;
  primary_repo_path: string;
  worktree_path: string;
  plan_folder?: string;
  feature_branch: string;
  target_branch: string;
  remote?: RunRemote;
  status: RunStatus;
  total_cost_usd: number;
  bootstrapped?: boolean;
  sandboxed?: boolean;
  skip_permissions?: boolean;
  limit_resume_at?: string;
  claude_pid?: number;
  phases?: PhaseEntry[];
  prompt?: string;
  prompt_source?: 'free-text' | 'github-issue' | 'clipboard';
  github_issue_number?: number;
  pr_url?: string;
  harness?: string;
  model?: string;
  provider?: string;
  /** Whole-run token totals (single-prompt runs; phases carry theirs per-entry). */
  tokens?: TokenUsage;
  token_source?: TokenSource;
  // --- bench / clone-isolation fields (Phase 04) ---
  /** Isolation mode for this run. Defaults to 'worktree' (existing behaviour). */
  isolation?: 'worktree' | 'clone';
  /** Baseline repo the clone is made from (defaults to the CWD repo at launch). */
  bench_repo?: string;
  /** Baseline branch the clone starts on (defaults to the CWD current branch). */
  bench_branch?: string;
  /** Commit the clone started at — capture diffs against this. */
  base_ref?: string;
  /** Normalised outcome of the harness invocation (incl. timeout/bail). */
  run_outcome?: 'completed' | 'error' | 'timeout' | 'no-op' | 'bailed';
  /** Human-readable reason for a timeout/bail/error outcome. */
  outcome_reason?: string;
  /** Wall-clock duration of the harness invocation, milliseconds. */
  duration_ms?: number;
  /** Directory the captured results (meta/diff/transcript) were written to. */
  results_dir?: string;
}

export interface QueueEntry {
  run_id: string;
  added_at: string;
  type: 'plan' | 'single-prompt';
}

export interface AppQueue {
  entries: QueueEntry[];
  paused: boolean;
}

export interface ProviderEntry {
  name: string;
  /**
   * A provider is an *endpoint* (base URL + auth + health check). Model
   * selection is orthogonal: it is chosen per-run (`--model`), falling back to
   * `default_model`, then the legacy single `model` field. `models` is the
   * catalogue of model ids the endpoint serves (informational + for listings).
   */
  anthropic_base_url?: string;
  anthropic_api_key?: string;
  anthropic_auth_token?: string;
  health_check_url?: string;
  /** Model ids this endpoint serves (e.g. ['gemma4-cpe:31b', 'gemma4-cpe:26b']). */
  models?: string[];
  /** Model used when a run doesn't request one. Falls back to legacy `model`. */
  default_model?: string;
  /** @deprecated Legacy single-model field; still read as the default. Use default_model/models. */
  model?: string;
  /**
   * Provider kind. 'litellm' marks a LiteLLM gateway: runs get an ephemeral
   * virtual key (minted via /key/generate) and token totals are summed from the
   * gateway's /spend/logs (see src/runner/litellm.ts and
   * docs/litellm-integration-spec.md). `anthropic_base_url` is the gateway root.
   */
  type?: 'litellm';
  /**
   * Env var holding the gateway admin key (default CPE_LITELLM_KEY). The key
   * needs /key/generate, /key/delete and /spend/logs access.
   */
  admin_key_env?: string;
  /** Inline admin key. Discouraged — prefer admin_key_env. */
  admin_key?: string;
}

/** Cached result of probing whether a harness's binary is installed on the host. */
export interface HarnessStatus {
  name: string;
  bin: string;
  installed: boolean;
  path?: string;
  version?: string;
  /** ISO timestamp of when this was probed. */
  checked_at: string;
}

export interface AppConfig {
  max_retries: number;
  gitea_host?: string;
  target_branch?: string;
  dangerously_skip_permissions?: boolean;
  sandbox?: SandboxConfig;
  providers?: ProviderEntry[];
  provider_for_planning?: string;
  provider_for_phases?: string;
  harness_for_planning?: string;
  harness_for_phases?: string;
  /**
   * Cached harness install-detection results (see src/harness/detect.ts). Populated
   * on first launch of a harness-selecting command, refreshed by `cpe harness check`.
   * Selection is gated to harnesses whose status here is installed.
   */
  harnesses?: HarnessStatus[];
  // --- bench / clone-isolation config (Phase 04) ---
  /** Default isolation mode. 'worktree' (default) keeps existing behaviour. */
  isolation?: 'worktree' | 'clone';
  /** No-new-output window before a run is killed as 'timeout'. Off when unset. */
  inactivity_timeout_seconds?: number;
  /** Absolute wall-clock cap regardless of activity. Off when unset. */
  max_runtime_seconds?: number;
  /** Seconds to sleep between runs (lets Ollama evict the previous model). */
  pause_seconds?: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  max_retries: 1,
  harness_for_planning: 'claude-code',
  harness_for_phases: 'claude-code',
  isolation: 'worktree',
  sandbox: {
    enabled: true,
    allowedDomains: [
      'api.anthropic.com',
      'github.com',
      'api.github.com',
      '*.actions.githubusercontent.com',
      '*.blob.core.windows.net',
      'registry.npmjs.org',
      'pypi.org',
    ],
  },
};
