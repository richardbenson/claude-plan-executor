import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type AppQueue } from '../types/meta.js';

const STATE_BASE = path.join(os.homedir(), '.local', 'state', 'cpe');
export const QUEUE_PATH = path.join(STATE_BASE, 'queue.json');

function resolveQueuePath(base?: string): string {
  return base ? path.join(base, 'queue.json') : QUEUE_PATH;
}

export function readQueue(base?: string): AppQueue {
  try {
    return JSON.parse(fs.readFileSync(resolveQueuePath(base), 'utf8')) as AppQueue;
  } catch {
    return { entries: [], paused: false };
  }
}

export function writeQueue(queue: AppQueue, base?: string): void {
  const p = resolveQueuePath(base);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(queue, null, 2) + '\n');
}

export function enqueue(runId: string, base?: string): void {
  const queue = readQueue(base);
  queue.entries.push({ run_id: runId, added_at: new Date().toISOString() });
  writeQueue(queue, base);
}

export function enqueueFront(runId: string, base?: string): void {
  const queue = readQueue(base);
  queue.entries.unshift({ run_id: runId, added_at: new Date().toISOString() });
  writeQueue(queue, base);
}

export function dequeue(base?: string): string | null {
  const queue = readQueue(base);
  const first = queue.entries.shift();
  if (!first) return null;
  writeQueue(queue, base);
  return first.run_id;
}

export function removeFromQueue(runId: string, base?: string): boolean {
  const queue = readQueue(base);
  const before = queue.entries.length;
  queue.entries = queue.entries.filter(e => e.run_id !== runId);
  if (queue.entries.length === before) return false;
  writeQueue(queue, base);
  return true;
}

export function isQueuePaused(base?: string): boolean {
  return readQueue(base).paused;
}
