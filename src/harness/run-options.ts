import { get } from './registry.js';

/** The `{ provider, model, harness }` triple parsed from CLI options. */
export interface RunHarnessOptions {
  harness?: string;
  model?: string;
  provider?: string;
}

/**
 * Extract `{ harness, model, provider }` from raw CLI options, validating the
 * harness name against the registry. An unknown harness fails fast with a clear
 * error (surfaced by the `wrap()` helper in cli.ts). All three are optional;
 * absence means "use existing defaults".
 */
export function resolveRunOptions(
  options?: { harness?: string; model?: string; provider?: string },
): RunHarnessOptions {
  if (!options) return {};
  if (options.harness !== undefined) {
    // Throws a clear error for an unknown harness name.
    get(options.harness);
  }
  return {
    ...(options.harness !== undefined ? { harness: options.harness } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
  };
}
