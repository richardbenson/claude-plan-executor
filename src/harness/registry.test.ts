import { describe, it, expect } from 'bun:test';
import { get, list, register } from './registry.js';
import { claudeCodeHarness } from './claude-code.js';
import type { Harness } from './types.js';

describe('harness registry', () => {
  it('returns the default claude-code adapter', () => {
    const harness = get('claude-code');
    expect(harness).toBe(claudeCodeHarness);
    expect(harness.name).toBe('claude-code');
    expect(harness.completionMode).toBe('structured');
  });

  it('throws a clear error for an unknown harness', () => {
    expect(() => get('nope')).toThrow(/Unknown harness 'nope'/);
  });

  it('lists registered harnesses and supports registration', () => {
    expect(list()).toContain('claude-code');

    const fake: Harness = {
      name: 'test-fake',
      completionMode: 'opaque',
      async run() {
        return { exitCode: 0, outcome: 'completed' as const };
      },
    };
    register(fake);
    expect(get('test-fake')).toBe(fake);
  });
});
