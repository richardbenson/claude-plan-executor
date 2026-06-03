import { test, expect } from 'bun:test';
import { openAiBaseFrom, deriveOpencodeOutcome, parseOpencodeUsage, opencodeHarness } from './opencode.js';
import * as registry from './registry.js';

test('opencode is registered as an opaque-mode harness', () => {
  const h = registry.get('opencode');
  expect(h).toBe(opencodeHarness);
  expect(h.completionMode).toBe('opaque');
  expect(registry.list()).toContain('opencode');
});

test('openAiBaseFrom appends /v1 to the Anthropic base url (idempotently)', () => {
  expect(openAiBaseFrom({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434' })).toBe('http://192.168.1.3:11434/v1');
  expect(openAiBaseFrom({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434/' })).toBe('http://192.168.1.3:11434/v1');
  expect(openAiBaseFrom({ ANTHROPIC_BASE_URL: 'http://host/v1' })).toBe('http://host/v1');
});

test('openAiBaseFrom returns null when no base url is provided', () => {
  expect(openAiBaseFrom({})).toBeNull();
});

test('deriveOpencodeOutcome maps exit code + diff to an outcome', () => {
  expect(deriveOpencodeOutcome(0, true)).toBe('completed');
  expect(deriveOpencodeOutcome(0, false)).toBe('no-op');
  expect(deriveOpencodeOutcome(1, true)).toBe('error');
  expect(deriveOpencodeOutcome(1, false)).toBe('error');
});

test('parseOpencodeUsage sums cost + tokens across step_finish events', () => {
  // Two real `--format json` step_finish lines (from a gemma4-cpe:31b run),
  // plus noise lines that must be ignored.
  const stream = [
    '{"type":"step_start","part":{"type":"step-start"}}',
    '{"type":"tool_use","part":{"tool":"write"}}',
    '{"type":"step_finish","part":{"reason":"tool-calls","tokens":{"total":8148,"input":8072,"output":76,"cache":{"write":0,"read":0}},"cost":0}}',
    '{"type":"text","part":{"text":"Done."}}',
    '{"type":"step_finish","part":{"reason":"stop","tokens":{"total":8131,"input":8124,"output":7,"cache":{"write":0,"read":5}},"cost":0.0021}}',
  ].join('\n');
  expect(parseOpencodeUsage(stream)).toEqual({
    costUsd: 0.0021,
    tokens: { input_tokens: 16196, output_tokens: 83, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 },
  });
});

test('parseOpencodeUsage returns empty object when no usage events are present', () => {
  expect(parseOpencodeUsage('not json\n{"type":"text","part":{"text":"hi"}}')).toEqual({});
});
