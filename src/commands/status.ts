import { readQueue } from '../storage/queue.js';
import { readMeta } from '../storage/meta.js';

export async function statusCommand(): Promise<void> {
  const queue = readQueue();
  if (queue.entries.length === 0) {
    console.log('Queue is empty. Run `cpe queue` to add a plan.');
    return;
  }

  let executing = 0;
  let queued = 0;
  let paused = 0;
  let totalPhases = 0;
  let completedPhases = 0;
  let pendingPhases = 0;

  for (const entry of queue.entries) {
    let meta;
    try {
      meta = readMeta(entry.run_id);
    } catch {
      continue;
    }

    if (meta.status === 'executing') executing++;
    else if (meta.status === 'queued') queued++;
    else if (meta.status === 'paused') paused++;

    for (const phase of meta.phases ?? []) {
      totalPhases++;
      if (phase.status === 'complete') completedPhases++;
      else if (phase.status === 'pending') pendingPhases++;
    }
  }

  const total = queue.entries.length;
  console.log(`Queue: ${total} run(s) — ${executing} executing, ${queued} queued, ${paused} paused`);
  console.log(`Total phases: ${totalPhases} (${completedPhases} complete, ${pendingPhases} pending)`);
}
