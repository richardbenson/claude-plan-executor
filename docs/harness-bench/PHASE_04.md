# Phase 04 - Clone isolation + capture + branch push + activity-timeout + pause

## Summary
Add a full-clone-per-run isolation mode, post-run result capture, `harnesstests/<harness>__<model>`
branch push, an **activity-based timeout** (with process-tree kill) plus a **manual bail**, and a
configurable inter-run pause. Validate with the claude-code adapter on a local model (free, thanks to
Phase 03).

## Context
- Existing isolation is worktree-based: `src/git/worktree.ts` (`createWorktree` does
  `git worktree add <path> -b <branch> <targetBranch>`; base under `~/.local/state/cpe/worktrees`).
  This phase adds a clone path; the locked decision is **full clone** for bench runs (agent-git-safe).
- **Clone source = where cpe was started.** Detect it exactly as the plan tool does: the repo from
  `getPrimaryRepo()` (`git rev-parse --show-toplevel` in the CWD) cloned at `getCurrentBranch()` (both
  in `src/git/repo.ts`). That CWD repo + current branch is the baseline every run starts from; there is
  no hardcoded repo or `modeltests/sandbox-no-docs` branch.
- Run metadata + logs: `src/storage/meta.ts` (`readMeta`/`updateMeta`/`getLogsDir`); `RunMeta` already
  tracks cost/tokens per phase. The bench capture adds a per-run results artifact.
- The queue processor lives in `src/commands/start.ts` / `src/runner/*`; that is where the inter-run
  pause belongs.

## Approach
- `src/git/clone.ts` (new): clone a source repo+branch into a fresh temp dir per run (mirror the
  `spawn` helper style in `worktree.ts`). Default the source to the baseline detected from the CWD
  (`getPrimaryRepo()` + `getCurrentBranch()`), overridable per run. Return the path; provide a
  cleanup. The run's `worktree_path` field can carry the clone path so downstream code is unchanged.
- `src/runner/capture.ts` (new): after a run, compute `git diff` + `--stat` against the clone's base,
  collect wall-clock, outcome, transcript (the run log), and tokens/cost if the `HarnessResult`
  carries them; write `results/<harness>__<model>/meta.json` + the diff + transcript; then commit and
  push `harnesstests/<harness>__<model>` if a remote exists (reuse the push pattern in
  `src/vcs/github.ts` / gitea handling).
- Timeout (**activity-based**, not a fixed wall-clock cap): timeouts should be generous. Keep a run
  alive as long as the harness keeps streaming *new* output; reset the inactivity timer on every new
  line, but ignore lines that are just the previous one repeated over and over (a stuck/looping
  harness must not keep itself alive forever). Only when there has been no *new* activity for the
  configured inactivity window do we kill the whole process tree (the spawned harness may fork
  children) and set outcome `'timeout'`. An optional absolute max-runtime cap may exist but defaults to
  off/very-large. Activity is observed from the run's streamed stdout/log (the same stream the live
  tail consumes - coordinate with Phase 06).
- Manual bail: the user must be able to stop the currently-running combo if they see it misbehaving.
  A bail triggers the same process-tree kill and records the run as `'bailed'` (or `'timeout'` with a
  reason); capture still runs on whatever changes exist. The TUI keybind for this lands in Phase 06,
  but the kill/bail plumbing (a cancel signal the dispatch site honours) is built here.
- Pause: after each run, sleep `appConfig` pause (default 180-240s) before the next dequeue.

## Files expected to change
- `src/git/clone.ts` (new)
- `src/runner/capture.ts` (new)
- `src/runner/single-prompt.ts` (or the dispatch site) - wire timeout + capture
- `src/commands/start.ts` - inter-run pause
- `src/types/meta.ts` - add `inactivity_timeout_seconds` (the no-new-output window), an optional
  `max_runtime_seconds` (absolute cap, default off/very-large), `pause_seconds`, and an
  `isolation: 'worktree'|'clone'` to `AppConfig`/`RunMeta`; add the per-run `bench_repo`/`bench_branch`
  baseline fields (defaulting to the detected CWD repo/branch). Defaults preserve current worktree
  behaviour and impose no timeout/pause for non-bench runs.
