import { listAllRunIds, readMeta } from '../storage/meta.js';
import { activityBus } from './bus.js';

const LOOKBACK_MS = 18 * 60 * 60 * 1000; // match the sparkline's 18-hour window

export function seedBusFromHistory(): void {
  const cutoff = Date.now() - LOOKBACK_MS;

  type SyntheticOk = { timestamp: Date; runId: string; phaseNumber: number; summary: string; costUsd: number };
  const events: SyntheticOk[] = [];

  for (const id of listAllRunIds()) {
    try {
      const meta = readMeta(id);
      for (const phase of meta.phases) {
        if (!phase.completed_at) continue;
        const ts = new Date(phase.completed_at).getTime();
        if (ts < cutoff) continue;
        events.push({
          timestamp: new Date(phase.completed_at),
          runId: id,
          phaseNumber: phase.number,
          summary: phase.summary ?? '',
          costUsd: phase.cost_usd ?? 0,
        });
      }
    } catch {
      // skip unreadable metas
    }
  }

  // Emit oldest-first so the ring buffer retains the most recent if it overflows
  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  for (const ev of events) {
    activityBus.emit({ kind: 'ok', ...ev });
  }
}
