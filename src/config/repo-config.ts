import * as fs from 'fs';
import * as path from 'path';
import { BOOTSTRAP_DETECT_SCHEMA, BOOTSTRAP_DETECT_PROMPT } from '../prompts/index.js';

export const REPO_CONFIG_FILENAME = 'cpe.config.json';

export interface RepoConfig {
  bootstrap: string[];
  sandbox?: import('../types/meta.js').SandboxConfig;
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

export async function runBootstrap(
  worktreePath: string,
  commands: string[],
  logPath: string,
): Promise<BootstrapRunResult> {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFile = fs.openSync(logPath, 'w');

  try {
    for (const cmd of commands) {
      const parts = cmd.split(/\s+/);
      const proc = Bun.spawn(parts, {
        cwd: worktreePath,
        stdout: logFile,
        stderr: logFile,
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        return { success: false, failedCommand: cmd, exitCode };
      }
    }
  } finally {
    fs.closeSync(logFile);
  }

  return { success: true };
}

export async function detectBootstrap(repoPath: string): Promise<BootstrapDetectResult> {
  const proc = Bun.spawn(
    ['claude', '-p', '--output-format=json', '--json-schema', BOOTSTRAP_DETECT_SCHEMA],
    {
      cwd: repoPath,
      stdin: new TextEncoder().encode(BOOTSTRAP_DETECT_PROMPT),
      stdout: 'pipe',
      stderr: 'pipe',
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

export async function ensureRepoConfig(repoPath: string, _giteaHost?: string): Promise<RepoConfig> {
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
      result = await detectBootstrap(repoPath);
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
