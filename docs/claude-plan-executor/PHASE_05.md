# Phase 05 — CLI Parsing + Non-TUI Commands

## Summary

Wire all non-TUI CLI commands using `commander`. After this phase every command listed in the spec
is reachable from the binary and produces useful output or a clear "not yet implemented" stub for
commands that depend on later phases (runner, TUI).

## Context

### src/cli.ts — command router
Central place where all subcommands are registered with `commander`. `src/index.ts` imports and
calls the setup function from here. Each subcommand handler lives in its own file under
`src/commands/`.

Pattern:
```
program.command('queue [folder]')
  .description('Add a plan to the queue')
  .action(async (folder) => { await queueCommand(folder); });
```

Register: `plan`, `queue`, `start`, `status`, `list`, `remove`, `pause`, `resume`, `clean`,
`bootstrap`.

`plan` and `start` will be stubs in this phase (they depend on the runner and TUI from later
phases). Their stubs must print "Not yet implemented" and exit 0.

### src/commands/queue.ts — `cpe queue [folder]`
1. Run `getPrimaryRepo()` to identify the repo root
2. Run `ensureRepoConfig(repoPath)` to check/create bootstrap config
3. If `folder` given: validate `docs/<folder>/PROGRESS.md` and at least one `PHASE_*.prompt.md`
   exist in the primary repo. If not found, print error and exit 1.
4. If `folder` not given: list subdirs of `docs/` that contain `PROGRESS.md`; let user pick
   (numbered menu)
5. Create a run ID: `ulid()`
6. Create worktree via `createWorktree(repoPath, runId, 'feature/<folder>', '<targetBranch>')`.
   Target branch: `main` by default; configurable in AppConfig.
7. Run bootstrap commands; if any fail, mark run failed and exit 1
8. Enumerate `PHASE_*.prompt.md` files (sorted numerically) → build `phases` array with status
   `pending`
9. Commit the `docs/<folder>/` content to the feature branch: `git add docs/<folder>` then
   `git commit -m "docs: plan <folder>"` (run inside the worktree)
10. Build and write `meta.json` for the run
11. Enqueue the run ID
12. Print confirmation: run ID, folder, worktree path, number of phases

### src/commands/list.ts — `cpe list`
Read queue.json; for each run_id, read meta.json; print a table:
```
  #  run-id (short)  repo/plan               status    phases
  1  01JXYZ...       meatbot/001-add-tests    queued    0/5
  2  01JABC...       bird-det/001-yolo        queued    0/11
```
If queue is empty, print "Queue is empty."

### src/commands/status.ts — `cpe status`
Print one-line summary: "Queue: N runs, M phases total. Currently: <status>."
Exit 0. Designed for scripting (no TUI).

### src/commands/remove.ts — `cpe remove <run-id>`
Accepts full or prefix run-id. Finds match in queue.json. Confirms with user:
"Remove run <id> from the queue? Worktree will be kept. [y/N]"
On confirmation: remove from queue.json, update meta.json status to `failed`.
If the run is currently executing, print warning and refuse (can't remove active run; use `K` from
TUI).

### src/commands/clean.ts — `cpe clean [--all]`
Finds runs in `~/.local/state/cpe/runs/` with status `complete` or `pr-created`. For each:
- Print: "Remove worktree for <repo>/<plan> (run <id>)? [y/N]" (or auto-yes with `--all`)
- On yes: call `removeWorktree`, then `fs.rm` the run directory

### src/commands/pause-resume — `cpe pause` / `cpe resume`
Write a `paused: true/false` field to `~/.local/state/cpe/queue.json`. The queue processor
(Phase 09) reads this flag before dequeuing. Print confirmation.

## Files Expected to Change

- `src/cli.ts` — created
- `src/commands/queue.ts` — created
- `src/commands/list.ts` — created
- `src/commands/status.ts` — created
- `src/commands/remove.ts` — created
- `src/commands/clean.ts` — created
- `src/index.ts` — updated to import and call the CLI setup from `src/cli.ts`

Note: `src/commands/plan.ts` and `src/commands/start.ts` are stubs here; they get their real
implementation in Phase 09.

## Acceptance Criteria

1. `./cpe --help` lists all subcommands
2. `./cpe queue` inside a repo with no `docs/` folder prints an error and exits 1
3. `./cpe list` on an empty queue prints "Queue is empty."
4. `./cpe remove <bad-id>` prints "Run not found" and exits 1
5. `./cpe clean` with no completed runs prints "Nothing to clean."
6. `tsc --noEmit` passes

## Dependencies

Phase 04 (worktree + repo-config functions available).
