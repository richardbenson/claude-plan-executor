# Phase 09 — `cpe plan` Flow + Queue Processor

## Summary

Implement `cpe plan` (the interactive planning kickoff) and `cpe start` (the queue processing
loop). After this phase the tool is functionally complete end-to-end — TUI output will be added on
top in phases 10-12, but the queue processes correctly with plain stdout logging.

## Context

### cpe plan (src/commands/plan.ts)
Implements spec §7.1:

1. Accept optional plan details from command line: `cpe plan [details...]`
2. If no details given, open a multiline stdin prompt: print "Enter plan details (Ctrl+D to
   finish):" and read until EOF. Trim whitespace.
3. Run `getPrimaryRepo()` to identify the repo root
4. Run `ensureRepoConfig(repoPath)` (from Phase 04)
5. Generate a run ID (`ulid()`), create a temp branch name `cpe/planning-<timestamp>`
6. Create worktree via `createWorktree(repoPath, runId, tempBranch, targetBranch)`
7. Run bootstrap commands; if any fail, remove worktree, delete temp branch, exit 1
8. Assemble the kickoff message: read `src/prompts/planbot.md`, append "\n\n---\n\n", append
   the user's plan details
9. Write the assembled message to a temp file (e.g. `/tmp/cpe-plan-<runId>.md`)
10. Spawn Claude interactively: `claude < <tempFile>` with `cwd: worktreePath`.
    Use `Bun.spawn` with `stdin: 'inherit'`, `stdout: 'inherit'`, `stderr: 'inherit'` so the user
    can interact with the Claude session normally. Wait for Claude to exit.
11. Delete the temp file
12. After Claude exits, scan `<worktreePath>/docs/` for directories containing `PROGRESS.md`
    that did NOT exist before Claude was launched (snapshot the state before step 10)
13. If none found: user bailed. Remove worktree (`git worktree remove --force <path>`) and delete
    temp branch (`git branch -D <tempBranch>` from primary repo). Print "Planning cancelled." Exit.
14. If found: let folder = the found directory name
    - Rename branch: `git branch -m <tempBranch> feature/<folder>` (from primary repo)
    - Move worktree: `git worktree move <oldPath> <newPath>` where newPath uses the folder name
    - Print "Plan created: docs/<folder>/"
    - Prompt: "Queue this plan now? [Y/n]"
    - If yes: call `queuePlan(repoPath, folder, runId, worktreePath)` — a shared helper that
      does steps 7-12 of the queue command (enumerate phases, commit docs, write meta.json, enqueue)
    - If no: print "Run `cpe queue <folder>` to queue it later." Exit.

Rate-limit during planning (stdout path, spec §8.2): the planbot kickoff does NOT use
`--output-format=json`, so the envelope-based detection isn't available. Monitor the exit code of
the Claude process: if exit code 1, scan stdout for the limit regex. But since this is interactive
(Claude's stdout is inherited by the terminal), we can't read it programmatically. Solution: after
Claude exits with code 1, simply inform the user: "Claude exited with an error. If you hit the
session limit, wait for it to reset and re-run `cpe plan`." (The planning session can be resumed
manually by the user since it's interactive.)

### Queue processor (src/commands/start.ts)
The main loop that drives all execution. Initially (this phase) it uses plain stdout logging;
phases 10-12 will replace the output with the Ink TUI.

`startQueueProcessor(appConfig, bus)`:
```
loop:
  if queue is paused (queue.json.paused === true): wait 5s, continue
  run = dequeue() — pop first entry from queue.json
  if no run: wait 10s, continue
  meta = readMeta(run.runId)

  // Reconcile worktrees on first run of the loop
  // Run bootstrap if not already done (check meta.json.bootstrapped flag)

  for each pending/executing phase in meta.phases:
    result = await runPhase(run.runId, phase.number, appConfig, bus)
    if result.outcome === 'paused':
      // Rate-limit hit: wait for reset then decide restart vs resume
      await waitUntil(result.resumeAt)
      // Re-read meta to get hadWork; call resumeOrRestart
      continue (retry the same phase)
    if result.outcome === 'failed':
      break (run is marked failed; move to next queued run)
    // outcome === 'complete': continue to next phase

  if all phases complete:
    await finaliseRun(run.runId, bus)

  continue loop
```

Stdout logging (before TUI):
- Before each phase: `[cpe] Starting phase NN — <name>`
- After each phase: `[cpe] Phase NN complete (cost: $X.XX)`
- On rate-limit pause: `[cpe] Rate limit hit. Resuming at <time>.`
- On run complete: `[cpe] Run complete. PR: <url>`
Use `console.log` here (yes, despite the ESLint warning — the TUI phases replace these logs).

Worktree reconciliation on startup: call `reconcileWorktrees` from Phase 04 for each unique
primary repo in the queue. For any orphaned worktrees (in git but not in meta.json), print a
warning. For any missing worktrees (in meta.json but git says they're gone): if the run is
`executing`, ask user: "[r]esume / [f]ail / [s]kip". Handle the choice.

## Files Expected to Change

- `src/commands/plan.ts` — created (replaces the Phase 05 stub)
- `src/commands/start.ts` — created (replaces the Phase 05 stub)
- `src/commands/queue.ts` — updated: extract `queuePlan()` as a shared helper callable from
  plan.ts without going through the CLI layer

## Acceptance Criteria

1. `tsc --noEmit` passes
2. `cpe plan "add tests for auth"` creates a worktree, spawns Claude interactively, and (after
   Claude exits) either cleans up or offers to queue the plan
3. If user cancels the plan (no `docs/` folder produced), the worktree is removed and the temp
   branch is deleted
4. The queue processor loop dequeues runs, calls `runPhase` for each phase, and calls
   `finaliseRun` after the last phase completes
5. Rate-limit pause: the loop sleeps until `resumeAt` then calls `resumeOrRestart`

## Dependencies

Phase 08 (runPhase, finaliseRun, all runner primitives complete).
