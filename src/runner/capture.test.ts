import { describe, it, expect } from 'bun:test';
import { slugifyModel, comboName, getResultsDir, RESULTS_BASE } from './capture.js';

describe('capture helpers', () => {
  it('slugifies model ids to ref/path-safe strings', () => {
    expect(slugifyModel('gemma4-cpe:31b')).toBe('gemma4-cpe-31b');
    expect(slugifyModel('library/model:tag')).toBe('library-model-tag');
    expect(slugifyModel('plain')).toBe('plain');
  });

  it('builds the harness__model combo name', () => {
    expect(comboName('claude-code', 'gemma4-cpe:31b')).toBe('claude-code__gemma4-cpe-31b');
    expect(comboName('opencode', 'qwen3.6:27b')).toBe('opencode__qwen3.6-27b');
  });

  it('places results under the cpe state dir', () => {
    const dir = getResultsDir('claude-code__gemma4-cpe-31b');
    expect(dir.startsWith(RESULTS_BASE)).toBe(true);
    expect(dir.endsWith('claude-code__gemma4-cpe-31b')).toBe(true);
  });
});
