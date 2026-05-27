import * as fs from 'fs';
import * as child_process from 'child_process';
import { CPE_VERSION } from '../version.js';

const REPO_OWNER = 'richardbenson';
const REPO_NAME = 'claude-plan-executor';

function compareSemver(a: string, b: string): number {
  const partsA = a.replace(/^v/, '').split('.').map(Number);
  const partsB = b.replace(/^v/, '').split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const va = partsA[i] ?? 0;
    const vb = partsB[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
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

function latestRelease(): Promise<{ tag: string }> {
  return new Promise((resolve, reject) => {
    const env = process.env.GITHUB_TOKEN
      ? { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN }
      : process.env;
    const p = child_process.spawn('gh', [
      'api',
      `repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      '--jq',
      '.tag_name',
    ], {
      env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let data = '';
    p.stdout.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    p.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error('Failed to fetch latest release (gh returned non-zero)'));
      }
      const raw = data.trim();
      if (!raw) return reject(new Error('Unexpected empty release API response'));
      resolve({ tag: raw });
    });
  });
}

function installCommand(): Promise<void> {
  const installUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/refs/heads/main/scripts/install.sh`;
  const curlCmd = `curl -fsSL ${installUrl} | bash`;
  return new Promise((resolve, reject) => {
    const p = child_process.spawn('bash', ['-c', curlCmd], {
      stdio: 'inherit',
    });
    p.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Installation failed (exit code ${code})`));
      }
    });
  });
}

export async function updateCommand(): Promise<void> {
  const current = CPE_VERSION;
  if (current === 'dev') {
    process.stdout.write('cpe is running in dev mode. No version check available.\n');
    return;
  }

  process.stdout.write('Checking for updates...\n');

  try {
    const latest = await latestRelease();
    const compareResult = compareSemver(latest.tag, current);

    if (compareResult <= 0) {
      process.stdout.write(`cpe ${current} is up to date (latest: ${latest.tag}).\n`);
      return;
    }

    process.stdout.write(`\ncpe ${latest.tag} is available (current: ${current}).\n\n`);

    if (!process.stdin.isTTY) {
      process.stdout.write('Run cpe update interactively to install.\n');
      return;
    }

    process.stdout.write('Would you like to update? [y/N]: ');

    const answer = readLine().toLowerCase();
    if (answer === 'y') {
      process.stdout.write('\nUpgrading cpe...\n');
      await installCommand();
      process.stdout.write('cpe updated. Run cpe --version to verify.\n');
    } else {
      process.stdout.write('Skipped.\n');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error checking for updates: ${msg}\n`);
  }
}
