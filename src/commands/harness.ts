import { readConfig, writeConfig } from '../storage/config.js';
import { detectAll, ensureHarnessDetection, consoleDetectProgress } from '../harness/detect.js';
import type { HarnessStatus } from '../types/meta.js';

const COL_NAME = 16;
const COL_INSTALLED = 11;
const COL_VERSION = 12;
const COL_PATHURL = 48;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function printTable(statuses: HarnessStatus[]): void {
  const header =
    'Harness'.padEnd(COL_NAME) +
    'Installed'.padEnd(COL_INSTALLED) +
    'Version'.padEnd(COL_VERSION) +
    'Path / install';
  process.stdout.write(header + '\n');
  process.stdout.write('-'.repeat(header.length + COL_PATHURL - 'Path / install'.length) + '\n');

  for (const s of [...statuses].sort((a, b) => a.name.localeCompare(b.name))) {
    const installed = s.installed ? 'yes' : 'no';
    const pathOrHint = s.installed ? (s.path ?? '') : '(not on PATH)';
    process.stdout.write(
      s.name.padEnd(COL_NAME) +
        installed.padEnd(COL_INSTALLED) +
        (s.version ?? '—').padEnd(COL_VERSION) +
        truncate(pathOrHint, COL_PATHURL) +
        '\n',
    );
  }
}

/** `cpe harness check` — (re)probe every harness, persist, and print the table. */
export async function harnessCheckCommand(): Promise<void> {
  const config = readConfig();
  const statuses = detectAll(consoleDetectProgress);
  writeConfig({ ...config, harnesses: statuses });
  process.stdout.write('\n');
  printTable(statuses);
  const missing = statuses.filter(s => s.bin && !s.installed).length;
  process.stdout.write(
    `\nChecked ${statuses.length} harnesses; ${statuses.length - missing} installed, ${missing} missing.\n`,
  );
}

/** `cpe harness list` — print stored detection (running it once if absent). */
export async function harnessListCommand(): Promise<void> {
  const config = ensureHarnessDetection(readConfig());
  printTable(config.harnesses ?? []);
}
