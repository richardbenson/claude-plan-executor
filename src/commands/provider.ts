import * as fs from 'fs';
import type { ProviderEntry } from '../types/meta.js';
import { readConfig, writeConfig } from '../storage/config.js';
import { checkProvider } from '../runner/provider.js';

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
      (p.model ?? '').padEnd(COL_MODEL) +
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

  process.stdout.write('Model (Enter to skip): ');
  const model = readLine();

  process.stdout.write('ANTHROPIC_BASE_URL (Enter to skip): ');
  const baseUrl = readLine();

  process.stdout.write('ANTHROPIC_API_KEY (Enter to skip): ');
  const apiKey = readLine();

  process.stdout.write('ANTHROPIC_AUTH_TOKEN (Enter to skip): ');
  const authToken = readLine();

  process.stdout.write('Health check URL (Enter to skip) (full URL or path relative to base URL): ');
  const healthUrl = readLine();

  process.stdout.write('Set as default for planning sessions? [y/N]: ');
  const forPlanning = readLine().toLowerCase() === 'y';

  process.stdout.write('Set as default for phase/single-prompt sessions? [y/N]: ');
  const forPhases = readLine().toLowerCase() === 'y';

  const entry: ProviderEntry = { name };
  if (model) entry.model = model;
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
    if (!provider.health_check_url) {
      process.stdout.write(`  ${provider.name}: (no check — assumed available)\n`);
      continue;
    }
    const ok = await checkProvider(provider);
    const url = provider.health_check_url;
    if (ok) {
      process.stdout.write(`  ${provider.name}: ✓ available  [${url}]\n`);
    } else {
      process.stdout.write(`  ${provider.name}: ✗ unavailable  [${url}]\n`);
    }
  }
}
