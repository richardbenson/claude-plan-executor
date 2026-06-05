import { get } from './registry.js';
import { readConfig } from '../storage/config.js';
import { ensureHarnessDetection, assertHarnessInstalled } from './detect.js';

/** The `{ provider, model, harness }` triple parsed from CLI options. */
export interface RunHarnessOptions {
  harness?: string;
  model?: string;
  provider?: string;
}

/**
 * Extract `{ harness, model, provider }` from raw CLI options, validating the
 * harness name against the registry AND that it is installed. An unknown or
 * uninstalled harness fails fast with a clear error (surfaced by the `wrap()`
 * helper in cli.ts). All three are optional; absence means "use existing
 * defaults" (the default's installation is enforced at dispatch).
 */
export function resolveRunOptions(
  options?: { harness?: string; model?: string; provider?: string },
): RunHarnessOptions {
  if (!options) return {};
  if (options.harness !== undefined) {
    // Throws a clear error for an unknown harness name.
    get(options.harness);
    // Then gate on installation (detect once if the cache is absent).
    const config = ensureHarnessDetection(readConfig());
    assertHarnessInstalled(config, options.harness);
  }
  return {
    ...(options.harness !== undefined ? { harness: options.harness } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
  };
}
