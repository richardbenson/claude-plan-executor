import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readMeta } from '../storage/meta.js';
import { removeFromQueue } from '../storage/queue.js';
import { removeWorktree } from '../git/worktree.js';

const RUNS_BASE = path.join(os.homedir(), '.local', 'state', 'cpe', 'runs');

function readLine(): string {
  const buf = Buffer.alloc(256);
  let total = 0;
  while (true) {
    const n = fs.readSync(0, buf, total, 1, null);
    if (n === 0) break;
    if (buf[total] === 0x0a) break;
    total += n;
  }
  return buf.slice(0, total).toString('utf8').trim();
}

export async function cleanCommand(options: { all?: boolean }): Promise<void> {
  let runDirs: string[] = [];
  try {
    runDirs = fs.readdirSync(RUNS_BASE);
  } catch {
    console.log('Nothing to clean.');
    return;
  }

  const cleanable: { runId: string; runDir: string; meta: ReturnType<typeof readMeta> }[] = [];

  for (const runId of runDirs) {
    try {
      const meta = readMeta(runId);
      if (meta.status === 'complete' || meta.status === 'pr-created' || meta.status === 'archived' || meta.status === 'failed') {
        cleanable.push({ runId, runDir: path.join(RUNS_BASE, runId), meta });
      }
    } catch {
      // skip unreadable
    }
  }

  if (cleanable.length === 0) {
    console.log('Nothing to clean.');
    return;
  }

  let cleaned = 0;
  for (const { runId, runDir, meta } of cleanable) {
    const shortId = runId.slice(0, 8);

    let shouldClean = options.all;
    if (!options.all) {
      process.stdout.write(
        `Remove worktree for ${meta.plan_folder ?? ''} (run ${shortId})? [y/N] `,
      );
      const answer = readLine();
      shouldClean = answer.toLowerCase() === 'y';
    }

    if (shouldClean) {
      try {
        removeWorktree(meta.primary_repo_path, meta.worktree_path, true);
      } catch {
        // worktree may already be gone
      }
      fs.rmSync(runDir, { recursive: true });
      removeFromQueue(runId);
      console.log(`Cleaned: ${meta.plan_folder ?? ''}`);
      cleaned++;
    }
  }

  console.log(`Cleaned ${cleaned} run(s).`);
}
