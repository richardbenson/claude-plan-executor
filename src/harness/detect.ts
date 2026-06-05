import { writeConfig } from '../storage/config.js';
import * as registry from './registry.js';
import type { Harness } from './types.js';
import type { AppConfig, HarnessStatus } from '../types/meta.js';

/*
 * Harness install detection. Probing every harness on every invocation is
 * wasteful, so results are cached in config (AppConfig.harnesses) and refreshed
 * only on demand (`cpe harness check`) or when absent (first launch). Selection
 * is gated to installed harnesses via assertHarnessInstalled().
 */

/** Max time to wait for a `--version` probe before giving up on the version string. */
const VERSION_TIMEOUT_MS = 5000;

/** Optional progress hooks so scanning shows live per-harness output (it can be slow). */
export interface DetectProgress {
  /** Called just before a harness is probed. */
  start?(name: string): void;
  /** Called with the result once the harness has been probed. */
  done?(status: HarnessStatus): void;
}

/**
 * A progress reporter that prints a single line per harness to stderr (kept off
 * stdout so piped table output stays clean):
 *   `Checking for codex.......... found (0.137.0)`
 */
export const consoleDetectProgress: DetectProgress = {
  start(name) {
    process.stderr.write(`Checking for ${name.padEnd(16, '.')} `);
  },
  done(status) {
    const tag = status.installed ? (status.version ? `found (${status.version})` : 'found') : 'not found';
    process.stderr.write(`${tag}\n`);
  },
};

/**
 * Pull the first version-looking token (e.g. 1.2, 0.137.0) out of a CLI's
 * --version output. Best-effort: harnesses print wildly different banners.
 * Returns undefined when nothing version-like is present.
 */
export function parseVersion(text: string): string | undefined {
  const m = text.match(/\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/);
  return m ? m[0] : undefined;
}

/**
 * Probe a single harness: is its binary on PATH, and (best-effort) what version?
 * A harness with no `install` descriptor is reported as installed with no bin
 * (it is undetectable and therefore not gated — see assertHarnessInstalled).
 */
export function detectOne(harness: Harness): HarnessStatus {
  const checked_at = new Date().toISOString();
  const install = harness.install;
  if (!install) {
    return { name: harness.name, bin: '', installed: false, checked_at };
  }
  const path = Bun.which(install.bin);
  if (!path) {
    return { name: harness.name, bin: install.bin, installed: false, checked_at };
  }
  let version: string | undefined;
  try {
    const proc = Bun.spawnSync([install.bin, ...(install.versionArgs ?? ['--version'])], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: VERSION_TIMEOUT_MS,
    });
    version = parseVersion(`${proc.stdout?.toString() ?? ''}\n${proc.stderr?.toString() ?? ''}`);
  } catch {
    // version probe is best-effort; the binary existing is enough for "installed".
  }
  return {
    name: harness.name,
    bin: install.bin,
    installed: true,
    path,
    ...(version ? { version } : {}),
    checked_at,
  };
}

/** Probe every registered harness, optionally reporting progress per harness. */
export function detectAll(progress?: DetectProgress): HarnessStatus[] {
  const out: HarnessStatus[] = [];
  for (const name of registry.list().sort()) {
    progress?.start?.(name);
    const status = detectOne(registry.get(name));
    progress?.done?.(status);
    out.push(status);
  }
  return out;
}

/** The cached status for a harness, if any. */
export function getHarnessStatus(config: AppConfig, name: string): HarnessStatus | undefined {
  return config.harnesses?.find(h => h.name === name);
}

/**
 * Ensure the config carries harness-detection results. If absent/empty, run
 * detection once and persist it (the "first launch runs it" hook). Cheap no-op
 * once populated. Returns the (possibly updated) config.
 */
export function ensureHarnessDetection(config: AppConfig): AppConfig {
  if (config.harnesses && config.harnesses.length > 0) return config;
  process.stderr.write('Detecting installed harnesses (first run; cached thereafter)...\n');
  const updated: AppConfig = { ...config, harnesses: detectAll(consoleDetectProgress) };
  writeConfig(updated);
  return updated;
}

/**
 * Throw a clear error if a harness is known to be NOT installed. A harness with
 * no detection record, or one whose adapter has no `install` descriptor (bin ''),
 * is allowed through ("cannot verify"). Callers should ensureHarnessDetection
 * first so the record exists.
 */
export function assertHarnessInstalled(config: AppConfig, name: string): void {
  const status = getHarnessStatus(config, name);
  if (!status || status.installed || !status.bin) return;
  const url = registry.get(name).install?.url;
  throw new Error(
    `Harness '${name}' is not installed (binary '${status.bin}' not found on PATH).` +
      (url ? ` Install: ${url}.` : '') +
      ` (run \`cpe harness check\` if you believe it is)`,
  );
}
