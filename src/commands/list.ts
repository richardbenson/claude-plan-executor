import * as path from 'path';
import { readQueue } from '../storage/queue.js';
import { readMeta } from '../storage/meta.js';

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

export async function listCommand(): Promise<void> {
  const queue = readQueue();
  if (queue.entries.length === 0) {
    console.log('Queue is empty.');
    return;
  }

  const header =
    pad('#', 3) +
    pad('ID', 10) +
    pad('REPO/PLAN', 30) +
    pad('STATUS', 12) +
    'PHASES';
  console.log(header);
  console.log('-'.repeat(70));

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
    const repoPlan = `${repoName}/${meta.plan_folder}`;
    const completedPhases = meta.phases.filter(p => p.status === 'complete').length;
    const totalPhases = meta.phases.length;
    const phaseSummary = `${completedPhases}/${totalPhases}`;

    console.log(
      pad(String(i + 1), 3) +
        pad(shortId, 10) +
        pad(repoPlan, 30) +
        pad(meta.status, 12) +
        phaseSummary,
    );
  }
}
