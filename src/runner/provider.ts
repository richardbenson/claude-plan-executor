import type { ProviderEntry } from '../types/meta.js';

export interface ResolvedProvider {
  name: string;
  env: Record<string, string>;
  /** The resolved model id (for harness ctx.model), or undefined for the endpoint default. */
  model?: string;
  /** CLI args selecting the model (`['--model', <id>]`), or [] when none is resolved. */
  modelArgs: string[];
}

/**
 * The model an endpoint will use, by precedence:
 *   per-run request (`--model`) → provider.default_model → legacy provider.model.
 * Returns undefined when none is set (only valid for the default Anthropic endpoint).
 */
export function resolveModel(provider: ProviderEntry, requestedModel?: string): string | undefined {
  return requestedModel || provider.default_model || provider.model;
}

/** A provider that points at a custom endpoint must have a model — its backend won't know claude's default. */
function isCustomEndpoint(p: ProviderEntry): boolean {
  return !!p.anthropic_base_url;
}

export async function checkProvider(provider: ProviderEntry): Promise<boolean> {
  if (!provider.health_check_url) return true;

  let url: string;
  if (provider.health_check_url.startsWith('http://') || provider.health_check_url.startsWith('https://')) {
    url = provider.health_check_url;
  } else {
    if (!provider.anthropic_base_url) return false;
    url = provider.anthropic_base_url.replace(/\/$/, '') + provider.health_check_url;
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

/**
 * Candidate model-list endpoints to probe for a given base URL, covering the
 * common backends: OpenAI-compatible / Anthropic (`/v1/models`) and native
 * Ollama (`/api/tags`). An empty base URL means the real Anthropic API.
 */
export function modelListEndpoints(baseUrl?: string): string[] {
  const b = (baseUrl?.trim() || 'https://api.anthropic.com').replace(/\/+$/, '');
  const noV1 = b.replace(/\/v1$/, '');
  return [...new Set([
    b.endsWith('/v1') ? `${b}/models` : `${b}/v1/models`,
    `${noV1}/api/tags`,
    `${b}/models`,
  ])];
}

/**
 * Extract model ids from a model-list response. Handles OpenAI/Anthropic
 * (`{ data: [{ id }] }`) and Ollama (`{ models: [{ name }] }`) shapes.
 */
export function parseModelList(json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const o = json as Record<string, unknown>;
  const pick = (arr: unknown, keys: string[]): string[] =>
    Array.isArray(arr)
      ? arr
          .map(it => {
            const r = it as Record<string, unknown> | null;
            for (const k of keys) if (r && typeof r[k] === 'string') return r[k] as string;
            return undefined;
          })
          .filter((x): x is string => !!x)
      : [];
  const fromData = pick(o['data'], ['id']);
  if (fromData.length) return fromData;
  return pick(o['models'], ['name', 'id', 'model']);
}

/**
 * Try to fetch the model catalogue from a provider endpoint. Probes the common
 * list endpoints in turn and returns the first non-empty result (sorted), along
 * with the endpoint that worked (usable as a health-check URL). Returns null if
 * none respond usefully. Auth is sent in both Bearer and x-api-key forms so it
 * works for OpenAI-compatible and Anthropic backends alike.
 */
export async function fetchProviderModels(
  baseUrl?: string,
  opts?: { apiKey?: string; authToken?: string },
): Promise<{ models: string[]; endpoint: string } | null> {
  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' };
  const key = opts?.apiKey || opts?.authToken;
  if (key) {
    headers['Authorization'] = `Bearer ${key}`;
    headers['x-api-key'] = key;
  }
  for (const url of modelListEndpoints(baseUrl)) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const models = parseModelList(await res.json());
      if (models.length) return { models: [...new Set(models)].sort(), endpoint: url };
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function buildProviderEnv(provider: ProviderEntry): Record<string, string> {
  const env: Record<string, string> = {};
  if (provider.anthropic_base_url) env['ANTHROPIC_BASE_URL'] = provider.anthropic_base_url;
  if (provider.anthropic_api_key) env['ANTHROPIC_API_KEY'] = provider.anthropic_api_key;
  if (provider.anthropic_auth_token) env['ANTHROPIC_AUTH_TOKEN'] = provider.anthropic_auth_token;
  return env;
}

export function buildProviderArgs(provider: ProviderEntry, requestedModel?: string): string[] {
  const model = resolveModel(provider, requestedModel);
  return model ? ['--model', model] : [];
}

export async function resolveProvider(
  providers: ProviderEntry[],
  role: 'planning' | 'phase',
  nameOverride?: string,
  requestedModel?: string,
): Promise<ResolvedProvider | null> {
  void role;

  if (!providers || providers.length === 0) return null;

  let candidates: ProviderEntry[];
  if (nameOverride) {
    const match = providers.find(p => p.name === nameOverride);
    const rest = providers.filter(p => p.name !== nameOverride);
    candidates = match ? [match, ...rest] : rest;
  } else {
    candidates = providers;
  }

  for (const candidate of candidates) {
    if (await checkProvider(candidate)) {
      const model = resolveModel(candidate, requestedModel);
      // Fail fast: a healthy custom endpoint with no resolvable model would
      // otherwise let the harness fall back to its built-in default model
      // (e.g. claude-opus-4-8), which a local/OpenAI-compatible backend 404s.
      if (isCustomEndpoint(candidate) && !model) {
        throw new Error(
          `Provider '${candidate.name}' points at a custom endpoint ` +
          `(${candidate.anthropic_base_url}) but no model is selected. Pass ` +
          `--model <id>, or set "default_model" (or "models") on the provider.`,
        );
      }
      return {
        name: candidate.name,
        env: buildProviderEnv(candidate),
        ...(model ? { model } : {}),
        modelArgs: model ? ['--model', model] : [],
      };
    }
  }

  return null;
}
