import type { ProviderEntry } from '../types/meta.js';
import { litellmGateway, generateRunKey, type LitellmRunKey } from './litellm.js';

export interface ResolvedProvider {
  name: string;
  env: Record<string, string>;
  /** The resolved model id (for harness ctx.model), or undefined for the endpoint default. */
  model?: string;
  /** CLI args selecting the model (`['--model', <id>]`), or [] when none is resolved. */
  modelArgs: string[];
  /**
   * Present when resolved through a LiteLLM gateway with a per-run virtual key.
   * The dispatch settles it after the run (collect spend-log tokens + revoke);
   * absent on degraded routing (key mint failed → admin key, adapter tokens).
   */
  litellm?: LitellmRunKey;
}

export interface ResolveProviderOptions {
  /**
   * Mint a per-run LiteLLM virtual key with this lifetime. Omit on auxiliary
   * model calls (summarise/finalise) — those route with the admin key and
   * collect nothing. Ignored for non-litellm providers.
   */
  litellmKeySeconds?: number;
  /** Run id stamped into the minted key's metadata (Langfuse/debug convenience). */
  runId?: string;
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

/** Auth headers covering OpenAI-compatible (Bearer), Anthropic (x-api-key), and Ollama (ignored). */
function authHeaders(opts?: { apiKey?: string; authToken?: string }): Record<string, string> {
  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' };
  const key = opts?.apiKey || opts?.authToken;
  if (key) {
    headers['Authorization'] = `Bearer ${key}`;
    headers['x-api-key'] = key;
  }
  return headers;
}

export async function checkProvider(provider: ProviderEntry): Promise<boolean> {
  // LiteLLM gateways expose an unauthenticated readiness probe; default to it
  // so a litellm entry is health-gated even without an explicit health URL.
  const healthPath = provider.health_check_url
    ?? (provider.type === 'litellm' ? '/health/readiness' : undefined);
  if (!healthPath) return true;

  let url: string;
  if (healthPath.startsWith('http://') || healthPath.startsWith('https://')) {
    url = healthPath;
  } else {
    if (!provider.anthropic_base_url) return false;
    url = provider.anthropic_base_url.replace(/\/$/, '') + healthPath;
  }

  try {
    // Send the provider's auth so an authenticated endpoint (e.g. /v1/models on a
    // keyed backend) reports healthy rather than 401 — important now that the
    // health URL is auto-guessed from the model-list endpoint.
    const res = await fetch(url, {
      headers: authHeaders({ apiKey: provider.anthropic_api_key, authToken: provider.anthropic_auth_token }),
      signal: AbortSignal.timeout(5000),
    });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

/**
 * Turn a model-list endpoint URL into the value to store as `health_check_url`:
 * a base-relative path when it sits under the base URL (e.g. `/v1/models`),
 * otherwise the full URL. The endpoint that served the model list is, by
 * definition, a reachable health check.
 */
export function healthCheckPath(baseUrl: string | undefined, endpoint: string): string {
  const b = (baseUrl ?? '').replace(/\/+$/, '');
  if (b && endpoint.startsWith(b)) {
    const rest = endpoint.slice(b.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return endpoint;
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
  const headers = authHeaders(opts);
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

/**
 * Provider env for a LiteLLM gateway run. Every adapter already derives its
 * endpoint from ANTHROPIC_BASE_URL (appending /v1 itself for OpenAI-compat) and
 * its key from ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY, so the gateway slots
 * into the existing shape. CPE_GATEWAY signals adapters whose default protocol
 * is Ollama-native (goose) to switch to their OpenAI-compatible mode — LiteLLM
 * serves /v1/* + /v1/messages, not the Ollama-native /api/* API.
 */
export function buildLitellmEnv(baseUrl: string, key: string): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_API_KEY: key,
    ANTHROPIC_AUTH_TOKEN: key,
    CPE_GATEWAY: 'openai-compat',
  };
}

export async function resolveProvider(
  providers: ProviderEntry[],
  role: 'planning' | 'phase',
  nameOverride?: string,
  requestedModel?: string,
  opts?: ResolveProviderOptions,
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
      if ((isCustomEndpoint(candidate) || candidate.type === 'litellm') && !model) {
        throw new Error(
          `Provider '${candidate.name}' points at a custom endpoint ` +
          `(${candidate.anthropic_base_url}) but no model is selected. Pass ` +
          `--model <id>, or set "default_model" (or "models") on the provider.`,
        );
      }
      if (candidate.type === 'litellm') {
        return resolveLitellm(candidate, model, opts);
      }
      return {
        name: candidate.name,
        env: buildProviderEnv(candidate),
        ...(model ? { model } : {}),
        modelArgs: model ? ['--model', model] : [],
      };
    } else if (candidate.type === 'litellm' && candidate.name === nameOverride) {
      // An explicitly selected gateway that's down must fail the run loudly,
      // not silently fall through to another provider / the real Anthropic API.
      throw new Error(
        `LiteLLM gateway '${candidate.name}' is unreachable ` +
        `(${candidate.anthropic_base_url ?? 'no base URL'})`,
      );
    }
  }

  return null;
}

/**
 * Resolve a healthy litellm entry: mint the per-run virtual key when the caller
 * asked for one (litellmKeySeconds), otherwise — or when minting fails — route
 * with the admin key (degraded: requests still flow, tokens fall back to the
 * adapter's own numbers since admin-key spend logs include unrelated traffic).
 */
async function resolveLitellm(
  candidate: ProviderEntry,
  model: string | undefined,
  opts?: ResolveProviderOptions,
): Promise<ResolvedProvider> {
  const gateway = litellmGateway(candidate); // throws a descriptive config error
  let litellm: LitellmRunKey | undefined;
  if (opts?.litellmKeySeconds) {
    const key = await generateRunKey(gateway, {
      durationSeconds: opts.litellmKeySeconds,
      ...(model ? { model } : {}),
      ...(opts.runId ? { runId: opts.runId } : {}),
    });
    if (key) litellm = { gateway, key };
  }
  return {
    name: candidate.name,
    env: buildLitellmEnv(gateway.baseUrl, litellm?.key ?? gateway.adminKey),
    ...(model ? { model } : {}),
    modelArgs: model ? ['--model', model] : [],
    ...(litellm ? { litellm } : {}),
  };
}
