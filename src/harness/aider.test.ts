import { test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  openAiBaseFrom,
  deriveAiderOutcome,
  parseAiderUsage,
  editFormatFromEnv,
  excludeAiderArtifacts,
  aiderHarness,
} from './aider.js';
import * as registry from './registry.js';

test('aider is registered as an opaque-mode harness', () => {
  const h = registry.get('aider');
  expect(h).toBe(aiderHarness);
  expect(h.completionMode).toBe('opaque');
  expect(registry.list()).toContain('aider');
});

test('openAiBaseFrom appends /v1 to the Anthropic base url (idempotently)', () => {
  expect(openAiBaseFrom({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434' })).toBe('http://192.168.1.3:11434/v1');
  expect(openAiBaseFrom({ ANTHROPIC_BASE_URL: 'http://192.168.1.3:11434/' })).toBe('http://192.168.1.3:11434/v1');
  expect(openAiBaseFrom({ ANTHROPIC_BASE_URL: 'http://host/v1' })).toBe('http://host/v1');
});

test('openAiBaseFrom returns null when no base url is provided', () => {
  expect(openAiBaseFrom({})).toBeNull();
});

test('deriveAiderOutcome maps exit code + change flag to an outcome', () => {
  expect(deriveAiderOutcome(0, true)).toBe('completed');
  expect(deriveAiderOutcome(0, false)).toBe('no-op');
  expect(deriveAiderOutcome(1, true)).toBe('error');
  expect(deriveAiderOutcome(1, false)).toBe('error');
});

test('editFormatFromEnv defaults to whole and validates the override', () => {
  expect(editFormatFromEnv({})).toBe('whole');
  expect(editFormatFromEnv({ CPE_AIDER_EDIT_FORMAT: 'diff' })).toBe('diff');
  expect(editFormatFromEnv({ CPE_AIDER_EDIT_FORMAT: 'UDIFF' })).toBe('udiff');
  expect(editFormatFromEnv({ CPE_AIDER_EDIT_FORMAT: ' whole ' })).toBe('whole');
  // Unknown values fall back to the default rather than passing garbage to aider.
  expect(editFormatFromEnv({ CPE_AIDER_EDIT_FORMAT: 'bogus' })).toBe('whole');
});

test('parseAiderUsage reads the last token tally and session cost from plain output', () => {
  // Two messages' worth of output: the LAST tally is the final/cumulative one.
  const out = [
    'Aider v0.86.2',
    'Tokens: 788 sent, 142 received.',
    'Applied edit to note.txt',
    'Tokens: 1.2k sent, 350 received. Cost: $0.0012 message, $0.0034 session.',
    'Commit be5ab07 chore: update note.txt',
  ].join('\n');
  expect(parseAiderUsage(out)).toEqual({
    costUsd: 0.0034,
    tokens: { input_tokens: 1200, output_tokens: 350, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  });
});

test('parseAiderUsage handles a tally with no cost line (local model)', () => {
  expect(parseAiderUsage('Tokens: 788 sent, 142 received.\nApplied edit to note.txt')).toEqual({
    tokens: { input_tokens: 788, output_tokens: 142, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  });
});

test('parseAiderUsage returns empty object when no tally is present', () => {
  expect(parseAiderUsage('Aider v0.86.2\nApplied edit to note.txt')).toEqual({});
});

test('excludeAiderArtifacts adds .aider* to .git/info/exclude once, idempotently', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-aider-excl-'));
  try {
    fs.mkdirSync(path.join(dir, '.git', 'info'), { recursive: true });
    const excludePath = path.join(dir, '.git', 'info', 'exclude');
    fs.writeFileSync(excludePath, '# git ls-files --others --exclude-from=.git/info/exclude\n');

    excludeAiderArtifacts(dir);
    excludeAiderArtifacts(dir); // second call must not duplicate

    const body = fs.readFileSync(excludePath, 'utf8');
    const matches = body.split('\n').filter(l => l.trim() === '.aider*');
    expect(matches.length).toBe(1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('excludeAiderArtifacts is a no-op (no throw) when there is no .git dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-aider-nogit-'));
  try {
    expect(() => excludeAiderArtifacts(dir)).not.toThrow();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
