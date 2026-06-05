import { test, expect } from 'bun:test';
import {
  outcomeFromEnvelope,
  buildHarnessResult,
  claudeCodeHarness,
} from './claude-code.js';
import type { HarnessContext } from './types.js';
import type { ClaudeEnvelope } from '../runner/envelope.js';
import * as registry from './registry.js';

function envelope(over: Partial<ClaudeEnvelope> = {}): ClaudeEnvelope {
  return {
    is_error: false,
    api_error_status: null,
    terminal_reason: 'end_turn',
    stop_reason: 'end_turn',
    result: 'done',
    structured_output: null,
    session_id: 's1',
    total_cost_usd: 0.012,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 },
    ...over,
  };
}

test('claude-code is registered as the structured default harness, with an install descriptor', () => {
  const h = registry.get('claude-code');
  expect(h).toBe(claudeCodeHarness);
  expect(h.completionMode).toBe('structured');
  expect(registry.list()).toContain('claude-code');
  expect(h.install?.bin).toBe('claude');
  expect(h.install?.url).toMatch(/claude/);
});

test('outcomeFromEnvelope maps a clean envelope to completed and an error envelope to error', () => {
  expect(outcomeFromEnvelope(envelope())).toBe('completed');
  expect(outcomeFromEnvelope(envelope({ is_error: true }))).toBe('error');
  // the synthetic parse-error envelope runSession returns is is_error: true → error
  expect(outcomeFromEnvelope(envelope({ is_error: true, terminal_reason: 'parse-error' }))).toBe('error');
});

test('buildHarnessResult lifts outcome, tokens, cost and summary off a clean envelope', () => {
  const env = envelope({ result: 'all good' });
  const res = buildHarnessResult(env, 0);
  expect(res.exitCode).toBe(0);
  expect(res.outcome).toBe('completed');
  expect(res.envelope).toBe(env);
  expect(res.tokens).toEqual(env.usage);
  expect(res.costUsd).toBe(0.012);
  expect(res.summary).toBe('all good');
});

test('buildHarnessResult reports error outcome and omits an empty summary', () => {
  const res = buildHarnessResult(envelope({ is_error: true, result: '' }), 1);
  expect(res.exitCode).toBe(1);
  expect(res.outcome).toBe('error');
  expect(res.summary).toBeUndefined();
});

test('run() requires a promptFile (structured mode)', async () => {
  const ctx = { cwd: '/tmp', providerEnv: {}, sessionId: 's', logPath: '/tmp/x.log' } as HarnessContext;
  await expect(claudeCodeHarness.run(ctx)).rejects.toThrow(/promptFile/);
});

test('run() requires a schema (structured mode)', async () => {
  const ctx = { cwd: '/tmp', providerEnv: {}, sessionId: 's', logPath: '/tmp/x.log', promptFile: '/tmp/p.md' } as HarnessContext;
  await expect(claudeCodeHarness.run(ctx)).rejects.toThrow(/schema/);
});
