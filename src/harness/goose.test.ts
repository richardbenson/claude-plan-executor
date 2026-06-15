import { test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ollamaHostFrom,
  gooseProviderEnv,
  deriveGooseOutcome,
  gooseMaxTurns,
  parseGooseUsage,
  gooseHarness,
} from './goose.js';
import * as registry from './registry.js';

test('goose is registered as an opaque-mode harness', () => {
  const h = registry.get('goose');
  expect(h).toBe(gooseHarness);
  expect(h.completionMode).toBe('opaque');
  expect(registry.list()).toContain('goose');
});

test('ollamaHostFrom returns the base url (trailing slash trimmed), else null', () => {
  expect(ollamaHostFrom({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434' })).toBe('http://192.168.1.3:11434');
  expect(ollamaHostFrom({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434/' })).toBe('http://192.168.1.3:11434');
  expect(ollamaHostFrom({})).toBeNull();
});

test('gooseProviderEnv: Ollama-native by default, OpenAI provider behind a gateway', () => {
  // Direct Ollama endpoint -> goose's native ollama provider.
  expect(gooseProviderEnv({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434' })).toEqual({
    GOOSE_PROVIDER: 'ollama',
    OLLAMA_HOST: 'http://192.168.1.3:11434',
  });
  // LiteLLM gateway (CPE_GATEWAY hint) serves OpenAI-compat /v1, not the
  // Ollama-native /api/* — switch to goose's openai provider with the run key.
  expect(gooseProviderEnv({
    ANTHROPIC_BASE_URL: 'https://litellm.example',
    ANTHROPIC_AUTH_TOKEN: 'sk-run-key',
    CPE_GATEWAY: 'openai-compat',
  })).toEqual({
    GOOSE_PROVIDER: 'openai',
    OPENAI_HOST: 'https://litellm.example',
    OPENAI_API_KEY: 'sk-run-key',
  });
});

test('deriveGooseOutcome maps exit code + diff to an outcome', () => {
  expect(deriveGooseOutcome(0, true)).toBe('completed');
  expect(deriveGooseOutcome(0, false)).toBe('no-op');
  expect(deriveGooseOutcome(1, true)).toBe('error');
  expect(deriveGooseOutcome(1, false)).toBe('error');
});

test('gooseMaxTurns defaults to 50 and accepts a positive override', () => {
  expect(gooseMaxTurns({})).toBe(50);
  expect(gooseMaxTurns({ CPE_GOOSE_MAX_TURNS: '12' })).toBe(12);
  expect(gooseMaxTurns({ CPE_GOOSE_MAX_TURNS: ' 7 ' })).toBe(7);
  expect(gooseMaxTurns({ CPE_GOOSE_MAX_TURNS: '0' })).toBe(50);
  expect(gooseMaxTurns({ CPE_GOOSE_MAX_TURNS: 'nope' })).toBe(50);
});

test('parseGooseUsage sums last-line usage across per-request logs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-goose-usage-'));
  try {
    const logsDir = path.join(root, 'goose', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    // Two requests; each file's LAST usage-bearing line is the one that counts.
    fs.writeFileSync(path.join(logsDir, 'llm_request.0.jsonl'), [
      JSON.stringify({ data: {}, usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, cache_read_input_tokens: null } }),
      JSON.stringify({ data: {}, usage: { input_tokens: 3731, output_tokens: 66, total_tokens: 3797, cache_read_input_tokens: 5 } }),
    ].join('\n') + '\n');
    fs.writeFileSync(path.join(logsDir, 'llm_request.1.jsonl'),
      JSON.stringify({ data: {}, usage: { input_tokens: 148, output_tokens: 137, total_tokens: 285, cache_read_input_tokens: null } }) + '\n');
    // A non-matching file must be ignored.
    fs.writeFileSync(path.join(logsDir, 'other.jsonl'), JSON.stringify({ usage: { input_tokens: 999, output_tokens: 999 } }) + '\n');

    expect(parseGooseUsage(root)).toEqual({
      tokens: { input_tokens: 3731 + 148, output_tokens: 66 + 137, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('parseGooseUsage returns empty object when there are no logs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-goose-nolog-'));
  try {
    expect(parseGooseUsage(root)).toEqual({});
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
