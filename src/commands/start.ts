import { readConfig } from '../storage/config.js';
import { readMeta, updateMeta } from '../storage/meta.js';
import { isQueuePaused, dequeue } from '../storage/queue.js';
import { reconcileWorktrees } from '../git/worktree.js';
import { runPhase, resumeOrRestart } from '../runner/phase-loop.js';
import { finaliseRun } from '../runner/finalise.js';
import { waitUntil } from '../runner/limit.js';
import { activityBus, ActivityBus } from '../events/bus.js';
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
        console.warn('Orphaned worktrees found: ' + orphaned.map(w => w.path).join(', '));
      }
      if (missing.length > 0) {
        console.warn('Missing worktrees for run ' + runId.slice(0, 8) + ': ' + missing.join(', '));
        updateMeta(runId, { status: 'failed' });
        continue;
      }
    }

    const pendingPhases = meta.phases.filter(p => p.status !== 'complete');

    for (const phase of pendingPhases) {
      if (phase.status === 'executing') {
        console.log('[cpe] Resuming interrupted phase ' + phase.number + ' for run ' + runId.slice(0, 8));
      }
      console.log('[cpe] Starting phase ' + phase.number + '/' + meta.phases.length);

      let phaseResult = await runPhase(runId, phase.number, config, bus);

      while (phaseResult.outcome === 'paused') {
        console.log('[cpe] Rate limit. Waiting until ' + phaseResult.resumeAt.toISOString());
        await waitUntil(phaseResult.resumeAt);
        phaseResult = await resumeOrRestart(runId, phase.number, config, bus);
      }

      if (phaseResult.outcome === 'failed') {
        console.log('[cpe] Run ' + runId.slice(0, 8) + ' failed at phase ' + phase.number);
        break;
      }

      console.log('[cpe] Phase ' + phase.number + ' complete ($' + (phaseResult.result.summary ?? '') + ')');
    }

    const finalMeta = readMeta(runId);
    if (finalMeta.phases.every(p => p.status === 'complete')) {
      console.log('[cpe] All phases done. Finalising...');
      const { prUrl } = await finaliseRun(runId, bus);
      console.log('[cpe] Done! PR: ' + prUrl);
    }
  }
}

export async function startCommand(): Promise<void> {
  const config = readConfig();
  const bus = activityBus;
  const unsub = bus.subscribe(event => {
    const ts = new Date().toTimeString().slice(0, 8);
    console.log(ts, event.kind, 'runId=' + event.runId.slice(0, 8));
  });
  await runQueueProcessor(config, bus);
  unsub();
}
