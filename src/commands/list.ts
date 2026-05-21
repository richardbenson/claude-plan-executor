import * as path from 'path';
import { readQueue } from '../storage/queue.js';
import { readMeta } from '../storage/meta.js';

const GAP = '  ';

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

export async function listCommand(): Promise<void> {
  const queue = readQueue();
  if (queue.entries.length === 0) {
    console.log('Queue is empty.');
    return;
  }

  type Row = [string, string, string, string, string, string];
  const rows: Row[] = [];

  for (let i = 0; i < queue.entries.length; i++) {
    const entry = queue.entries[i]!;
    let meta;
    try {
      meta = readMeta(entry.run_id);
    } catch {
      continue;
    }

    const shortId = entry.run_id.slice(0, 8) + '…';
    const repoName = path.basename(meta.primary_repo_path);
    const completedPhases = meta.phases.filter(p => p.status === 'complete').length;
    const totalPhases = meta.phases.length;

    rows.push([String(i + 1), shortId, repoName, meta.plan_folder, meta.status, `${completedPhases}/${totalPhases}`]);
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
