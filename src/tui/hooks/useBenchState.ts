import { useState, useEffect } from 'react';
import { readMeta, listAllRunIds } from '../../storage/meta.js';
import { comboName } from '../../runner/capture.js';
import type { RunMeta } from '../../types/meta.js';
import type { RunStatus } from '../../types/state.js';

export interface BenchCombo {
  runId: string;
  combo: string;
  harness: string;
  model: string;
  status: RunStatus;
  outcome?: string;
  durationMs?: number;
}

export interface BenchState {
  combos: BenchCombo[];
  active: BenchCombo | null;
  total: number;
  done: number;
  running: number;
  pending: number;
}

const DONE_STATUSES = new Set<RunStatus>(['complete', 'pr-created', 'failed', 'timeout', 'bailed']);

/** Ordering rank: running first, then pending, then finished. */
function rank(status: RunStatus): number {
  if (status === 'executing') return 0;
  if (status === 'queued') return 1;
  return 2;
}

/**
 * Derive the bench matrix from persisted run metadata. A bench run is any run
 * with `isolation: 'clone'` (set by `cpe bench`). Pure + exported so it can be
 * unit-tested without rendering Ink.
 */
export function deriveBenchState(metas: RunMeta[]): BenchState {
  const combos: BenchCombo[] = metas
    .filter(m => (m.isolation === 'clone') && m.status !== 'archived')
    .map(m => ({
      runId: m.id,
      combo: comboName(m.harness ?? 'claude-code', m.model ?? '?'),
      harness: m.harness ?? 'claude-code',
      model: m.model ?? '?',
      status: m.status as RunStatus,
      outcome: m.run_outcome,
      durationMs: m.duration_ms,
    }))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.combo.localeCompare(b.combo));

  const active = combos.find(c => c.status === 'executing') ?? null;
  const done = combos.filter(c => DONE_STATUSES.has(c.status)).length;
  const running = combos.filter(c => c.status === 'executing').length;
  const pending = combos.filter(c => c.status === 'queued').length;

  return { combos, active, total: combos.length, done, running, pending };
}

function readAllMetas(): RunMeta[] {
  const out: RunMeta[] = [];
  for (const id of listAllRunIds()) {
    try {
      out.push(readMeta(id));
    } catch {
      // skip unreadable
    }
  }
  return out;
}

const EMPTY: BenchState = { combos: [], active: null, total: 0, done: 0, running: 0, pending: 0 };

export function useBenchState(): BenchState {
  const [state, setState] = useState<BenchState>(() => {
    try {
      return deriveBenchState(readAllMetas());
    } catch {
      return EMPTY;
    }
  });

  useEffect(() => {
    const id = setInterval(() => {
      try {
        setState(prev => {
          const next = deriveBenchState(readAllMetas());
          // Bail out of re-render when nothing material changed (mirrors useQueueState).
          if (
            prev.active?.runId === next.active?.runId &&
            prev.total === next.total &&
            prev.done === next.done &&
            prev.running === next.running &&
            prev.pending === next.pending
          ) {
            return prev;
          }
          return next;
        });
      } catch {
        // ignore transient read errors
      }
    }, 1500);
    return () => clearInterval(id);
  }, []);

  return state;
}
