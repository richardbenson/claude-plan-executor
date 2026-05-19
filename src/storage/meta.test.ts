import { expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { STATE_TABLE, getStateInfo } from '../types/state.js';
import { readMeta, writeMeta, updateMeta, updatePhase } from './meta.js';
import { enqueue, dequeue } from './queue.js';
import type { RunMeta } from '../types/meta.js';

const ALL_STATES = [
  'queued', 'executing', 'retrying', 'paused', 'paused-limit',
  'finalising', 'complete', 'pr-created', 'failed', 'pending',
] as const;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeMinimalMeta(overrides?: Partial<RunMeta>): RunMeta {
  return {
    id: 'test-run-01',
    primary_repo_path: '/repos/test',
    worktree_path: '/state/cpe/worktrees/test-run-01',
    plan_folder: '001-test',
    feature_branch: 'feature/001-test',
    target_branch: 'main',
    status: 'queued',
    total_cost_usd: 0,
    phases: [],
    ...overrides,
  };
}

test('STATE_TABLE covers all 10 states', () => {
  expect(Object.keys(STATE_TABLE)).toHaveLength(10);
  for (const state of ALL_STATES) {
    const info = STATE_TABLE[state];
    expect(info.glyph.length).toBeGreaterThan(0);
    expect(info.color.startsWith('#')).toBe(true);
    expect(info.label.length).toBeGreaterThan(0);
  }
});

test('getStateInfo throws on unknown status', () => {
  expect(() => getStateInfo('bad-status' as any)).toThrow();
});

test('readMeta / writeMeta round-trip', () => {
  const meta = makeMinimalMeta();
  writeMeta(meta.id, meta, tmpDir);
  const result = readMeta(meta.id, tmpDir);
  expect(result).toEqual(meta);
});

test('updateMeta merges partial without clobbering other fields', () => {
  const meta = makeMinimalMeta({ total_cost_usd: 0 });
  writeMeta(meta.id, meta, tmpDir);
  const updated = updateMeta(meta.id, { total_cost_usd: 1.5 }, tmpDir);
  expect(updated.total_cost_usd).toBe(1.5);
  expect(updated.plan_folder).toBe('001-test');
});

test('updatePhase updates the correct phase entry', () => {
  const meta = makeMinimalMeta({
    phases: [
      { number: 1, prompt_file: 'PHASE_01.prompt.md', status: 'complete', retry_count: 0 },
      { number: 2, prompt_file: 'PHASE_02.prompt.md', status: 'pending', retry_count: 0 },
    ],
  });
  writeMeta(meta.id, meta, tmpDir);
  const updated = updatePhase(meta.id, 2, { status: 'executing' }, tmpDir);
  expect(updated.phases[0]?.status).toBe('complete');
  expect(updated.phases[1]?.status).toBe('executing');
});

test('enqueue / dequeue FIFO ordering', () => {
  enqueue('run-a', tmpDir);
  enqueue('run-b', tmpDir);
  enqueue('run-c', tmpDir);
  expect(dequeue(tmpDir)).toBe('run-a');
  expect(dequeue(tmpDir)).toBe('run-b');
  expect(dequeue(tmpDir)).toBe('run-c');
  expect(dequeue(tmpDir)).toBeNull();
});
