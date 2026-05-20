import React from 'react';
import { render } from 'ink';
import { readConfig } from '../storage/config.js';
import { readMeta, updateMeta } from '../storage/meta.js';
import { isQueuePaused, dequeue } from '../storage/queue.js';
import { reconcileWorktrees } from '../git/worktree.js';
import { runPhase, resumeOrRestart } from '../runner/phase-loop.js';
import { finaliseRun } from '../runner/finalise.js';
import { waitUntil } from '../runner/limit.js';
import { activityBus, ActivityBus } from '../events/bus.js';
import { App } from '../tui/App.js';
import type { AppConfig } from '../types/meta.js';

export async function runQueueProcessor(config: AppConfig, bus: ActivityBus): Promise<void> {
  const reconciledRepos = new Set<string>();

  while (true) {
    if (isQueuePaused()) {
      await Bun.sleep(5_000);
      continue;
    }

    const runId = dequeue();
    if (runId === null) {
      await Bun.sleep(10_000);
      continue;
    }

    const meta = readMeta(runId);

    if (!reconciledRepos.has(meta.primary_repo_path)) {
      reconciledRepos.add(meta.primary_repo_path);
      const { orphaned, missing } = reconcileWorktrees(meta.primary_repo_path, [runId]);
      if (orphaned.length > 0) {
        bus.emit({ kind: 'error', runId, phaseNumber: 0, message: 'Orphaned worktrees: ' + orphaned.map(w => w.path).join(', '), timestamp: new Date() });
      }
      if (missing.length > 0) {
        bus.emit({ kind: 'error', runId, phaseNumber: 0, message: 'Missing worktrees for run ' + runId.slice(0, 8), timestamp: new Date() });
        updateMeta(runId, { status: 'failed' });
        continue;
      }
    }

    const pendingPhases = meta.phases.filter(p => p.status !== 'complete');

    for (const phase of pendingPhases) {
      let phaseResult = await runPhase(runId, phase.number, config, bus);

      while (phaseResult.outcome === 'paused') {
        await waitUntil(phaseResult.resumeAt);
        phaseResult = await resumeOrRestart(runId, phase.number, config, bus);
      }

      if (phaseResult.outcome === 'failed') {
        break;
      }
    }

    const finalMeta = readMeta(runId);
    if (finalMeta.phases.every(p => p.status === 'complete')) {
      await finaliseRun(runId, bus);
    }
  }
}

export async function startCommand(): Promise<void> {
  const config = readConfig();
  const { unmount } = render(React.createElement(App, { config }), { incrementalRendering: true });
  try {
    await runQueueProcessor(config, activityBus);
  } finally {
    unmount();
  }
}
