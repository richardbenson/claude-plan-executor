import { test, expect } from 'bun:test';
import {
  openAiBase,
  miniModelArg,
  deriveMiniOutcome,
  miniRunArgs,
  parseMiniUsage,
  miniSweAgentHarness,
} from './mini-swe-agent.js';
import * as registry from './registry.js';

test('mini-swe-agent is registered as an opaque-mode harness', () => {
  const h = registry.get('mini-swe-agent');
  expect(h).toBe(miniSweAgentHarness);
  expect(h.completionMode).toBe('opaque');
  expect(registry.list()).toContain('mini-swe-agent');
});

test('openAiBase yields the OpenAI-compatible /v1 base, idempotent, null when unset', () => {
  expect(openAiBase({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434' })).toBe('http://192.168.1.3:11434/v1');
  expect(openAiBase({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434/' })).toBe('http://192.168.1.3:11434/v1');
  expect(openAiBase({ ANTHROPIC_BASE_URL: 'http://host/v1' })).toBe('http://host/v1');
  expect(openAiBase({})).toBeNull();
});

test('miniModelArg uses the openai-compatible provider unless already provider-qualified', () => {
  expect(miniModelArg('gemma4-cpe:31b')).toBe('openai/gemma4-cpe:31b');
  expect(miniModelArg('ollama/x')).toBe('ollama/x');
});

test('deriveMiniOutcome maps exit code + diff to an outcome', () => {
  expect(deriveMiniOutcome(0, true)).toBe('completed');
  expect(deriveMiniOutcome(0, false)).toBe('no-op');
  expect(deriveMiniOutcome(1, true)).toBe('error');
  expect(deriveMiniOutcome(1, false)).toBe('error');
});

test('miniRunArgs runs the non-interactive default agent and keeps the builtin config + limit backstops', () => {
  expect(miniRunArgs('gemma4-cpe:31b', '/tmp/run.traj.json', 40, 1800)).toEqual([
    '--agent-class', 'default',
    '-y',
    '--exit-immediately',
    '-l', '0',
    '-c', 'mini.yaml',
    '-c', 'agent.step_limit=40',
    '-c', 'agent.wall_time_limit_seconds=1800',
    '-m', 'openai/gemma4-cpe:31b',
    '-o', '/tmp/run.traj.json',
  ]);
});

test('parseMiniUsage sums prompt/completion tokens across assistant messages', () => {
  const traj = JSON.stringify({
    info: { model_stats: { instance_cost: 0.0, api_calls: 2 } },
    messages: [
      { role: 'system', content: '...' },
      { role: 'assistant', extra: { response: { usage: { prompt_tokens: 1823, completion_tokens: 107 } } } },
      { role: 'user', content: 'obs' },
      { role: 'assistant', extra: { response: { usage: { prompt_tokens: 2050, completion_tokens: 64 } } } },
      { role: 'exit', extra: {} },
    ],
  });
  const out = parseMiniUsage(traj);
  expect(out.tokens).toEqual({
    input_tokens: 1823 + 2050,
    output_tokens: 107 + 64,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  });
  expect(out.costUsd).toBeUndefined();
});

test('parseMiniUsage returns {} for invalid json or no usage', () => {
  expect(parseMiniUsage('not json')).toEqual({});
  expect(parseMiniUsage(JSON.stringify({ messages: [{ role: 'assistant' }] }))).toEqual({});
  expect(parseMiniUsage(JSON.stringify({}))).toEqual({});
});
