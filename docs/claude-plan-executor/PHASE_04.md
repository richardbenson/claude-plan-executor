# Phase 04 — Worktree Management + Per-Repo Config

## Summary

Implement the git worktree lifecycle (create, rename/move, remove, list, reconcile) and the
per-repo `cpe.config.json` system including the first-time interactive prompt and the
`cpe bootstrap` subcommand.

## Context

### Worktree management (src/git/worktree.ts)
All execution happens in dedicated git worktrees at `~/.local/state/cpe/worktrees/<run-id>/`.
Shell out to `git` for all operations. Key functions:

- `createWorktree(primaryRepo, runId, branch, targetBranch)` — runs
  `git worktree add <path> -b <branch> <targetBranch>` in the primary repo directory
- `renameWorktreeBranch(worktreePath, oldBranch, newBranch)` — runs
  `git branch -m <old> <new>` from the primary repo
- `moveWorktree(oldPath, newPath)` — runs `git worktree move <old> <new>` from the primary repo.
  Note: `git worktree remove` does NOT delete the branch — that must be done explicitly if needed
  (verified in the project's probe-git-worktree.sh)
- `removeWorktree(primaryRepo, worktreePath, force?)` — `git worktree remove [--force] <path>`.
  Does not delete the branch.
- `deleteBranch(primaryRepo, branch)` — `git branch -D <branch>` (used when planning is aborted)
- `listWorktrees(primaryRepo)` — parses `git worktree list --porcelain` output; returns array of
  `{ path, branch, head }`. Used for reconciliation on startup.
- `reconcileWorktrees(primaryRepo, knownRunIds)` — compares `git worktree list` against known
  run IDs; returns arrays of orphaned worktrees (in git but not in meta) and missing worktrees
  (in meta but not in git). Does not mutate anything — the caller decides what to do.

### Repo detection (src/git/repo.ts)
- `getPrimaryRepo()` — runs `git rev-parse --show-toplevel` from cwd; throws if not in a git repo
- `getRemote(repoPath)` — runs `git remote get-url origin`; parses into
  `{ host, owner, repo, type: 'github' | 'gitea' | 'other' }` using the configured Gitea host
  from AppConfig (falls back to 'other' if it doesn't match github.com or the gitea host)
- `getCurrentBranch(repoPath)` — `git rev-parse --abbrev-ref HEAD`
- `getHead(repoPath)` — `git rev-parse HEAD`

### Per-repo config (src/config/repo-config.ts)
Manages `cpe.config.json` at the primary repo root.

- `readRepoConfig(repoPath)` — reads and parses `<repoPath>/cpe.config.json`; returns null if
  absent
- `writeRepoConfig(repoPath, config)` — writes the config as formatted JSON
- `runBootstrap(worktreePath, commands, logPath)` — executes each command in the `bootstrap` array
  sequentially in the worktree root, streaming stdout+stderr to the log file. Returns
  `{ success: boolean, failedCommand?: string, exitCode?: number }`.
  If any command fails (non-zero exit), returns immediately with success: false.

### First-time prompt (src/config/repo-config.ts, continued)
`ensureRepoConfig(repoPath, appConfig)` — called at `cpe queue` and `cpe plan` time:
1. Call `readRepoConfig(repoPath)`. If exists, return it.
2. Print: "No cpe.config.json found for this repo."
3. Prompt user (simple numbered menu via stdout/stdin):
   - 1. Detect with Claude (one-off LLM call, ~$0.05)
   - 2. Create a stub I'll fill in myself
   - 3. Skip (don't need a bootstrap step)
4. On 1: run the LLM detector (see below); show result; ask Y/edit/n
5. On 2: write stub template, open in `$EDITOR` if set
6. On 3: write `{ "bootstrap": [] }` silently
Return the resulting config.

LLM detector: spawn `claude -p --output-format=json --json-schema <bootstrap-schema>` with the
content of `src/prompts/bootstrap-detect.md`. Parse the JSON response. Show commands, files
inspected, reasoning, and any blockers to the user.

### cpe bootstrap subcommand (src/commands/bootstrap.ts)
- No flags: same as `ensureRepoConfig` but always shows the menu even if config exists (overwrites)
- `--detect`: skips the menu, runs LLM detection directly
- `--stub`: skips the menu, writes the stub template and opens `$EDITOR`
- `--edit`: opens existing `cpe.config.json` in `$EDITOR` (or stubs first if absent)

## Files Expected to Change

- `src/git/worktree.ts` — created
- `src/git/repo.ts` — created
- `src/config/repo-config.ts` — created
- `src/commands/bootstrap.ts` — created

## Acceptance Criteria

1. `tsc --noEmit` passes
2. `getPrimaryRepo()` returns the correct path when run from inside a git repo
3. `listWorktrees` correctly parses `git worktree list --porcelain` output (write a unit test
   with fixture data — no real git calls needed)
4. `runBootstrap` with a single `echo hello` command writes to the log file and returns success
5. `ensureRepoConfig` writes a valid `cpe.config.json` in all three prompt paths

## Dependencies

Phase 03 (AppConfig type, storage helpers available for use).
