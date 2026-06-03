import React from 'react';
import { render } from 'ink';
import { readConfig } from '../storage/config.js';
import { readMeta, updateMeta, listAllRunIds } from '../storage/meta.js';
import { isQueuePaused, dequeue, enqueueFront, readQueue, writeQueue } from '../storage/queue.js';
import { reconcileWorktrees } from '../git/worktree.js';
import { runPhase, resumeOrRestart } from '../runner/phase-loop.js';
import { finaliseRun } from '../runner/finalise.js';
import { runSinglePrompt } from '../runner/single-prompt.js';
import { waitUntil } from '../runner/limit.js';
import { activityBus, ActivityBus } from '../events/bus.js';
import { seedBusFromHistory } from '../events/seed.js';
import { App } from '../tui/App.js';
import { readRepoConfig } from '../config/repo-config.js';
import { isBubblewrapAvailable } from '../runner/sandbox.js';
import { isRunningInContainer } from '../runner/container.js';
import type { AppConfig } from '../types/meta.js';

function recoverInterruptedRuns(): void {
  const queue = readQueue();
  const queued = new Set(queue.entries.map(e => e.run_id));
  const recovered: string[] = [];

  for (const id of listAllRunIds()) {
    if (queued.has(id)) continue;
    try {
      const meta = readMeta(id);
      const entry = { run_id: id, added_at: new Date().toISOString(), type: (meta.plan_folder ? 'plan' : 'single-prompt') as 'plan' | 'single-prompt' };
      if (meta.status === 'executing') {
        // Was mid-run — put at front, reset to queued
        queue.entries.unshift(entry);
        queued.add(id);
        updateMeta(id, { status: 'queued' });
        recovered.push(id.slice(0, 8));
      } else if (meta.status === 'paused-limit') {
        // Was waiting for a rate-limit window — add to back, preserve status so
        // the processor knows to wait for limit_resume_at before starting
        queue.entries.push(entry);
        queued.add(id);
        recovered.push(id.slice(0, 8));
      }
    } catch { /* skip unreadable */ }
  }

  if (recovered.length > 0) {
    writeQueue(queue);
    process.stderr.write(`[start] recovered interrupted runs: ${recovered.join(', ')}\n`);
  }
}

export async function runQueueProcessor(config: AppConfig, bus: ActivityBus): Promise<void> {
  recoverInterruptedRuns();
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

    const repoConfig = readRepoConfig(meta.primary_repo_path);
    const effectiveConfig: AppConfig = {
      ...config,
      ...(repoConfig?.dangerously_skip_permissions && !config.dangerously_skip_permissions
        ? { dangerously_skip_permissions: true }
        : {}),
      ...(repoConfig?.providers !== undefined
        ? {
            providers: repoConfig.providers,
            provider_for_planning: repoConfig.provider_for_planning ?? config.provider_for_planning,
            provider_for_phases: repoConfig.provider_for_phases ?? config.provider_for_phases,
          }
        : {}),
    };

    // Clone-isolation (bench) runs create their clone lazily at run time and
    // have no pre-existing worktree, so skip the worktree reconcile for them.
    const isCloneRun = (meta.isolation ?? config.isolation ?? 'worktree') === 'clone';

    if (!isCloneRun && !reconciledRepos.has(meta.primary_repo_path)) {
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

    const isSinglePrompt = !meta.plan_folder && meta.prompt;

    if (isSinglePrompt) {
      try {
        // If recovering from a rate limit, wait for the window to clear first
        if (meta.limit_resume_at) {
          const resumeAt = new Date(meta.limit_resume_at);
          if (resumeAt > new Date()) {
            bus.emit({ kind: 'limit', timestamp: new Date(), runId, phaseNumber: -1, resumeAt });
            await waitUntil(resumeAt);
          }
        }
        await runSinglePrompt(runId, effectiveConfig, bus);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[queue] single-prompt failed for ${runId.slice(0, 8)}: ${msg}\n`);
        updateMeta(runId, { status: 'failed' });
        bus.emit({ kind: 'error', timestamp: new Date(), runId, phaseNumber: -1, message: 'single-prompt: ' + msg });
      }
    } else {
      const pendingPhases = (meta.phases ?? []).filter(p => p.status !== 'complete');

      for (const phase of pendingPhases) {
        // Check pause before starting each phase so a mid-run pause takes effect
        // between phases rather than running the entire plan to completion.
        if (isQueuePaused()) {
          enqueueFront(runId);
          updateMeta(runId, { status: 'queued' });
          bus.emit({ kind: 'pause', timestamp: new Date(), runId, phaseNumber: phase.number });
          break;
        }

        let phaseResult;
        if (phase.status === 'paused-limit') {
          // Phase was interrupted by a rate limit — wait for the window, then resume
          const resumeAt = meta.limit_resume_at ? new Date(meta.limit_resume_at) : new Date();
          if (resumeAt > new Date()) {
            bus.emit({ kind: 'limit', timestamp: new Date(), runId, phaseNumber: phase.number, resumeAt });
            await waitUntil(resumeAt);
          }
          phaseResult = await resumeOrRestart(runId, phase.number, effectiveConfig, bus);
        } else {
          phaseResult = await runPhase(runId, phase.number, effectiveConfig, bus);
        }

        while (phaseResult.outcome === 'paused') {
          await waitUntil(phaseResult.resumeAt);
          phaseResult = await resumeOrRestart(runId, phase.number, effectiveConfig, bus);
        }

        if (phaseResult.outcome === 'failed') {
          break;
        }
      }

      const finalMeta = readMeta(runId);
      if ((finalMeta.phases ?? []).every(p => p.status === 'complete')) {
        try {
          await finaliseRun(runId, bus, effectiveConfig);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          updateMeta(runId, { status: 'failed' });
          bus.emit({ kind: 'error', timestamp: new Date(), runId, phaseNumber: -1, message: 'finalise: ' + msg });
        }
      }
    }

    // Inter-run pause: give the backend (e.g. Ollama) time to evict the previous
    // model before the next run. Interruptible — a queue pause cuts it short.
    await interruptiblePause((config.pause_seconds ?? 0) * 1000);
  }
}

/**
 * Sleep in short increments so a queue pause interrupts the wait cleanly.
 * `isPaused` is injectable for testing; it defaults to the live queue state.
 */
export async function interruptiblePause(
  totalMs: number,
  isPaused: () => boolean = isQueuePaused,
  stepMs = 1000,
): Promise<void> {
  if (totalMs <= 0) return;
  let waited = 0;
  while (waited < totalMs) {
    if (isPaused()) return;
    await Bun.sleep(Math.min(stepMs, totalMs - waited));
    waited += stepMs;
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

  const containerWarning = isRunningInContainer() && !isBubblewrapAvailable();

  // Queue processor runs independently; TUI can restart around it
  runQueueProcessor(config, activityBus).catch(() => { });

  while (true) {
    let interactiveCmd: string[] | null = null;

    const { unmount, waitUntilExit } = render(
      React.createElement(App, {
        config,
        containerWarning,
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
