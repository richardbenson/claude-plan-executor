import * as fs from 'fs';
import type { ProviderEntry } from '../types/meta.js';
import { readConfig, writeConfig } from '../storage/config.js';
import { checkProvider, fetchProviderModels, healthCheckPath } from '../runner/provider.js';
import { litellmGateway } from '../runner/litellm.js';

/**
 * Credentials for querying a provider's model endpoint. LiteLLM gateways
 * require auth on /v1/models and keep their admin key in an env var
 * (admin_key_env), not in the inline anthropic_* fields.
 */
function modelFetchAuth(p: ProviderEntry): { apiKey?: string; authToken?: string } {
  if (p.type === 'litellm') {
    try {
      return { authToken: litellmGateway(p).adminKey };
    } catch {
      // unresolvable admin key — fall through to the inline fields
    }
  }
  return { apiKey: p.anthropic_api_key, authToken: p.anthropic_auth_token };
}

function readLine(): string {
  const buf = Buffer.alloc(4096);
  let total = 0;
  while (true) {
    const n = fs.readSync(0, buf, total, 1, null);
    if (n === 0) break;
    if (buf[total] === 0x0a) break;
    total += n;
  }
  return buf.slice(0, total).toString('utf8').trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** The model an entry will use by default, across new + legacy shapes. */
function entryDefaultModel(e: ProviderEntry): string | undefined {
  return e.default_model ?? e.model;
}

/** A short "Model" cell for listings: the default, with a +N hint when the catalogue is larger. */
function modelSummary(e: ProviderEntry): string {
  const def = entryDefaultModel(e);
  const extra = (e.models ?? []).filter(m => m !== def).length;
  if (!def) return e.models && e.models.length ? `${e.models[0]} (+${e.models.length - 1})` : '';
  return extra > 0 ? `${def} (+${extra})` : def;
}

export async function providerListCommand(): Promise<void> {
  const config = readConfig();
  const providers = config.providers;

  if (!providers || providers.length === 0) {
    process.stdout.write("No providers configured. Use 'cpe provider add' to add one.\n");
    return;
  }

  const COL_NAME = 20;
  const COL_MODEL = 20;
  const COL_URL = 42;
  const COL_HEALTH = 42;
  const COL_ROLES = 6;

  const header =
    'Name'.padEnd(COL_NAME) +
    'Model'.padEnd(COL_MODEL) +
    'Base URL'.padEnd(COL_URL) +
    'Health URL'.padEnd(COL_HEALTH) +
    'Roles'.padEnd(COL_ROLES);
  const separator = '-'.repeat(header.length);

  process.stdout.write(header + '\n');
  process.stdout.write(separator + '\n');

  for (const p of providers) {
    const isPlanning = config.provider_for_planning === p.name;
    const isPhases = config.provider_for_phases === p.name;
    let roles: string;
    if (isPlanning && isPhases) roles = 'P+F';
    else if (isPlanning) roles = 'P';
    else if (isPhases) roles = 'F';
    else roles = '—';

    const row =
      p.name.padEnd(COL_NAME) +
      truncate(modelSummary(p), COL_MODEL - 1).padEnd(COL_MODEL) +
      truncate(p.anthropic_base_url ?? '', 40).padEnd(COL_URL) +
      truncate(p.health_check_url ?? '', 40).padEnd(COL_HEALTH) +
      roles.padEnd(COL_ROLES);
    process.stdout.write(row + '\n');
  }

  if (config.provider_for_planning) {
    process.stdout.write(`\nPlanning default: ${config.provider_for_planning}\n`);
  }
  if (config.provider_for_phases) {
    process.stdout.write(`Phase default:    ${config.provider_for_phases}\n`);
  }
}

export async function providerAddCommand(): Promise<void> {
  const config = readConfig();
  if (!config.providers) config.providers = [];

  let name: string;
  while (true) {
    process.stdout.write('Name: ');
    name = readLine();
    if (!name) {
      process.stdout.write('Name is required.\n');
      continue;
    }
    if (config.providers.find(p => p.name === name)) {
      process.stdout.write(`Provider '${name}' already exists. Choose a different name.\n`);
      continue;
    }
    break;
  }

  process.stdout.write('Base URL (e.g. http://localhost:11434; Enter for default Anthropic): ');
  const baseUrl = readLine();

  process.stdout.write('API key (Enter to skip): ');
  const apiKey = readLine();

  process.stdout.write('Auth token (Enter to skip): ');
  const authToken = readLine();

  // Model catalogue: offer to fetch it from the endpoint, else collect manually.
  let models: string[] = [];
  let fetchedEndpoint: string | undefined;
  if (baseUrl || apiKey || authToken) {
    process.stdout.write('Fetch the model list from the provider automatically? [Y/n]: ');
    const wantFetch = readLine().toLowerCase() !== 'n';
    if (wantFetch) {
      process.stdout.write('Fetching models…\n');
      const result = await fetchProviderModels(baseUrl, { apiKey, authToken });
      if (result && result.models.length) {
        models = result.models;
        fetchedEndpoint = result.endpoint;
        const preview = models.slice(0, 8).join(', ');
        process.stdout.write(`  Found ${models.length} model${models.length === 1 ? '' : 's'} (via ${result.endpoint}): ${preview}${models.length > 8 ? ', …' : ''}\n`);
      } else {
        process.stdout.write('  Could not fetch models from the provider — enter them manually.\n');
      }
    }
  }
  if (models.length === 0) {
    process.stdout.write('Models this endpoint serves, comma-separated (Enter to skip): ');
    models = readLine().split(',').map(s => s.trim()).filter(Boolean);
  }

  let defaultModel = '';
  if (models.length === 1) {
    defaultModel = models[0]!;
  } else if (models.length > 1) {
    process.stdout.write(`Default model [${models[0]}]: `);
    defaultModel = readLine() || models[0]!;
  }

  // Auto-guess the health check from the model endpoint that responded (it is,
  // by definition, reachable). Stored as a base-relative path when possible.
  let healthUrl: string;
  if (fetchedEndpoint) {
    healthUrl = healthCheckPath(baseUrl, fetchedEndpoint);
    process.stdout.write(`Health check: ${healthUrl} (auto-detected — Enter to keep, or type another / 'none'): `);
    const override = readLine();
    if (override.toLowerCase() === 'none') healthUrl = '';
    else if (override) healthUrl = override;
  } else {
    process.stdout.write('Health check URL (Enter to skip) (full URL or path relative to base URL): ');
    healthUrl = readLine();
  }

  process.stdout.write('Set as default for planning sessions? [y/N]: ');
  const forPlanning = readLine().toLowerCase() === 'y';

  process.stdout.write('Set as default for phase/single-prompt sessions? [y/N]: ');
  const forPhases = readLine().toLowerCase() === 'y';

  const entry: ProviderEntry = { name };
  if (models.length) entry.models = models;
  if (defaultModel) entry.default_model = defaultModel;
  if (baseUrl) entry.anthropic_base_url = baseUrl;
  if (apiKey) entry.anthropic_api_key = apiKey;
  if (authToken) entry.anthropic_auth_token = authToken;
  if (healthUrl) entry.health_check_url = healthUrl;

  config.providers.push(entry);
  if (forPlanning) config.provider_for_planning = name;
  if (forPhases) config.provider_for_phases = name;

  writeConfig(config);
  process.stdout.write(`Provider '${name}' added.\n`);
}

/**
 * Re-fetch the model catalogue for one or all providers and update `models[]`.
 * Replaces the stored list with what the endpoint now reports, summarising what
 * was added/removed. Providers with nothing to query (no base URL and no key)
 * are skipped; the default model is left alone but flagged if it disappeared.
 */
export async function providerRefreshCommand(options?: { provider?: string }): Promise<void> {
  const config = readConfig();
  const providers = config.providers ?? [];

  if (providers.length === 0) {
    process.stdout.write("No providers configured. Use 'cpe provider add' to add one.\n");
    return;
  }

  let targets: ProviderEntry[];
  if (options?.provider) {
    const found = providers.find(p => p.name === options.provider);
    if (!found) {
      process.stderr.write(`Provider '${options.provider}' not found.\n`);
      process.exit(1);
    }
    targets = [found];
  } else {
    targets = providers;
  }

  let changed = false;
  for (const p of targets) {
    if (!p.anthropic_base_url && !p.anthropic_api_key && !p.anthropic_auth_token) {
      process.stdout.write(`  ${p.name}: skipped (no endpoint or key to query)\n`);
      continue;
    }
    const result = await fetchProviderModels(p.anthropic_base_url, modelFetchAuth(p));
    if (!result || result.models.length === 0) {
      process.stdout.write(`  ${p.name}: ✗ could not fetch models\n`);
      continue;
    }
    const before = new Set(p.models ?? []);
    const added = result.models.filter(m => !before.has(m));
    const removed = [...before].filter(m => !result.models.includes(m));
    p.models = result.models;
    changed = true;

    const parts = [`${result.models.length} models`];
    if (added.length) parts.push(`+${added.length} new`);
    if (removed.length) parts.push(`-${removed.length} removed`);
    process.stdout.write(`  ${p.name}: ${parts.join(', ')}\n`);
    if (added.length) process.stdout.write(`      new: ${added.join(', ')}\n`);
    const def = entryDefaultModel(p);
    if (def && !result.models.includes(def)) {
      process.stdout.write(`      ⚠ default model '${def}' is no longer offered — update it with 'cpe provider add' or edit the config.\n`);
    }
  }

  if (changed) {
    writeConfig(config);
    process.stdout.write('Updated provider config.\n');
  } else {
    process.stdout.write('No changes.\n');
  }
}

export async function providerRemoveCommand(name: string): Promise<void> {
  const config = readConfig();
  const providers = config.providers ?? [];
  const idx = providers.findIndex(p => p.name === name);

  if (idx === -1) {
    process.stderr.write(`Provider '${name}' not found.\n`);
    process.exit(1);
  }

  config.providers = providers.filter(p => p.name !== name);
  if (config.provider_for_planning === name) delete config.provider_for_planning;
  if (config.provider_for_phases === name) delete config.provider_for_phases;

  writeConfig(config);
  process.stdout.write(`Provider '${name}' removed.\n`);
}

export async function providerTestCommand(name?: string): Promise<void> {
  const config = readConfig();
  const providers = config.providers ?? [];

  if (providers.length === 0) {
    process.stdout.write('No providers configured.\n');
    return;
  }

  let targets: ProviderEntry[];
  if (name) {
    const found = providers.find(p => p.name === name);
    if (!found) {
      process.stderr.write(`Provider '${name}' not found.\n`);
      process.exit(1);
    }
    targets = [found];
  } else {
    targets = providers;
  }

  for (const provider of targets) {
    // litellm entries default to the gateway's readiness probe (see checkProvider).
    const healthUrl = provider.health_check_url
      ?? (provider.type === 'litellm' ? '/health/readiness' : undefined);
    if (!healthUrl) {
      process.stdout.write(`  ${provider.name}: (no check — assumed available)\n`);
      continue;
    }
    const ok = await checkProvider(provider);
    const url = healthUrl;
    if (ok) {
      process.stdout.write(`  ${provider.name}: ✓ available  [${url}]\n`);
    } else {
      process.stdout.write(`  ${provider.name}: ✗ unavailable  [${url}]\n`);
    }
  }
}
