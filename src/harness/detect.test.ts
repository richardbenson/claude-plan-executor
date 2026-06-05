import { test, expect } from 'bun:test';
import {
  parseVersion,
  detectOne,
  getHarnessStatus,
  assertHarnessInstalled,
  ensureHarnessDetection,
} from './detect.js';
import type { Harness } from './types.js';
import type { AppConfig, HarnessStatus } from '../types/meta.js';

const stubRun: Harness['run'] = async () => ({ exitCode: 0, outcome: 'no-op' });

test('parseVersion extracts the first version-looking token, undefined for none', () => {
  expect(parseVersion('codex-cli 0.137.0')).toBe('0.137.0');
  expect(parseVersion('👋 mini-swe-agent version 2.3.0\n...')).toBe('2.3.0');
  expect(parseVersion('goose 1.37.0')).toBe('1.37.0');
  expect(parseVersion('aider 0.86')).toBe('0.86');
  expect(parseVersion('no version here')).toBeUndefined();
  expect(parseVersion('')).toBeUndefined();
});

test('detectOne reports an installed binary with a path (git is always present in this repo)', () => {
  const h: Harness = { name: 'fake-git', completionMode: 'opaque', install: { bin: 'git', url: 'https://git-scm.com' }, run: stubRun };
  const s = detectOne(h);
  expect(s.name).toBe('fake-git');
  expect(s.bin).toBe('git');
  expect(s.installed).toBe(true);
  expect(s.path && s.path.length > 0).toBe(true);
  expect(typeof s.checked_at).toBe('string');
});

test('detectOne reports a missing binary as not installed, no path', () => {
  const h: Harness = { name: 'fake-missing', completionMode: 'opaque', install: { bin: 'definitely-not-a-real-binary-xyz', url: 'https://example.com' }, run: stubRun };
  const s = detectOne(h);
  expect(s.installed).toBe(false);
  expect(s.path).toBeUndefined();
});

test('detectOne treats a harness with no install descriptor as undetectable (bin empty, not installed)', () => {
  const h: Harness = { name: 'no-install', completionMode: 'opaque', run: stubRun };
  const s = detectOne(h);
  expect(s.bin).toBe('');
  expect(s.installed).toBe(false);
});

test('getHarnessStatus finds a status by name', () => {
  const config: AppConfig = {
    max_retries: 1,
    harnesses: [{ name: 'codex', bin: 'codex', installed: true, checked_at: 'x' }],
  };
  expect(getHarnessStatus(config, 'codex')?.installed).toBe(true);
  expect(getHarnessStatus(config, 'nope')).toBeUndefined();
});

test('assertHarnessInstalled throws (with install URL) for a not-installed registered harness', () => {
  const config: AppConfig = {
    max_retries: 1,
    harnesses: [{ name: 'codex', bin: 'codex', installed: false, checked_at: 'x' }],
  };
  expect(() => assertHarnessInstalled(config, 'codex')).toThrow(/not installed/);
  expect(() => assertHarnessInstalled(config, 'codex')).toThrow(/github\.com\/openai\/codex/);
});

test('assertHarnessInstalled is a no-op for installed, missing-status, or undetectable (bin empty) harnesses', () => {
  const installed: AppConfig = { max_retries: 1, harnesses: [{ name: 'codex', bin: 'codex', installed: true, checked_at: 'x' }] };
  expect(() => assertHarnessInstalled(installed, 'codex')).not.toThrow();

  // no record at all → allowed (caller is expected to ensureHarnessDetection first)
  expect(() => assertHarnessInstalled({ max_retries: 1, harnesses: [] }, 'codex')).not.toThrow();

  // bin '' → undetectable harness, cannot verify, allowed (no registry.get lookup either)
  const undetectable: AppConfig = { max_retries: 1, harnesses: [{ name: 'mystery', bin: '', installed: false, checked_at: 'x' }] };
  expect(() => assertHarnessInstalled(undetectable, 'mystery')).not.toThrow();
});

test('ensureHarnessDetection is a no-op (no write, same data) when statuses already exist', () => {
  const statuses: HarnessStatus[] = [{ name: 'codex', bin: 'codex', installed: true, checked_at: 'x' }];
  const config: AppConfig = { max_retries: 1, harnesses: statuses };
  const out = ensureHarnessDetection(config);
  expect(out.harnesses).toBe(statuses);
});
