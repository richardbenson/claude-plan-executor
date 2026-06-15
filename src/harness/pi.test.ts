import { test, expect } from 'bun:test';
import {
  openAiBaseFrom,
  derivePiOutcome,
  piRunArgs,
  buildModelsJson,
  parsePiUsage,
  piHarness,
} from './pi.js';
import * as registry from './registry.js';

test('pi is registered as an opaque-mode harness', () => {
  const h = registry.get('pi');
  expect(h).toBe(piHarness);
  expect(h.completionMode).toBe('opaque');
  expect(registry.list()).toContain('pi');
});

test('openAiBaseFrom appends /v1, is idempotent, trims slashes, null when unset', () => {
  expect(openAiBaseFrom({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434' })).toBe('http://192.168.1.3:11434/v1');
  expect(openAiBaseFrom({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434/' })).toBe('http://192.168.1.3:11434/v1');
  expect(openAiBaseFrom({ ANTHROPIC_BASE_URL: 'http://host/v1' })).toBe('http://host/v1');
  expect(openAiBaseFrom({})).toBeNull();
});

test('derivePiOutcome maps exit code + diff to an outcome', () => {
  expect(derivePiOutcome(0, true)).toBe('completed');
  expect(derivePiOutcome(0, false)).toBe('no-op');
  expect(derivePiOutcome(1, true)).toBe('error');
  expect(derivePiOutcome(1, false)).toBe('error');
});

test('piRunArgs builds a non-interactive json-mode invocation against the ollama provider', () => {
  expect(piRunArgs('gemma4-cpe:31b')).toEqual([
    '-p',
    '--provider', 'ollama',
    '--model', 'gemma4-cpe:31b',
    '--mode', 'json',
    '--no-session',
    '-t', 'read,write,edit,bash,grep,find,ls',
  ]);
});

test('buildModelsJson declares an OpenAI-compatible ollama provider for one model', () => {
  const cfg = buildModelsJson('gemma4-cpe:31b', 'http://h/v1', 'ollama');
  expect(cfg).toEqual({
    providers: {
      ollama: {
        baseUrl: 'http://h/v1',
        api: 'openai-completions',
        apiKey: 'ollama',
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        models: [{ id: 'gemma4-cpe:31b' }],
      },
    },
  });
});

test('parsePiUsage dedupes usage by responseId and sums across distinct responses', () => {
  // Two distinct model responses; each repeated across update/end/turn_end events
  // (as pi actually emits) — must be counted once each, then summed.
  const r1 = (type: string) =>
    JSON.stringify({ type, message: { role: 'assistant', usage: { input: 1350, output: 26, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }, responseId: 'chatcmpl-787' } });
  const r2 = (type: string) =>
    JSON.stringify({ type, message: { role: 'assistant', usage: { input: 1391, output: 18, cacheRead: 5, cacheWrite: 2, cost: { total: 0 } }, responseId: 'chatcmpl-427' } });
  const text = [
    r1('message_update'), r1('message_end'), r1('turn_end'),
    r2('message_update'), r2('message_end'), r2('turn_end'),
  ].join('\n');
  expect(parsePiUsage(text)).toEqual({
    tokens: {
      input_tokens: 1350 + 1391,
      output_tokens: 26 + 18,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 2,
    },
  });
});

test('parsePiUsage reports costUsd only when total cost > 0', () => {
  const withCost = JSON.stringify({
    type: 'message_end',
    message: { usage: { input: 10, output: 2, cost: { total: 0.0042 } }, responseId: 'r-cost' },
  });
  const out = parsePiUsage(withCost);
  expect(out.costUsd).toBe(0.0042);
});

test('parsePiUsage returns empty object when there is no usage data', () => {
  expect(parsePiUsage('')).toEqual({});
  expect(parsePiUsage('not json\n{"type":"text","content":"hi"}')).toEqual({});
});
