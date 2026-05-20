import { useState, useEffect } from 'react';
import { readQueue } from '../../storage/queue.js';
import { readMeta } from '../../storage/meta.js';
import { activityBus } from '../../events/bus.js';
import type { RunMeta, PhaseEntry } from '../../types/meta.js';

export interface QueueState {
  activeRun: RunMeta | null;
  activePhase: PhaseEntry | null;
  queuedRuns: RunMeta[];
  allRuns: RunMeta[];
  isPaused: boolean;
  isLimitPaused: boolean;
  limitResumeAt: Date | null;
  phasesCompleteToday: number;
  budgetToday: number;
  commitsToday: number;
  prsToday: number;
  retriesToday: number;
  failuresToday: number;
}

function isToday(dateStr: string | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function deriveState(): QueueState {
  const queue = readQueue();
  const allRuns: RunMeta[] = [];

  for (const entry of queue.entries) {
    try {
      const meta = readMeta(entry.run_id);
      allRuns.push(meta);
    } catch {
      // skip runs whose meta can't be read
    }
  }

  const activeRun =
    allRuns.find(r => r.status === 'executing' || r.status === 'finalising') ?? null;

  const activePhase = activeRun
    ? (activeRun.phases.find(p => p.status === 'executing') ?? null)
    : null;

  const queuedRuns = allRuns.filter(r => r.status === 'queued');

  const isLimitPaused = activeRun?.status === 'paused-limit';

  let limitResumeAt: Date | null = null;
  const buf = activityBus.getBuffer();
  for (let i = buf.length - 1; i >= 0; i--) {
    const ev = buf[i];
    if (!ev) continue;
    if (ev.kind === 'limit') {
      limitResumeAt = ev.resumeAt;
      break;
    }
  }

  // Today's stats across all runs
  let phasesCompleteToday = 0;
  let budgetToday = 0;
  let commitsToday = 0;
  let prsToday = 0;
  let retriesToday = 0;
  let failuresToday = 0;

  for (const run of allRuns) {
    for (const phase of run.phases) {
      if (isToday(phase.completed_at)) {
        if (phase.status === 'complete' || phase.status === 'pr-created') {
          phasesCompleteToday++;
          budgetToday += phase.cost_usd ?? 0;
        }
        if (phase.retry_count > 0) retriesToday += phase.retry_count;
        if (phase.status === 'failed') failuresToday++;
        if (phase.commit_sha) commitsToday++;
      }
    }
    if (isToday(run.phases[run.phases.length - 1]?.completed_at)) {
      if (run.status === 'pr-created') prsToday++;
    }
  }

  return {
    activeRun,
    activePhase,
    queuedRuns,
    allRuns,
    isPaused: queue.paused,
    isLimitPaused,
    limitResumeAt,
    phasesCompleteToday,
    budgetToday,
    commitsToday,
    prsToday,
    retriesToday,
    failuresToday,
  };
}

const EMPTY_STATE: QueueState = {
  activeRun: null,
  activePhase: null,
  queuedRuns: [],
  allRuns: [],
  isPaused: false,
  isLimitPaused: false,
  limitResumeAt: null,
  phasesCompleteToday: 0,
  budgetToday: 0,
  commitsToday: 0,
  prsToday: 0,
  retriesToday: 0,
  failuresToday: 0,
};

export function useQueueState(): QueueState {
  const [state, setState] = useState<QueueState>(() => {
    try {
      return deriveState();
    } catch {
      return EMPTY_STATE;
    }
  });

  useEffect(() => {
    const id = setInterval(() => {
      try {
        setState(prev => {
          const next = deriveState();
          // Return the same reference when nothing meaningful changed so React
          // bails out of the re-render entirely, preventing Ink from repainting.
          if (
            prev.activeRun?.id === next.activeRun?.id &&
            prev.activePhase?.number === next.activePhase?.number &&
            prev.allRuns.length === next.allRuns.length &&
            prev.queuedRuns.length === next.queuedRuns.length &&
            prev.isPaused === next.isPaused &&
            prev.isLimitPaused === next.isLimitPaused &&
            String(prev.limitResumeAt) === String(next.limitResumeAt) &&
            prev.phasesCompleteToday === next.phasesCompleteToday &&
            prev.budgetToday === next.budgetToday &&
            prev.commitsToday === next.commitsToday &&
            prev.prsToday === next.prsToday &&
            prev.retriesToday === next.retriesToday &&
            prev.failuresToday === next.failuresToday
          ) {
            return prev;
          }
          return next;
        });
      } catch {
        // ignore transient read errors
      }
    }, 2000);
    return () => clearInterval(id);
  }, []);

  return state;
}
