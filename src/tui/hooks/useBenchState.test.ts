import { test, expect } from 'bun:test';
import { deriveBenchState } from './useBenchState.js';
import type { RunMeta } from '../../types/meta.js';

/** Minimal clone-run meta; deriveBenchState only reads a handful of fields. */
function cloneRun(over: Partial<RunMeta>): RunMeta {
  return {
    id: crypto.randomUUID(),
    primary_repo_path: '/tmp/repo',
    worktree_path: '',
    feature_branch: 'harnesstests/x',
    target_branch: 'main',
    status: 'queued',
    total_cost_usd: 0,
    isolation: 'clone',
    harness: 'claude-code',
    model: 'gemma:31b',
    ...over,
  } as RunMeta;
}

test('includes only clone runs (ignores worktree + archived runs)', () => {
  const metas: RunMeta[] = [
    cloneRun({ status: 'queued' }),
    cloneRun({ status: 'complete' }),
    cloneRun({ isolation: 'worktree' }),       // not a bench run
    cloneRun({ status: 'archived' }),          // archived clone — excluded
  ];
  const s = deriveBenchState(metas);
  expect(s.total).toBe(2);
});

test('orders running first, then pending, then finished; counts each bucket', () => {
  const metas: RunMeta[] = [
    cloneRun({ status: 'complete', model: 'm-done' }),
    cloneRun({ status: 'queued', model: 'm-pending' }),
    cloneRun({ status: 'executing', model: 'm-running' }),
    cloneRun({ status: 'bailed', model: 'm-bailed' }),
    cloneRun({ status: 'timeout', model: 'm-timeout' }),
  ];
  const s = deriveBenchState(metas);

  expect(s.combos[0]!.status).toBe('executing');
  expect(s.combos[1]!.status).toBe('queued');
  expect(s.running).toBe(1);
  expect(s.pending).toBe(1);
  expect(s.done).toBe(3); // complete + bailed + timeout
  expect(s.active?.model).toBe('m-running');
});

test('combo name slugifies the model id', () => {
  const s = deriveBenchState([cloneRun({ harness: 'aider', model: 'qwen/coder:7b' })]);
  expect(s.combos[0]!.combo).toBe('aider__qwen-coder-7b');
});

test('no clone runs yields an empty, inactive state', () => {
  const s = deriveBenchState([cloneRun({ isolation: 'worktree' })]);
  expect(s.total).toBe(0);
  expect(s.active).toBeNull();
});
