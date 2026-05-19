import * as fs from 'fs';
import * as path from 'path';
import { getPrimaryRepo } from '../git/repo.js';
import {
  readRepoConfig,
  writeRepoConfig,
  ensureRepoConfig,
  REPO_CONFIG_FILENAME,
  type RepoConfig,
} from '../config/repo-config.js';
import { BOOTSTRAP_DETECT_SCHEMA_PATH, BOOTSTRAP_DETECT_PROMPT } from '../prompts/index.js';
import type { BootstrapDetectResult } from '../config/repo-config.js';

interface BootstrapFlags {
  detect?: boolean;
  stub?: boolean;
  edit?: boolean;
}

function openInEditor(filePath: string): void {
  const editor = process.env['EDITOR'];
  if (!editor) return;
  Bun.spawnSync([editor, filePath], { stdio: ['inherit', 'inherit', 'inherit'] });
}

async function runDetect(repoPath: string): Promise<RepoConfig> {
  process.stdout.write('Detecting bootstrap commands...\n');
  const proc = Bun.spawn(
    ['claude', '-p', '--output-format=json', '--json-schema', BOOTSTRAP_DETECT_SCHEMA_PATH],
    {
      cwd: repoPath,
      stdin: new TextEncoder().encode(BOOTSTRAP_DETECT_PROMPT),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  const result = JSON.parse(output) as BootstrapDetectResult;

  process.stdout.write('\nSuggested commands:\n');
  result.commands.forEach(cmd => process.stdout.write(`  ${cmd}\n`));
  process.stdout.write(`\nFiles inspected: ${result.inspected_files.join(', ')}\n`);
  process.stdout.write(`Reasoning: ${result.reasoning}\n`);
  if (result.blockers?.length) {
    result.blockers.forEach(b => process.stdout.write(`  - ${b}\n`));
  }

  const config: RepoConfig = { bootstrap: result.commands };
  writeRepoConfig(repoPath, config);
  process.stdout.write('Saved cpe.config.json.\n');
  return config;
}

export async function bootstrapCommand(flags: BootstrapFlags): Promise<void> {
  const repoPath = getPrimaryRepo();

  if (flags.detect) {
    await runDetect(repoPath);
    return;
  }

  if (flags.stub) {
    const stubConfig: RepoConfig = { bootstrap: [] };
    writeRepoConfig(repoPath, stubConfig);
    process.stdout.write('Wrote stub cpe.config.json.\n');
    openInEditor(path.join(repoPath, REPO_CONFIG_FILENAME));
    return;
  }

  if (flags.edit) {
    const configPath = path.join(repoPath, REPO_CONFIG_FILENAME);
    if (!fs.existsSync(configPath)) {
      const stubConfig: RepoConfig = { bootstrap: [] };
      writeRepoConfig(repoPath, stubConfig);
    }
    openInEditor(configPath);
    return;
  }

  // No flags — always show menu, overwrite if exists
  const existing = readRepoConfig(repoPath);
  if (existing) {
    // Remove so ensureRepoConfig triggers the prompt
    fs.unlinkSync(path.join(repoPath, REPO_CONFIG_FILENAME));
  }
  await ensureRepoConfig(repoPath);
}
