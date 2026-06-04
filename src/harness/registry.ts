import type { Harness } from './types.js';
import { claudeCodeHarness } from './claude-code.js';
import { opencodeHarness } from './opencode.js';
import { aiderHarness } from './aider.js';
import { gooseHarness } from './goose.js';
import { openhandsHarness } from './openhands.js';
import { plandexHarness } from './plandex.js';
import { piHarness } from './pi.js';
import { crushHarness } from './crush.js';

const registry = new Map<string, Harness>();

/** Register a harness adapter by its `name`. Later registrations overwrite earlier ones. */
export function register(harness: Harness): void {
  registry.set(harness.name, harness);
}

/** Look up a registered harness by name. Throws a clear error for unknown names. */
export function get(name: string): Harness {
  const harness = registry.get(name);
  if (!harness) {
    const known = [...registry.keys()].sort().join(', ') || '(none)';
    throw new Error(`Unknown harness '${name}'. Registered harnesses: ${known}.`);
  }
  return harness;
}

/** Names of all registered harnesses. */
export function list(): string[] {
  return [...registry.keys()];
}

// Register the default adapter.
register(claudeCodeHarness);
// Register opaque-mode adapters.
register(opencodeHarness);
register(aiderHarness);
register(gooseHarness);
register(openhandsHarness);
register(plandexHarness);
register(piHarness);
register(crushHarness);
