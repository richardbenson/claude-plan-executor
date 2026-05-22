import * as fs from 'fs';
import { readQueue, removeFromQueue } from '../storage/queue.js';
import { readMeta, updateMeta } from '../storage/meta.js';

function readLine(): string {
  const buf = Buffer.alloc(256);
  let total = 0;
  while (true) {
    const n = fs.readSync(0, buf, total, 1, null);
    if (n === 0) break;
    if (buf[total] === 0x0a) break; // newline
    total += n;
  }
  return buf.slice(0, total).toString('utf8').trim();
}

export async function removeCommand(runId: string): Promise<void> {
  const queue = readQueue();
  const prefix = runId.slice(0, 8);
  const entry = queue.entries.find(e => e.run_id.startsWith(prefix));

  if (!entry) {
    console.error(`Run not found: ${runId}`);
    process.exit(1);
  }

  let meta;
  try {
    meta = readMeta(entry.run_id);
  } catch {
    console.error(`Could not read meta for run ${entry.run_id}`);
    process.exit(1);
  }

  if (meta.status === 'executing') {
    console.error(
      'Cannot remove an actively executing run. Use K from the TUI to kill the session first.',
    );
    process.exit(1);
  }

  const shortId = entry.run_id.slice(0, 8);
  process.stdout.write(`Remove run ${shortId} (${meta.plan_folder ?? ''}) from the queue? [y/N] `);
  const answer = readLine();

  if (answer.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    return;
  }

  removeFromQueue(entry.run_id);
  updateMeta(entry.run_id, { status: 'failed' });
  console.log('Removed.');
}
