import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readQueue } from '../storage/queue.js';
import { readMeta } from '../storage/meta.js';
import type { RunStatus } from '../types/state.js';

const GAP = '  ';
const ACTIVE_STATUSES = new Set<RunStatus>(['executing', 'retrying', 'paused-limit', 'paused', 'finalising']);

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

function listActiveRunIds(): string[] {
  const runsDir = path.join(os.homedir(), '.local', 'state', 'cpe', 'runs');
  try {
    return fs.readdirSync(runsDir).filter(name => {
      try {
        const meta = readMeta(name);
        return ACTIVE_STATUSES.has(meta.status as RunStatus);
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

export async function listCommand(): Promise<void> {
  const queue = readQueue();
  const activeRunIds = listActiveRunIds();
  const queuedIds = new Set(queue.entries.map(e => e.run_id));

  type Row = [string, string, string, string, string, string];
  const rows: Row[] = [];

  // Active (dequeued, currently running) — shown first with position marker '-'
  for (const runId of activeRunIds) {
    let meta;
    try { meta = readMeta(runId); } catch { continue; }
    const shortId = runId.slice(0, 8) + '…';
    const repoName = path.basename(meta.primary_repo_path);
    const completedPhases = meta.phases.filter(p => p.status === 'complete').length;
    rows.push(['-', shortId, repoName, meta.plan_folder, meta.status, `${completedPhases}/${meta.phases.length}`]);
  }

  // Queued (waiting)
  let pos = 1;
  for (const entry of queue.entries) {
    if (queuedIds.has(entry.run_id) && !activeRunIds.includes(entry.run_id)) {
      let meta;
      try { meta = readMeta(entry.run_id); } catch { continue; }
      const shortId = entry.run_id.slice(0, 8) + '…';
      const repoName = path.basename(meta.primary_repo_path);
      const completedPhases = meta.phases.filter(p => p.status === 'complete').length;
      rows.push([String(pos++), shortId, repoName, meta.plan_folder, meta.status, `${completedPhases}/${meta.phases.length}`]);
    }
  }

  if (rows.length === 0) {
    console.log('Queue is empty.');
    return;
  }

  const headers: Row = ['#', 'ID', 'REPO', 'PLAN', 'STATUS', 'PHASES'];
  const mins = [2, 9, 10, 10, 8, 6];
  const widths = headers.map((h, i) =>
    Math.max(mins[i]!, h.length, ...rows.map(r => r[i]!.length)),
  );

  const fmt = (row: Row) =>
    row.slice(0, -1).map((cell, i) => pad(cell, widths[i]!)).join(GAP) + GAP + row[5]!;

  console.log(fmt(headers));
  console.log('-'.repeat(widths.slice(0, -1).reduce((s, w) => s + w + GAP.length, 0) + widths[5]!));
  for (const row of rows) console.log(fmt(row));
}
