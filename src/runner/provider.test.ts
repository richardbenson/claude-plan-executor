import { test, expect } from 'bun:test';
import { resolveModel, buildProviderArgs, resolveProvider, modelListEndpoints, parseModelList } from './provider.js';
import type { ProviderEntry } from '../types/meta.js';

test('resolveModel precedence: requested > default_model > legacy model', () => {
  const p: ProviderEntry = { name: 'x', model: 'legacy', default_model: 'def' };
  expect(resolveModel(p, 'req')).toBe('req');
  expect(resolveModel(p)).toBe('def');
  expect(resolveModel({ name: 'x', model: 'legacy' })).toBe('legacy');
  expect(resolveModel({ name: 'x' })).toBeUndefined();
});

test('buildProviderArgs emits --model from the resolved model', () => {
  expect(buildProviderArgs({ name: 'x', default_model: 'm' })).toEqual(['--model', 'm']);
  expect(buildProviderArgs({ name: 'x', default_model: 'm' }, 'override')).toEqual(['--model', 'override']);
  expect(buildProviderArgs({ name: 'x' })).toEqual([]);
});

test('resolveProvider applies the requested model over the provider default', async () => {
  // No health_check_url => checkProvider() short-circuits true (no network).
  const providers: ProviderEntry[] = [
    { name: 'local', anthropic_base_url: 'http://host:11434', default_model: 'def:1b' },
  ];
  const r = await resolveProvider(providers, 'phase', 'local', 'gemma:31b');
  expect(r?.model).toBe('gemma:31b');
  expect(r?.modelArgs).toEqual(['--model', 'gemma:31b']);
  expect(r?.env['ANTHROPIC_BASE_URL']).toBe('http://host:11434');

  const d = await resolveProvider(providers, 'phase', 'local');
  expect(d?.model).toBe('def:1b');
});

test('resolveProvider fails fast when a custom endpoint has no resolvable model', async () => {
  const providers: ProviderEntry[] = [
    { name: 'local', anthropic_base_url: 'http://host:11434' }, // no model anywhere
  ];
  await expect(resolveProvider(providers, 'phase', 'local')).rejects.toThrow(/no model is selected/);
  // …but supplying a model at request time satisfies it.
  const r = await resolveProvider(providers, 'phase', 'local', 'gemma:31b');
  expect(r?.model).toBe('gemma:31b');
});

test('resolveProvider tolerates a model-less Anthropic endpoint (no custom base url, no throw)', async () => {
  const providers: ProviderEntry[] = [{ name: 'anthropic', anthropic_api_key: 'sk-x' }];
  const r = await resolveProvider(providers, 'phase', 'anthropic');
  expect(r?.model).toBeUndefined();
  expect(r?.modelArgs).toEqual([]);
});

test('resolveProvider returns null when no providers are configured', async () => {
  expect(await resolveProvider([], 'phase', undefined)).toBeNull();
});

test('modelListEndpoints probes OpenAI-compatible, Ollama, and plain shapes', () => {
  expect(modelListEndpoints('http://host:11434')).toEqual([
    'http://host:11434/v1/models',
    'http://host:11434/api/tags',
    'http://host:11434/models',
  ]);
  // A base that already ends in /v1 shouldn't double it.
  expect(modelListEndpoints('http://host:11434/v1')).toEqual([
    'http://host:11434/v1/models',
    'http://host:11434/api/tags',
    'http://host:11434/v1/models',
  ].filter((v, i, a) => a.indexOf(v) === i));
  // Empty base URL means the real Anthropic API.
  expect(modelListEndpoints('')[0]).toBe('https://api.anthropic.com/v1/models');
});

test('parseModelList handles OpenAI/Anthropic (data[].id) and Ollama (models[].name)', () => {
  expect(parseModelList({ object: 'list', data: [{ id: 'gpt-x' }, { id: 'gpt-y' }] })).toEqual(['gpt-x', 'gpt-y']);
  expect(parseModelList({ models: [{ name: 'gemma:31b' }, { name: 'gemma:26b' }] })).toEqual(['gemma:31b', 'gemma:26b']);
  expect(parseModelList({})).toEqual([]);
  expect(parseModelList('nope')).toEqual([]);
});
