import * as fs from 'fs';
import * as path from 'path';
import { type AppConfig } from '../types/meta.js';
import { type RepoConfig } from '../config/repo-config.js';
import { DEFAULT_SANDBOX } from '../storage/config.js';

interface ClaudeSettingsSandbox {
  enabled: boolean;
  failIfUnavailable: boolean;
  autoAllowBashIfSandboxed: boolean;
  network?: {
    allowedDomains?: string[];
  };
  filesystem?: {
    allowWrite?: string[];
  };
}

export function isBubblewrapAvailable(): boolean {
  if (process.platform !== 'linux') return true;
  const result = Bun.spawnSync(['which', 'bwrap']);
  return result.exitCode === 0;
}

export function buildSandboxSettings(
  appConfig: AppConfig,
  repoConfig: RepoConfig | null,
  noSandbox: boolean,
): ClaudeSettingsSandbox | null {
  if (noSandbox) return null;

  let enabled = DEFAULT_SANDBOX.enabled;
  let domains: string[] = [...(DEFAULT_SANDBOX.allowedDomains ?? [])];
  let writes: string[] = [...(DEFAULT_SANDBOX.allowWrite ?? [])];

  if (appConfig.sandbox) {
    if (appConfig.sandbox.enabled !== undefined) enabled = appConfig.sandbox.enabled;
    domains = [...new Set([...domains, ...(appConfig.sandbox.allowedDomains ?? [])])];
    writes = [...new Set([...writes, ...(appConfig.sandbox.allowWrite ?? [])])];
  }

  if (repoConfig?.sandbox) {
    if (repoConfig.sandbox.enabled !== undefined) enabled = repoConfig.sandbox.enabled;
    domains = [...new Set([...domains, ...(repoConfig.sandbox.allowedDomains ?? [])])];
    writes = [...new Set([...writes, ...(repoConfig.sandbox.allowWrite ?? [])])];
  }

  if (!enabled) return null;

  if (process.platform === 'linux' && !isBubblewrapAvailable()) {
    process.stderr.write(
      '[cpe] WARNING: bubblewrap (bwrap) not found — running without sandbox. Install with: sudo apt-get install bubblewrap socat\n',
    );
    return null;
  }

  const result: ClaudeSettingsSandbox = {
    enabled: true,
    failIfUnavailable: false,
    autoAllowBashIfSandboxed: true,
  };

  if (domains.length > 0) {
    result.network = { allowedDomains: domains };
  }
  if (writes.length > 0) {
    result.filesystem = { allowWrite: writes };
  }

  return result;
}

export function injectSandboxSettings(worktreePath: string, sandbox: ClaudeSettingsSandbox, extraWritePaths: string[] = []): void {
  const dir = path.join(worktreePath, '.claude');
  fs.mkdirSync(dir, { recursive: true });

  const settingsPath = path.join(dir, 'settings.local.json');
  let existing: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // absent or invalid — start fresh
  }

  // Always include the worktree itself plus any extras in allowWrite so bwrap
  // doesn't block Claude's Edit/Write tools on Linux
  const allWrites = [...new Set([worktreePath, ...extraWritePaths, ...((sandbox.filesystem?.allowWrite) ?? [])])];
  const merged: ClaudeSettingsSandbox = {
    ...sandbox,
    filesystem: { allowWrite: allWrites },
  };

  existing['sandbox'] = { ...(existing['sandbox'] as object | undefined), ...merged };
  fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n');
}
