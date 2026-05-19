import { describe, it, expect } from 'bun:test';
import { parseWorktreePorcelain } from './worktree.js';

describe('parseWorktreePorcelain', () => {
  it('correctly parses --porcelain output', () => {
    const fixture = `worktree /home/user/code/myrepo
HEAD abc1234def5678901234567890abcdef12345678
branch refs/heads/main

worktree /home/user/.local/state/cpe/worktrees/01HXYZ/
HEAD def5678901234567890abcdef12345678abc1234
branch refs/heads/feature/my-feature

`;

    const result = parseWorktreePorcelain(fixture);

    expect(result).toHaveLength(2);

    expect(result[0]).toEqual({
      path: '/home/user/code/myrepo',
      head: 'abc1234def5678901234567890abcdef12345678',
      branch: 'main',
      bare: false,
    });

    expect(result[1]).toEqual({
      path: '/home/user/.local/state/cpe/worktrees/01HXYZ/',
      head: 'def5678901234567890abcdef12345678abc1234',
      branch: 'feature/my-feature',
      bare: false,
    });
  });

  it('marks bare worktrees', () => {
    const fixture = `worktree /home/user/code/myrepo.git
HEAD abc1234def5678901234567890abcdef12345678
bare

`;

    const result = parseWorktreePorcelain(fixture);
    expect(result).toHaveLength(1);
    expect(result[0]?.bare).toBe(true);
    expect(result[0]?.branch).toBe('');
  });
});
