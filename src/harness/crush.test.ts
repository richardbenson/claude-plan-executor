import { test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  crushBaseUrl,
  deriveCrushOutcome,
  buildCrushConfig,
  crushRunArgs,
  parseCrushUsage,
  crushHarness,
} from './crush.js';
import * as registry from './registry.js';

test('crush is registered as an opaque-mode harness', () => {
  const h = registry.get('crush');
  expect(h).toBe(crushHarness);
  expect(h.completionMode).toBe('opaque');
  expect(registry.list()).toContain('crush');
});

test('crushBaseUrl yields an openai-compat /v1/ base, idempotent, null when unset', () => {
  expect(crushBaseUrl({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434' })).toBe('http://192.168.1.3:11434/v1/');
  expect(crushBaseUrl({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434/' })).toBe('http://192.168.1.3:11434/v1/');
  expect(crushBaseUrl({ ANTHROPIC_BASE_URL: 'http://host/v1' })).toBe('http://host/v1/');
  expect(crushBaseUrl({})).toBeNull();
});

test('deriveCrushOutcome maps exit code + diff to an outcome', () => {
  expect(deriveCrushOutcome(0, true)).toBe('completed');
  expect(deriveCrushOutcome(0, false)).toBe('no-op');
  expect(deriveCrushOutcome(1, true)).toBe('error');
  expect(deriveCrushOutcome(1, false)).toBe('error');
});

test('crushRunArgs builds a headless run against the ollama provider, isolated data dir', () => {
  expect(crushRunArgs('gemma4-cpe:31b', '/clone', '/tmp/dd')).toEqual([
    '--data-dir', '/tmp/dd',
    '--cwd', '/clone',
    '--debug',
    'run',
    '--quiet',
    '-m', 'ollama/gemma4-cpe:31b',
  ]);
});

test('buildCrushConfig declares an openai-compat ollama provider + allows all built-in tools', () => {
  type CrushCfg = {
    providers: { ollama: { type: string; base_url: string; api_key: string; models: { id: string }[] } };
    permissions: { allowed_tools: string[] };
  };
  const cfg = buildCrushConfig('gemma4-cpe:31b', 'http://h/v1/', 'ollama') as unknown as CrushCfg;
  expect(cfg.providers.ollama.type).toBe('openai-compat');
  expect(cfg.providers.ollama.base_url).toBe('http://h/v1/');
  expect(cfg.providers.ollama.api_key).toBe('ollama');
  expect(cfg.providers.ollama.models[0]!.id).toBe('gemma4-cpe:31b');
  // headless permission auto-approval is config-driven (no --yolo on `run`)
  expect(cfg.permissions.allowed_tools).toEqual(
    expect.arrayContaining(['edit', 'write', 'bash', 'view']),
  );
});

test('parseCrushUsage sums per-request usage across crush --debug HTTP log entries (escaped JSON)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crush-test-'));
  const logPath = path.join(dir, 'crush.log');
  // Mimics crush's --debug round-trip log: escaped response bodies, with streaming
  // chunks that carry `usage: null` (no numbers) plus the final usage per request.
  fs.writeFileSync(logPath, [
    '{"level":"DEBUG","body":"data: {\\"choices\\":[],\\"usage\\":null}"}',
    '{"level":"DEBUG","body":"...\\"usage\\":{\\"prompt_tokens\\":170,\\"completion_tokens\\":40,\\"total_tokens\\":210}"}',
    '{"level":"DEBUG","body":"...\\"usage\\":{\\"prompt_tokens\\":10268,\\"completion_tokens\\":140,\\"total_tokens\\":10408}"}',
    '{"level":"DEBUG","body":"...\\"usage\\":{\\"prompt_tokens\\":10338,\\"completion_tokens\\":13,\\"total_tokens\\":10351}"}',
  ].join('\n'));

  const out = parseCrushUsage(logPath);
  expect(out.tokens).toEqual({
    input_tokens: 170 + 10268 + 10338,
    output_tokens: 40 + 140 + 13, // 193 — not the bogus 6 the crush.db sessions row holds
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  });
  expect(out.costUsd).toBeUndefined();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseCrushUsage also handles plain (unescaped) usage and returns {} for a missing/usage-less log', () => {
  expect(parseCrushUsage('/nonexistent/crush.log')).toEqual({});

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crush-test-'));
  const logPath = path.join(dir, 'crush.log');
  fs.writeFileSync(logPath, '{"usage":{"prompt_tokens":5,"completion_tokens":7}}\nno tokens here\n');
  expect(parseCrushUsage(logPath).tokens).toEqual({
    input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
  });

  fs.writeFileSync(logPath, 'just logs, no usage at all\n');
  expect(parseCrushUsage(logPath)).toEqual({});
  fs.rmSync(dir, { recursive: true, force: true });
});
