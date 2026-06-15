import { test, expect } from 'bun:test';
import {
  codexBaseUrl,
  deriveCodexOutcome,
  buildCodexConfig,
  codexExecArgs,
  parseCodexUsage,
  codexHarness,
} from './codex.js';
import * as registry from './registry.js';

test('codex is registered as an opaque-mode harness', () => {
  const h = registry.get('codex');
  expect(h).toBe(codexHarness);
  expect(h.completionMode).toBe('opaque');
  expect(registry.list()).toContain('codex');
});

test('codexBaseUrl yields an OpenAI-compatible /v1 base, idempotent, null when unset', () => {
  expect(codexBaseUrl({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434' })).toBe('http://192.168.1.3:11434/v1');
  expect(codexBaseUrl({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434/' })).toBe('http://192.168.1.3:11434/v1');
  expect(codexBaseUrl({ ANTHROPIC_BASE_URL: 'http://host/v1' })).toBe('http://host/v1');
  expect(codexBaseUrl({})).toBeNull();
});

test('deriveCodexOutcome maps exit code + diff to an outcome', () => {
  expect(deriveCodexOutcome(0, true)).toBe('completed');
  expect(deriveCodexOutcome(0, false)).toBe('no-op');
  expect(deriveCodexOutcome(1, true)).toBe('error');
  expect(deriveCodexOutcome(1, false)).toBe('error');
});

test('codexExecArgs builds a headless json exec pinned to the clone cwd', () => {
  expect(codexExecArgs('gemma4-cpe:31b', '/clone')).toEqual([
    'exec',
    '--json',
    '--cd', '/clone',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    '-m', 'gemma4-cpe:31b',
  ]);
});

test('buildCodexConfig declares a responses provider for the base URL and selects the model', () => {
  const cfg = buildCodexConfig('gemma4-cpe:31b', 'http://h/v1', false);
  expect(cfg).toContain('model = "gemma4-cpe:31b"');
  expect(cfg).toContain('model_provider = "ollama-cpe"');
  expect(cfg).toContain('[model_providers.ollama-cpe]');
  expect(cfg).toContain('base_url = "http://h/v1"');
  // codex 0.137.0 removed wire_api = "chat"; custom providers must use responses.
  expect(cfg).toContain('wire_api = "responses"');
  // no auth token => no env_key declared.
  expect(cfg).not.toContain('env_key');
});

test('buildCodexConfig adds an env_key only when an api key is supplied', () => {
  const cfg = buildCodexConfig('m', 'http://h/v1', true);
  expect(cfg).toContain('env_key = "CODEX_PROVIDER_API_KEY"');
});

test('parseCodexUsage sums usage across turn.completed events (reasoning folds into output)', () => {
  const log = [
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"hi"}}',
    '{"type":"turn.completed","usage":{"input_tokens":23492,"cached_input_tokens":10,"output_tokens":132,"reasoning_output_tokens":8}}',
    '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":5,"output_tokens":20,"reasoning_output_tokens":2}}',
  ].join('\n');
  const out = parseCodexUsage(log);
  expect(out.tokens).toEqual({
    input_tokens: 23492 + 100,
    output_tokens: 132 + 8 + 20 + 2,
    cache_read_input_tokens: 10 + 5,
    cache_creation_input_tokens: 0,
  });
  expect(out.costUsd).toBeUndefined();
});

test('parseCodexUsage returns {} when there is no turn.completed usage', () => {
  expect(parseCodexUsage('')).toEqual({});
  expect(parseCodexUsage('{"type":"turn.started"}\nnot json\n')).toEqual({});
});
