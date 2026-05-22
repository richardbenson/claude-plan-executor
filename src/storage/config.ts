import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type AppConfig, DEFAULT_CONFIG, type SandboxConfig } from '../types/meta.js';

export const DEFAULT_SANDBOX: SandboxConfig = {
  enabled: true,
  allowedDomains: [
    'api.anthropic.com',
    'github.com',
    'api.github.com',
    '*.actions.githubusercontent.com',
    '*.blob.core.windows.net',
    'registry.npmjs.org',
    'pypi.org',
  ],
};

export const CONFIG_PATH = path.join(os.homedir(), '.config', 'cpe', 'config.json');

export function readConfig(): AppConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as AppConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: AppConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}
