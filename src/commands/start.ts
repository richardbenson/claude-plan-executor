import React from 'react';
import { render } from 'ink';
import { readConfig } from '../storage/config.js';
import { readMeta, updateMeta, getLogsDir } from '../storage/meta.js';
import { isQueuePaused, dequeue, enqueueFront, readQueue, writeQueue } from '../storage/queue.js';
import { reconcileWorktrees } from '../git/worktree.js';
import { runPhase, resumeOrRestart } from '../runner/phase-loop.js';
import { finaliseRun } from '../runner/finalise.js';
import { waitUntil } from '../runner/limit.js';
import { activityBus, ActivityBus } from '../events/bus.js';
import { seedBusFromHistory } from '../events/seed.js';
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

    // Claim the run immediately so it stays visible in the TUI while we set up.
    // runPhase will also set this, but the window between dequeue() and runPhase()
    // would otherwise leave the run in limbo (not in queue.entries, not 'executing').
    updateMeta(runId, { status: 'executing' });

    const meta = readMeta(runId);

    if (!reconciledRepos.has(meta.primary_repo_path)) {
      reconciledRepos.add(meta.primary_repo_path);
      const { orphaned, missing } = reconcileWorktrees(meta.primary_repo_path, [{ id: runId, worktreePath: meta.worktree_path }]);
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
      // Check pause before starting each phase so a mid-run pause takes effect
      // between phases rather than running the entire plan to completion.
      if (isQueuePaused()) {
        enqueueFront(runId);
        updateMeta(runId, { status: 'queued' });
        bus.emit({ kind: 'pause', timestamp: new Date(), runId, phaseNumber: phase.number });
        break;
      }

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
      try {
        await finaliseRun(runId, bus);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[queue] finalise failed for ${runId.slice(0, 8)}: ${msg}\n`);
        updateMeta(runId, { status: 'failed' });
        bus.emit({ kind: 'error', timestamp: new Date(), runId, phaseNumber: -1, message: 'finalise: ' + msg });
      }
    }
  }
}

export async function startCommand(): Promise<void> {
  const config = readConfig();

  seedBusFromHistory();

  const queue = readQueue();
  if (!queue.paused) {
    queue.paused = true;
    writeQueue(queue);
  }

  // Queue processor runs independently; TUI can restart around it
  runQueueProcessor(config, activityBus).catch(() => {});

  while (true) {
    let interactiveCmd: string[] | null = null;

    const { unmount, waitUntilExit } = render(
      React.createElement(App, {
        config,
        onInteractiveSubprocess: (cmd: string[]) => {
          interactiveCmd = cmd;
          unmount();
        },
      }),
      { incrementalRendering: true },
    );

    await waitUntilExit();

    if (!interactiveCmd) break; // user quit normally (process.exit or q)

    // Hand the terminal to the subprocess, then loop back to re-render TUI
    const proc = Bun.spawn(interactiveCmd, {
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
    });
    await proc.exited;
  }
}
