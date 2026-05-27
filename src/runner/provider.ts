import type { ProviderEntry } from '../types/meta.js';

export interface ResolvedProvider {
  name: string;
  env: Record<string, string>;
  modelArgs: string[];
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

export function buildProviderArgs(provider: ProviderEntry): string[] {
  return provider.model ? ['--model', provider.model] : [];
}

export async function resolveProvider(
  providers: ProviderEntry[],
  role: 'planning' | 'phase',
  nameOverride?: string,
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
      return {
        name: candidate.name,
        env: buildProviderEnv(candidate),
        modelArgs: buildProviderArgs(candidate),
      };
    }
  }

  return null;
}
