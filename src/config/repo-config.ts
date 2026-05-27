import * as fs from 'fs';
import * as path from 'path';
import { BOOTSTRAP_DETECT_SCHEMA, BOOTSTRAP_DETECT_PROMPT } from '../prompts/index.js';
import type { ResolvedProvider } from '../runner/provider.js';

export const REPO_CONFIG_FILENAME = 'cpe.config.json';

export interface RepoConfig {
  bootstrap: string[];
  sandbox?: import('../types/meta.js').SandboxConfig;
  dangerously_skip_permissions?: boolean;
  providers?: import('../types/meta.js').ProviderEntry[];
  provider_for_planning?: string;
  provider_for_phases?: string;
}

export interface BootstrapDetectResult {
  commands: string[];
  inspected_files: string[];
  reasoning: string;
  blockers?: string[];
}

export interface BootstrapRunResult {
  success: boolean;
  failedCommand?: string;
  exitCode?: number;
}

export function readRepoConfig(repoPath: string): RepoConfig | null {
  const filePath = path.join(repoPath, REPO_CONFIG_FILENAME);
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text) as RepoConfig;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export function writeRepoConfig(repoPath: string, config: RepoConfig): void {
  const filePath = path.join(repoPath, REPO_CONFIG_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
}

async function drainStream(
  stream: ReadableStream<Uint8Array>,
  fd: number,
  onLine?: (line: string) => void,
): Promise<void> {
  const dec = new TextDecoder();
  let partial = '';
  for await (const chunk of stream) {
    const text = partial + dec.decode(chunk, { stream: true });
    const lines = text.split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) {
      fs.writeSync(fd, line + '\n');
      onLine?.(line);
    }
  }
  if (partial) {
    fs.writeSync(fd, partial);
    onLine?.(partial);
  }
}

export async function runBootstrap(
  worktreePath: string,
  commands: string[],
  logPath: string,
  onCommand?: (cmd: string) => void,
  onLine?: (line: string) => void,
): Promise<BootstrapRunResult> {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'w');

  try {
    for (const cmd of commands) {
      onCommand?.(cmd);
      if (onLine) {
        const proc = Bun.spawn(['sh', '-c', cmd], {
          cwd: worktreePath,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [exitCode] = await Promise.all([
          proc.exited,
          drainStream(proc.stdout, fd, onLine),
          drainStream(proc.stderr, fd, onLine),
        ]);
        if (exitCode !== 0) {
          return { success: false, failedCommand: cmd, exitCode };
        }
      } else {
        const proc = Bun.spawn(['sh', '-c', cmd], {
          cwd: worktreePath,
          stdout: fd,
          stderr: fd,
        });
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          return { success: false, failedCommand: cmd, exitCode };
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return { success: true };
}

export async function detectBootstrap(repoPath: string, provider?: ResolvedProvider | null): Promise<BootstrapDetectResult> {
  const providerEnv = provider?.env ?? {};
  const spawnEnv = Object.keys(providerEnv).length > 0
    ? { ...process.env, ...providerEnv }
    : undefined;
  const modelArgs = provider?.modelArgs ?? [];

  const proc = Bun.spawn(
    ['claude', '-p', '--output-format=json', '--json-schema', BOOTSTRAP_DETECT_SCHEMA, ...modelArgs],
    {
      cwd: repoPath,
      stdin: new TextEncoder().encode(BOOTSTRAP_DETECT_PROMPT),
      stdout: 'pipe',
      stderr: 'pipe',
      ...(spawnEnv ? { env: spawnEnv } : {}),
    },
  );

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  const envelope = JSON.parse(output) as { structured_output: BootstrapDetectResult };
  return envelope.structured_output;
}

function readLine(): string {
  const buf = Buffer.alloc(1024);
  let total = 0;
  while (true) {
    const n = fs.readSync(0, buf, total, 1, null);
    if (n === 0) break;
    if (buf[total] === 0x0a) break; // newline consumed, not included
    total += n;
  }
  return buf.slice(0, total).toString('utf8').trim();
}

function openInEditor(filePath: string): void {
  const editor = process.env['EDITOR'];
  if (!editor) return;
  const proc = Bun.spawnSync([editor, filePath], { stdio: ['inherit', 'inherit', 'inherit'] });
  if (proc.exitCode !== 0) {
    process.stderr.write(`Editor exited with code ${proc.exitCode}\n`);
  }
}

const STUB_CONTENT = `{
  "bootstrap": [],
  "sandbox": {
    "allowedDomains": []
  }
}
`;

export async function ensureRepoConfig(repoPath: string, _giteaHost?: string, provider?: ResolvedProvider | null): Promise<RepoConfig> {
  const existing = readRepoConfig(repoPath);
  if (existing) return existing;

  process.stdout.write('No cpe.config.json found for this repo.\n');
  process.stdout.write('How would you like to set up the bootstrap commands for fresh worktrees?\n');
  process.stdout.write('  1. Detect with Claude (one-off LLM call, ~$0.05)\n');
  process.stdout.write('  2. Create a stub I\'ll fill in myself\n');
  process.stdout.write('  3. Skip — I don\'t need a bootstrap step\n');
  process.stdout.write('Choice [1/2/3]: ');

  const choice = readLine();

  if (choice === '1') {
    process.stdout.write('\nDetecting bootstrap commands...\n');
    let result: BootstrapDetectResult;
    try {
      result = await detectBootstrap(repoPath, provider);
    } catch (err) {
      process.stderr.write(`Detection failed: ${err}\n`);
      return stubAndReturn(repoPath);
    }

    process.stdout.write('\nSuggested commands:\n');
    result.commands.forEach(cmd => process.stdout.write(`  ${cmd}\n`));
    process.stdout.write(`\nFiles inspected: ${result.inspected_files.join(', ')}\n`);
    process.stdout.write(`Reasoning: ${result.reasoning}\n`);
    if (result.blockers?.length) {
      process.stdout.write(`\nBlockers:\n`);
      result.blockers.forEach(b => process.stdout.write(`  - ${b}\n`));
    }

    process.stdout.write('\nSave? [Y/n]: ');
    const answer = readLine();

    if (answer === 'n' || answer === 'N') {
      return stubAndReturn(repoPath);
    } else {
      const config: RepoConfig = { bootstrap: result.commands };
      writeRepoConfig(repoPath, config);
      process.stdout.write(`Config written to ${path.join(repoPath, REPO_CONFIG_FILENAME)}\n`);
      return config;
    }
  } else if (choice === '2') {
    return stubAndReturn(repoPath);
  } else {
    const config: RepoConfig = { bootstrap: [] };
    writeRepoConfig(repoPath, config);
    process.stdout.write('Saved cpe.config.json with empty bootstrap.\n');
    return config;
  }
}

function stubAndReturn(repoPath: string): RepoConfig {
  const filePath = path.join(repoPath, REPO_CONFIG_FILENAME);
  fs.writeFileSync(filePath, STUB_CONTENT);
  openInEditor(filePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as RepoConfig;
  } catch {
    return { bootstrap: [] };
  }
}
