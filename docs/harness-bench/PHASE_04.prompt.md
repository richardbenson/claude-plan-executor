Read docs/harness-bench/PHASE_04.md and docs/harness-bench/README.md before starting. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Depends on Phase 02 (Phase 03 recommended so you can validate on a local model for free).

Goal: add full-clone isolation per run (cloned from where cpe was started), post-run result capture, harnesstests branch push, an activity-based timeout with process-tree kill plus a manual bail, and a configurable inter-run pause.

Files to create/modify and why:
- src/git/clone.ts (new): clone a source repo+branch into a fresh unique temp dir per run, and provide cleanup. The default source is the baseline detected from the CWD - the repo from getPrimaryRepo() at getCurrentBranch() (both already in src/git/repo.ts, the same detection the plan tool uses) - overridable per run. Do NOT hardcode any repo or the modeltests/sandbox-no-docs branch. Mirror the spawn(args, cwd) helper and error handling style in src/git/worktree.ts. Default the base dir alongside the existing WORKTREE_BASE convention (e.g. ~/.local/state/cpe/clones/<runId>).
- src/runner/capture.ts (new): given a finished run (RunMeta + HarnessResult + clone path + base ref), compute git diff and git diff --stat against the baseline branch the clone started from, gather wall-clock duration, outcome, the transcript (run log from getLogsDir), and tokens/costUsd if present on the HarnessResult. Write results/<harness>__<model>/ containing meta.json (a structured summary, including the baseline repo/branch), the diff patch, and the transcript. If meta.remote exists, commit the clone's changes to branch harnesstests/<harness>__<model> and push it - reuse the push/remote handling already in src/vcs/github.ts (and the gitea path) rather than shelling out ad hoc.
- src/types/meta.ts: add isolation ('worktree' | 'clone'), inactivity_timeout_seconds (the no-new-output window), an optional max_runtime_seconds (absolute cap, default off/very-large), and pause_seconds to AppConfig (and DEFAULT_CONFIG), plus the per-run baseline fields (bench_repo, bench_branch defaulting to the detected CWD repo/current branch) and timeout/outcome fields on RunMeta. Defaults must keep non-bench runs on the existing worktree path and impose no timeout/pause unless configured.
- The dispatch site (src/runner/single-prompt.ts, and wherever runs are executed): when isolation is 'clone', create the clone via src/git/clone.ts (from the baseline repo/branch) and use it as the run cwd. Wrap adapter.run(ctx) with an ACTIVITY-BASED timeout: keep the run alive as long as the harness streams new output, resetting the inactivity timer on each new line, but ignore lines that are merely the previous line repeated (a stuck/looping harness must not stay alive forever); only after inactivity_timeout_seconds with no new activity (or, if set, max_runtime_seconds total) kill the entire spawned process tree (not just the direct child - harnesses fork) and yield outcome 'timeout'. Also honour a cancel/bail signal that does the same process-tree kill and records the run as 'bailed' (the TUI keybind is wired in Phase 06; build the cancel plumbing here). After the run (any outcome), call capture.
- src/commands/start.ts: after each run completes, sleep pause_seconds before dequeuing the next (so Ollama can evict the previous model). Make it interruptible/cancellable cleanly.

Patterns and edge cases:
- Activity detection should read the same streamed stdout/log the live tail will consume in Phase 06 - don't build a second, divergent reader. Repetition detection can be simple (e.g. identical-to-previous line, or a short ring buffer that is all the same line); document the heuristic.
- Process-tree kill: spawn the harness in its own process group and kill the group on timeout/bail; ensure no orphaned children survive (this matters - we observed 27-minute runaways).
- Branch/path naming: <harness>__<model> with model slugified (replace : and / with -) so it is filesystem- and ref-safe.
- Cloning uses the local repo as the source so it works offline; pushing harnesstests/* requires the remote - if there is no remote, capture locally and skip push (do not error).
- Clean up clone dirs on success but keep them on failure/timeout/bail for debugging (configurable); never delete anything outside the cpe state dir.

Acceptance criteria:
- bun run build, lint, and existing tests pass.
- A claude-code run with isolation 'clone' against gemma4-cpe:31b clones the CWD repo at its current branch, executes, writes results/claude-code__gemma4-cpe-31b/{meta.json,diff,transcript} (meta.json records the baseline repo/branch), and (with a remote) pushes harnesstests/claude-code__gemma4-cpe-31b.
- A run that keeps producing new output is NOT killed; a run that goes silent (or only repeats the same line) past inactivity_timeout_seconds is killed with no surviving child processes and recorded as outcome 'timeout'.
- A user bail kills the run (no surviving children) and records it as 'bailed', and capture still runs on whatever changed.
- The configured pause is observed between two queued runs.
- Non-bench (default worktree, no timeout/pause) runs are unaffected.

When done, update docs/harness-bench/PROGRESS.md (Phase 04 complete, date) and commit the phase on feature/harness-bench.
