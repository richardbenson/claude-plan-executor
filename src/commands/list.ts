import * as path from 'path';
import { readQueue } from '../storage/queue.js';
import { readMeta, listAllRunIds } from '../storage/meta.js';
import type { RunMeta } from '../types/meta.js';

const GAP = '  ';
const ACTIVE_STATUSES = new Set(['executing', 'finalising', 'retrying', 'paused', 'paused-limit']);
const TERMINAL_STATUSES = new Set(['complete', 'pr-created', 'failed']);

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

function latestCompletedAt(run: RunMeta): number {
  return run.phases.reduce((max, p) =>
    p.completed_at ? Math.max(max, new Date(p.completed_at).getTime()) : max, 0);
}

export async function listCommand(): Promise<void> {
  const queue = readQueue();

  const runMap = new Map<string, RunMeta>();
  for (const id of listAllRunIds()) {
    try {
      const meta = readMeta(id);
      if (meta.status !== 'archived') runMap.set(id, meta);
    } catch { /* skip */ }
  }

  const activeList = [...runMap.values()].filter(r => ACTIVE_STATUSES.has(r.status));
  const queuedList = queue.entries
    .filter(e => runMap.has(e.run_id) && runMap.get(e.run_id)!.status === 'queued')
    .map(e => runMap.get(e.run_id)!);
  const finishedList = [...runMap.values()]
    .filter(r => TERMINAL_STATUSES.has(r.status))
    .sort((a, b) => latestCompletedAt(b) - latestCompletedAt(a));

  if (activeList.length + queuedList.length + finishedList.length === 0) {
    console.log('No runs found.');
    return;
  }

  type Row = [string, string, string, string, string, string];
  const rows: Row[] = [];

  for (const meta of activeList) {
    const shortId = meta.id.slice(0, 8) + '…';
    const repoName = path.basename(meta.primary_repo_path);
    const completedPhases = meta.phases.filter(p => p.status === 'complete').length;
    rows.push(['-', shortId, repoName, meta.plan_folder, meta.status, `${completedPhases}/${meta.phases.length}`]);
  }

  let pos = 1;
  for (const meta of queuedList) {
    const shortId = meta.id.slice(0, 8) + '…';
    const repoName = path.basename(meta.primary_repo_path);
    const completedPhases = meta.phases.filter(p => p.status === 'complete').length;
    rows.push([String(pos++), shortId, repoName, meta.plan_folder, meta.status, `${completedPhases}/${meta.phases.length}`]);
  }

  for (const meta of finishedList) {
    const shortId = meta.id.slice(0, 8) + '…';
    const repoName = path.basename(meta.primary_repo_path);
    const completedPhases = meta.phases.filter(p => p.status === 'complete').length;
    const glyph = meta.status === 'failed' ? '✕' : '✓';
    rows.push([glyph, shortId, repoName, meta.plan_folder, meta.status, `${completedPhases}/${meta.phases.length}`]);
  }

  const headers: Row = ['#', 'ID', 'REPO', 'PLAN', 'STATUS', 'PHASES'];
  const mins = [2, 9, 10, 10, 10, 6];
  const widths = headers.map((h, i) =>
    Math.max(mins[i]!, h.length, ...rows.map(r => r[i]!.length)),
  );

  const fmt = (row: Row) =>
    row.slice(0, -1).map((cell, i) => pad(cell, widths[i]!)).join(GAP) + GAP + row[5]!;

  console.log(fmt(headers));
  console.log('-'.repeat(widths.slice(0, -1).reduce((s, w) => s + w + GAP.length, 0) + widths[5]!));
  for (const row of rows) console.log(fmt(row));
}
