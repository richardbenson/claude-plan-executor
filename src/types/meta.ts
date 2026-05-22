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
  claude_pid?: number;
  phases?: PhaseEntry[];
  prompt?: string;
  prompt_source?: 'free-text' | 'github-issue' | 'clipboard';
  github_issue_number?: number;
  pr_url?: string;
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

export interface AppConfig {
  max_retries: number;
  gitea_host?: string;
  target_branch?: string;
  dangerously_skip_permissions?: boolean;
  sandbox?: SandboxConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  max_retries: 1,
  sandbox: {
    enabled: true,
    allowedDomains: ['api.anthropic.com', 'github.com', 'api.github.com', 'registry.npmjs.org', 'pypi.org'],
  },
};
