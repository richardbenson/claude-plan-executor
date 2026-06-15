import { test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { headSha, treeDirty, runChanged } from './git-changes.js';

function git(args: string[], cwd: string): void {
  const proc = Bun.spawnSync(['git', ...args], { cwd });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${proc.stderr.toString()}`);
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-gitchanges-'));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@cpe'], dir);
  git(['config', 'user.name', 'cpe test'], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'baseline'], dir);
  return dir;
}

test('runChanged: clean tree + unmoved HEAD => false (true no-op)', () => {
  const repo = makeRepo();
  try {
    const before = headSha(repo);
    expect(before).not.toBe('');
    expect(treeDirty(repo)).toBe(false);
    expect(runChanged(repo, before)).toBe(false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('runChanged: dirty tree (uncommitted edits) => true', () => {
  const repo = makeRepo();
  try {
    const before = headSha(repo);
    fs.writeFileSync(path.join(repo, 'b.txt'), 'new\n');
    expect(treeDirty(repo)).toBe(true);
    expect(runChanged(repo, before)).toBe(true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('runChanged: committed work (clean tree, HEAD advanced) => true', () => {
  // The 2026-06-10 matrix regression: agents that commit leave a clean tree,
  // which `git status --porcelain` alone mislabels as no-op.
  const repo = makeRepo();
  try {
    const before = headSha(repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
    git(['add', '-A'], repo);
    git(['commit', '-qm', 'agent work'], repo);
    expect(treeDirty(repo)).toBe(false);
    expect(runChanged(repo, before)).toBe(true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headSha/runChanged outside a git repo degrade safely', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpe-nogit-'));
  try {
    expect(headSha(dir)).toBe('');
    expect(runChanged(dir, '')).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
