import { test, expect } from 'bun:test';
import { buildOpaquePrompt } from './index.js';

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
