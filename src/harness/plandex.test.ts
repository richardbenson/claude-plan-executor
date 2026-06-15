import { test, expect } from 'bun:test';
import {
  plandexPlanName,
  plandexNewArgs,
  plandexTellArgs,
  derivePlandexOutcome,
  plandexHarness,
} from './plandex.js';
import * as registry from './registry.js';

test('plandex is registered as an opaque-mode harness', () => {
  const h = registry.get('plandex');
  expect(h).toBe(plandexHarness);
  expect(h.completionMode).toBe('opaque');
  expect(registry.list()).toContain('plandex');
});

test('plandexPlanName is filesystem/plan-safe (strips junk, last 12, fallback)', () => {
  expect(plandexPlanName('abcDEF123')).toBe('cpe-bench-abcDEF123');           // kept as-is (<=12)
  expect(plandexPlanName('a/b:c d')).toBe('cpe-bench-abcd');                  // strips /, :, space
  expect(plandexPlanName('0123456789ABCDEF')).toBe('cpe-bench-456789ABCDEF'); // last 12 chars
  expect(plandexPlanName('!!!')).toBe('cpe-bench-run');                       // empty -> fallback
});

test('plandexNewArgs builds a manual-autonomy new-plan invocation', () => {
  expect(plandexNewArgs('cpe-bench-x')).toEqual(['plandex', 'new', '-n', 'cpe-bench-x', '--no-auto']);
});

test('plandexTellArgs applies changes uncommitted, no exec, bounded to one reply', () => {
  expect(plandexTellArgs('do it')).toEqual([
    'plandex', 'tell', 'do it', '--apply', '--skip-commit', '--no-exec', '--skip-menu', '--stop',
  ]);
});

test('derivePlandexOutcome maps exit code + diff to an outcome', () => {
  expect(derivePlandexOutcome(0, true)).toBe('completed');
  expect(derivePlandexOutcome(0, false)).toBe('no-op');
  expect(derivePlandexOutcome(1, true)).toBe('error');
  expect(derivePlandexOutcome(1, false)).toBe('error');
});
