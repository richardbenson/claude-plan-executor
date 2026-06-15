import { test, expect } from 'bun:test';
import { resolveModel, buildProviderArgs, resolveProvider, modelListEndpoints, parseModelList, healthCheckPath } from './provider.js';
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

test('healthCheckPath returns a base-relative path under the base url, else the full url', () => {
  expect(healthCheckPath('http://host:11434', 'http://host:11434/v1/models')).toBe('/v1/models');
  expect(healthCheckPath('http://host:11434/', 'http://host:11434/api/tags')).toBe('/api/tags');
  // Endpoint not under the base (or no base) → keep the full URL.
  expect(healthCheckPath('', 'https://api.anthropic.com/v1/models')).toBe('https://api.anthropic.com/v1/models');
  expect(healthCheckPath('http://a', 'http://b/v1/models')).toBe('http://b/v1/models');
});

// --- LiteLLM gateway resolution -------------------------------------------

/** Minimal fake gateway: readiness + key mint (see litellm.test.ts for the full client suite). */
function fakeLitellmServer(opts?: { failKeyGen?: boolean; unhealthy?: boolean }) {
  const state = { keyGenBodies: [] as Record<string, unknown>[] };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/health/readiness') {
        return opts?.unhealthy
          ? new Response('down', { status: 503 })
          : Response.json({ status: 'healthy' });
      }
      if (url.pathname === '/key/generate') {
        state.keyGenBodies.push(await req.json() as Record<string, unknown>);
        if (opts?.failKeyGen) return new Response('boom', { status: 500 });
        return Response.json({ key: 'sk-run-from-provider' });
      }
      return new Response('not found', { status: 404 });
    },
  });
  return { server, baseUrl: `http://localhost:${server.port}`, state };
}

test('resolveProvider mints a per-run key for a litellm provider and builds the gateway env', async () => {
  const { server, baseUrl, state } = fakeLitellmServer();
  try {
    const providers: ProviderEntry[] = [
      { name: 'gw', type: 'litellm', anthropic_base_url: baseUrl, admin_key: 'sk-admin' },
    ];
    const r = await resolveProvider(providers, 'phase', 'gw', 'gemma4-cpe:31b', {
      litellmKeySeconds: 10800,
      runId: '01RUN',
    });
    expect(r?.litellm?.key).toBe('sk-run-from-provider');
    expect(r?.litellm?.gateway.baseUrl).toBe(baseUrl);
    // Env: existing adapter shape (base + key in both ANTHROPIC vars) + the
    // gateway hint that flips goose to its OpenAI-compatible provider.
    expect(r?.env['ANTHROPIC_BASE_URL']).toBe(baseUrl);
    expect(r?.env['ANTHROPIC_API_KEY']).toBe('sk-run-from-provider');
    expect(r?.env['ANTHROPIC_AUTH_TOKEN']).toBe('sk-run-from-provider');
    expect(r?.env['CPE_GATEWAY']).toBe('openai-compat');
    expect(r?.modelArgs).toEqual(['--model', 'gemma4-cpe:31b']);
    expect(state.keyGenBodies[0]?.['models']).toEqual(['gemma4-cpe:31b']);
  } finally {
    server.stop(true);
  }
});

test('resolveProvider degrades to admin-key routing when key minting fails (no litellm handle)', async () => {
  const { server, baseUrl } = fakeLitellmServer({ failKeyGen: true });
  try {
    const providers: ProviderEntry[] = [
      { name: 'gw', type: 'litellm', anthropic_base_url: baseUrl, admin_key: 'sk-admin' },
    ];
    const r = await resolveProvider(providers, 'phase', 'gw', 'm:1b', { litellmKeySeconds: 60 });
    expect(r?.litellm).toBeUndefined();
    expect(r?.env['ANTHROPIC_API_KEY']).toBe('sk-admin');
  } finally {
    server.stop(true);
  }
});

test('resolveProvider routes auxiliary calls (no litellmKeySeconds) with the admin key, no mint', async () => {
  const { server, baseUrl, state } = fakeLitellmServer();
  try {
    const providers: ProviderEntry[] = [
      { name: 'gw', type: 'litellm', anthropic_base_url: baseUrl, admin_key: 'sk-admin' },
    ];
    const r = await resolveProvider(providers, 'phase', 'gw', 'm:1b');
    expect(r?.litellm).toBeUndefined();
    expect(r?.env['ANTHROPIC_API_KEY']).toBe('sk-admin');
    expect(state.keyGenBodies.length).toBe(0);
  } finally {
    server.stop(true);
  }
});

test('an explicitly selected litellm gateway that is unreachable fails loudly (no silent fallthrough)', async () => {
  const { server, baseUrl } = fakeLitellmServer({ unhealthy: true });
  try {
    const providers: ProviderEntry[] = [
      { name: 'gw', type: 'litellm', anthropic_base_url: baseUrl, admin_key: 'sk-admin' },
      { name: 'other', anthropic_base_url: 'http://host:11434', default_model: 'm:1b' },
    ];
    await expect(resolveProvider(providers, 'phase', 'gw', 'm:1b')).rejects.toThrow(/unreachable/);
  } finally {
    server.stop(true);
  }
});

test('a litellm provider with no model fails fast like any custom endpoint', async () => {
  const { server, baseUrl } = fakeLitellmServer();
  try {
    const providers: ProviderEntry[] = [
      { name: 'gw', type: 'litellm', anthropic_base_url: baseUrl, admin_key: 'sk-admin' },
    ];
    await expect(resolveProvider(providers, 'phase', 'gw')).rejects.toThrow(/no model is selected/);
  } finally {
    server.stop(true);
  }
});
