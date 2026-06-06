import { test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  openhandsModelArg,
  baseUrlFrom,
  deriveOpenhandsOutcome,
  parseOpenhandsUsage,
  openhandsHarness,
} from './openhands.js';
import * as registry from './registry.js';

test('openhands is registered as an opaque-mode harness', () => {
  const h = registry.get('openhands');
  expect(h).toBe(openhandsHarness);
  expect(h.completionMode).toBe('opaque');
  expect(registry.list()).toContain('openhands');
});

test('openhandsModelArg uses the openai-compatible provider (native function-calling)', () => {
  expect(openhandsModelArg('gemma4-cpe:31b')).toBe('openai/gemma4-cpe:31b');
  expect(openhandsModelArg('openai/gpt-5')).toBe('openai/gpt-5');
});

test('baseUrlFrom returns the OpenAI-compatible /v1 base, idempotent, else null', () => {
  expect(baseUrlFrom({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434' })).toBe('http://192.168.1.3:11434/v1');
  expect(baseUrlFrom({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434/' })).toBe('http://192.168.1.3:11434/v1');
  expect(baseUrlFrom({ ANTHROPIC_BASE_URL: 'http://host/v1' })).toBe('http://host/v1');
  expect(baseUrlFrom({})).toBeNull();
});

test('deriveOpenhandsOutcome maps exit code + diff to an outcome', () => {
  expect(deriveOpenhandsOutcome(0, true)).toBe('completed');
  expect(deriveOpenhandsOutcome(0, false)).toBe('no-op');
  expect(deriveOpenhandsOutcome(1, true)).toBe('error');
  expect(deriveOpenhandsOutcome(1, false)).toBe('error');
});

test('parseOpenhandsUsage sums accumulated_token_usage across components + conversations', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-oh-usage-'));
  try {
    const mkConv = (id: string, state: unknown) => {
      const dir = path.join(home, '.openhands', 'conversations', id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'base_state.json'), JSON.stringify(state));
    };
    mkConv('aaa', {
      stats: { usage_to_metrics: {
        agent: { accumulated_cost: 0.0, accumulated_token_usage: { prompt_tokens: 25743, completion_tokens: 109, cache_read_tokens: 3, cache_write_tokens: 0 } },
        condenser: { accumulated_token_usage: { prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0 } },
      } },
    });
    expect(parseOpenhandsUsage(home)).toEqual({
      tokens: { input_tokens: 25743, output_tokens: 109, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 },
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('parseOpenhandsUsage returns empty object when there is no conversation state', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-oh-nostate-'));
  try {
    expect(parseOpenhandsUsage(home)).toEqual({});
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
