import { test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isReportShape,
  normalizeReport,
  reportFromEnvelope,
  readSelfReport,
  gitDerivedReport,
  acquireReport,
  parseSummaryReport,
  CPE_RESULT_REL,
} from './report.js';
import type { ClaudeEnvelope } from './envelope.js';

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-report-test-'));
}

function gitRepo(): string {
  const dir = tmpdir();
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 't@t.co'],
    ['config', 'user.name', 't'],
  ]) Bun.spawnSync(['git', ...args], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# base\n');
  Bun.spawnSync(['git', 'add', '-A'], { cwd: dir });
  Bun.spawnSync(['git', 'commit', '-qm', 'base'], { cwd: dir });
  return dir;
}

function head(dir: string): string {
  return Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: dir }).stdout.toString().trim();
}

test('isReportShape requires completed/committed/summary', () => {
  expect(isReportShape({ completed: true, committed: false, summary: 'x' })).toBe(true);
  expect(isReportShape({ completed: true, committed: false })).toBe(false);
  expect(isReportShape(null)).toBe(false);
});

test('normalizeReport defaults blockers and carries optional fields', () => {
  expect(normalizeReport({ completed: true, committed: true, summary: 's' })).toEqual({
    completed: true, committed: true, summary: 's', blockers: [],
  });
  const full = normalizeReport({
    completed: false, committed: true, summary: 's', commit_message: 'm',
    notes_for_next_phase: 'n', blockers: ['a', 2, 'b'], pr_created: true, pr_url: 'http://x',
  });
  expect(full.blockers).toEqual(['a', 'b']);
  expect(full.commit_message).toBe('m');
  expect(full.notes_for_next_phase).toBe('n');
  expect(full.pr_created).toBe(true);
  expect(full.pr_url).toBe('http://x');
});

test('reportFromEnvelope maps valid structured_output and rejects bad shapes', () => {
  const env = (out: unknown): ClaudeEnvelope => ({
    is_error: false, api_error_status: null, terminal_reason: 'end_turn', stop_reason: 'end_turn',
    result: '', structured_output: out, session_id: 's', total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  });
  expect(reportFromEnvelope(env({ completed: true, committed: true, summary: 'ok', blockers: [] }))?.summary).toBe('ok');
  expect(reportFromEnvelope(env({ nope: 1 }))).toBeNull();
});

test('readSelfReport parses a valid .cpe/result.json then deletes the .cpe dir', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, '.cpe'));
  fs.writeFileSync(path.join(dir, CPE_RESULT_REL), JSON.stringify({ completed: true, committed: true, summary: 'did it', notes_for_next_phase: 'beware' }));
  const report = readSelfReport(dir);
  expect(report?.summary).toBe('did it');
  expect(report?.notes_for_next_phase).toBe('beware');
  expect(fs.existsSync(path.join(dir, '.cpe'))).toBe(false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readSelfReport returns null for missing or malformed files (and clears bad ones)', () => {
  const dir = tmpdir();
  expect(readSelfReport(dir)).toBeNull(); // missing
  fs.mkdirSync(path.join(dir, '.cpe'));
  fs.writeFileSync(path.join(dir, CPE_RESULT_REL), 'not json');
  expect(readSelfReport(dir)).toBeNull();
  expect(fs.existsSync(path.join(dir, '.cpe'))).toBe(false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gitDerivedReport: a fresh commit reads as completed + committed', () => {
  const dir = gitRepo();
  const before = head(dir);
  fs.writeFileSync(path.join(dir, 'NEW.txt'), 'hello\n');
  Bun.spawnSync(['git', 'add', '-A'], { cwd: dir });
  Bun.spawnSync(['git', 'commit', '-qm', 'add new'], { cwd: dir });
  const r = gitDerivedReport(dir, before, 0);
  expect(r.committed).toBe(true);
  expect(r.completed).toBe(true);
  expect(r.summary).toMatch(/NEW\.txt|Changes:/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gitDerivedReport: no change → not completed; non-zero exit → blocker', () => {
  const dir = gitRepo();
  const before = head(dir);
  expect(gitDerivedReport(dir, before, 0).completed).toBe(false);
  const failed = gitDerivedReport(dir, before, 3);
  expect(failed.completed).toBe(false);
  expect(failed.blockers[0]).toMatch(/exited with code 3/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseSummaryReport tolerates fences/prose and rejects junk', () => {
  expect(parseSummaryReport('{"completed":true,"committed":true,"summary":"plain"}')?.summary).toBe('plain');
  expect(parseSummaryReport('```json\n{"completed":false,"committed":false,"summary":"fenced","blockers":["x"]}\n```')?.blockers).toEqual(['x']);
  expect(parseSummaryReport('Here is the result:\n{"completed":true,"committed":true,"summary":"prose"}\nDone.')?.summary).toBe('prose');
  expect(parseSummaryReport('no json at all')).toBeNull();
  expect(parseSummaryReport('{"summary":"missing required fields"}')).toBeNull();
});

test('acquireReport precedence: self-report > summarize > git', async () => {
  const dir = gitRepo();
  const before = head(dir);

  // 1. self-report present → wins
  fs.mkdirSync(path.join(dir, '.cpe'));
  fs.writeFileSync(path.join(dir, CPE_RESULT_REL), JSON.stringify({ completed: true, committed: false, summary: 'self' }));
  let res = await acquireReport({ worktree: dir, headBefore: before, exitCode: 0, summarize: () => ({ completed: true, committed: false, summary: 'sum', blockers: [] }) });
  expect(res.source).toBe('self-report');
  expect(res.report.summary).toBe('self');

  // 2. no self-report, summarize provides one → summarize
  res = await acquireReport({ worktree: dir, headBefore: before, exitCode: 0, summarize: () => ({ completed: true, committed: false, summary: 'sum', blockers: [] }) });
  expect(res.source).toBe('summarize');

  // 3. no self-report, summarize throws → git-derived
  res = await acquireReport({ worktree: dir, headBefore: before, exitCode: 0, summarize: () => { throw new Error('boom'); } });
  expect(res.source).toBe('git');

  // 4. no summarize at all → git-derived
  res = await acquireReport({ worktree: dir, headBefore: before, exitCode: 0 });
  expect(res.source).toBe('git');
  fs.rmSync(dir, { recursive: true, force: true });
});
