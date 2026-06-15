import * as fs from 'fs';
import type { ActivityBus } from '../events/bus.js';

/**
 * Generic, harness-agnostic tail over a run's log / stdout file.
 *
 * Unlike `jsonl-tail.ts` (which parses claude's structured JSONL), this reader
 * makes no assumptions about content: it emits every appended line as a raw
 * `output` activity event. It is the live-output source for opaque harnesses,
 * and — crucially — the SAME signal the Phase 04 activity-timeout consumes (the
 * bench dispatch subscribes to the bus and treats each event for the run as
 * activity), so a slow-but-progressing opaque harness is not killed. We do not
 * build a second reader for the timeout.
 *
 * Poll-based by design: the log file is appended to by a separate process and
 * may not exist yet when the tail starts, and `fs.watch` on appended files is
 * unreliable across platforms (notably WSL). Polling the size from an offset is
 * simple and robust.
 */
export function startOutputTail(
  logPath: string,
  runId: string,
  phaseNumber: number,
  bus: ActivityBus,
  opts?: { intervalMs?: number },
): () => void {
  const intervalMs = opts?.intervalMs ?? 250;
  let offset = 0;
  let partial = '';
  let stopped = false;

  const pump = (): void => {
    if (stopped) return;
    let fd: number;
    try {
      fd = fs.openSync(logPath, 'r');
    } catch {
      return; // not created yet, or transiently unreadable
    }
    try {
      const stat = fs.fstatSync(fd);
      // File truncated/rotated under us — restart from the top.
      if (stat.size < offset) {
        offset = 0;
        partial = '';
      }
      const newBytes = stat.size - offset;
      if (newBytes <= 0) return;
      const buf = Buffer.allocUnsafe(newBytes);
      fs.readSync(fd, buf, 0, newBytes, offset);
      offset = stat.size;
      const text = partial + buf.toString('utf8');
      const lines = text.split('\n');
      partial = lines.pop() ?? ''; // last element may be a partial line
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        if (!line.trim()) continue;
        bus.emit({ kind: 'output', timestamp: new Date(), runId, phaseNumber, line });
      }
    } catch {
      // ignore transient read errors; the next tick retries
    } finally {
      fs.closeSync(fd);
    }
  };

  const timer = setInterval(pump, intervalMs);

  return () => {
    if (stopped) return;
    clearInterval(timer);
    pump(); // final flush of anything appended since the last tick
    stopped = true;
  };
}
