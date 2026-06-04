import { test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Database } from 'bun:sqlite';
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

test('parseCrushUsage sums prompt/completion tokens (and cost) from the sessions table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crush-test-'));
  const dbPath = path.join(dir, 'crush.db');
  const db = new Database(dbPath);
  db.run('CREATE TABLE sessions (id TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, cost REAL)');
  db.run("INSERT INTO sessions VALUES ('a', 10333, 6, 0)");
  db.run("INSERT INTO sessions VALUES ('b', 200, 50, 0.0021)");
  db.close();

  const out = parseCrushUsage(dbPath);
  expect(out.tokens).toEqual({
    input_tokens: 10333 + 200,
    output_tokens: 6 + 50,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  });
  expect(out.costUsd).toBeCloseTo(0.0021, 6);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseCrushUsage returns {} for a missing db or all-zero usage', () => {
  expect(parseCrushUsage('/nonexistent/crush.db')).toEqual({});

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crush-test-'));
  const dbPath = path.join(dir, 'crush.db');
  const db = new Database(dbPath);
  db.run('CREATE TABLE sessions (id TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, cost REAL)');
  db.run("INSERT INTO sessions VALUES ('z', 0, 0, 0)");
  db.close();
  expect(parseCrushUsage(dbPath)).toEqual({});
  fs.rmSync(dir, { recursive: true, force: true });
});
