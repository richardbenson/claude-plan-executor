import { test, expect } from 'bun:test';
import { buildOpaquePrompt, buildSummarizePrompt, withAutonomy, BENCH_PROMPT_TEMPLATE, SINGLE_PROMPT_TEMPLATE } from './index.js';

test('withAutonomy prepends the autonomy preamble (no questions, produce concrete changes) to any prompt', () => {
  const out = withAutonomy('What is a good update procedure?');
  expect(out).toContain('What is a good update procedure?');
  expect(out.toLowerCase()).toMatch(/do not ask|no human/i);
  expect(out.toLowerCase()).toMatch(/concrete changes|files/i);
  // it leads with the framing, then the task
  expect(out.indexOf('autonomously')).toBeLessThan(out.indexOf('good update procedure'));
});

test('BENCH_PROMPT_TEMPLATE commits but never instructs push/PR (single-prompt template does)', () => {
  expect(SINGLE_PROMPT_TEMPLATE.toLowerCase()).toContain('pull request');
  expect(BENCH_PROMPT_TEMPLATE).toContain('{{USER_PROMPT}}');
  expect(BENCH_PROMPT_TEMPLATE.toLowerCase()).toContain('commit');
  expect(BENCH_PROMPT_TEMPLATE).toMatch(/do NOT push|never open a PR|always false/i);
});

test('buildOpaquePrompt (phase) appends the contract, commit + result file, no PR', () => {
  const out = buildOpaquePrompt('PHASE BODY', { withPr: false });
  expect(out).toContain('PHASE BODY');
  expect(out).toContain('.cpe/result.json');
  expect(out).toContain('"notes_for_next_phase"');
  // phase variant: no PR step or PR result fields
  expect(out).not.toContain('open a pull request');
  expect(out).not.toContain('"pr_created"');
});

test('buildOpaquePrompt (single-prompt) adds the PR step and pr fields', () => {
  const out = buildOpaquePrompt('TASK BODY', { withPr: true });
  expect(out).toContain('TASK BODY');
  expect(out).toContain('open a pull request');
  expect(out).toContain('"pr_created"');
  expect(out).toContain('"pr_url"');
  expect(out).toContain('.cpe/result.json');
});

test('buildSummarizePrompt injects diff + transcript and truncates oversized input', () => {
  const out = buildSummarizePrompt('DIFFTEXT', 'TRANSCRIPTTEXT');
  expect(out).toContain('DIFFTEXT');
  expect(out).toContain('TRANSCRIPTTEXT');
  const big = buildSummarizePrompt('x'.repeat(20000), 'y'.repeat(20000));
  expect(big).toContain('…(truncated)…');
});
