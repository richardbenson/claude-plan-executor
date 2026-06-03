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
