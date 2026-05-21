import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type RunMeta, type PhaseEntry } from '../types/meta.js';

const STATE_BASE = path.join(os.homedir(), '.local', 'state', 'cpe');

function runsBase(base?: string): string {
  return path.join(base ?? STATE_BASE, 'runs');
}

export function getMetaPath(runId: string, base?: string): string {
  return path.join(runsBase(base), runId, 'meta.json');
}

export function getLogsDir(runId: string, base?: string): string {
  return path.join(runsBase(base), runId, 'logs');
}

export function readMeta(runId: string, base?: string): RunMeta {
  return JSON.parse(fs.readFileSync(getMetaPath(runId, base), 'utf8')) as RunMeta;
}

export function writeMeta(runId: string, meta: RunMeta, base?: string): void {
  const p = getMetaPath(runId, base);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(meta, null, 2) + '\n');
}

export function updateMeta(runId: string, partial: Partial<RunMeta>, base?: string): RunMeta {
  const meta = readMeta(runId, base);
  const updated = { ...meta, ...partial };
  writeMeta(runId, updated, base);
  return updated;
}

export function listAllRunIds(base?: string): string[] {
  const dir = runsBase(base);
  try {
    return fs.readdirSync(dir).filter(name =>
      fs.existsSync(path.join(dir, name, 'meta.json')),
    );
  } catch {
    return [];
  }
}

export function updatePhase(
  runId: string,
  phaseNumber: number,
  partial: Partial<PhaseEntry>,
  base?: string,
): RunMeta {
  const meta = readMeta(runId, base);
  const phases = meta.phases.map(p =>
    p.number === phaseNumber ? { ...p, ...partial } : p,
  );
  const updated = { ...meta, phases };
  writeMeta(runId, updated, base);
  return updated;
}

export function extractPhaseTitle(
  worktreePath: string,
  planFolder: string,
  promptFile: string,
): string | undefined {
  const docName = promptFile.replace('.prompt.md', '.md');
  const docPath = path.join(worktreePath, 'docs', planFolder, docName);
  try {
    const content = fs.readFileSync(docPath, 'utf8');
    const m = content.match(/^#{1,4}\s+Phase\s+\d+\s+—\s+(.+)$/m);
    return m?.[1]?.trim();
  } catch {
    return undefined;
  }
}
