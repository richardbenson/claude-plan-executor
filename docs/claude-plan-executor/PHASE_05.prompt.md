Read docs/claude-plan-executor/PHASE_05.md for full context before starting.

You are implementing phase 05 of the Claude Plan Executor (`cpe`) project. This phase wires all
non-TUI CLI commands using commander and implements the queue, list, status, remove, and clean
commands fully. The `plan` and `start` commands get stubs here; their real implementations come
in Phase 09.

Working directory: /home/ubuntu/Code/claude-plan-executor
Branch: feature/claude-plan-executor-phase-5 (create it off feature/claude-plan-executor)
PR target: feature/claude-plan-executor

Before writing anything, read:
- docs/000-claude-plan-executor-spec.md §6 (CLI surface table)
- src/types/meta.ts (RunMeta, AppQueue, AppConfig interfaces)
- src/storage/meta.ts (readMeta, writeMeta, updateMeta)
- src/storage/queue.ts (readQueue, writeQueue, enqueue, dequeue, removeFromQueue)
- src/git/repo.ts (getPrimaryRepo)
- src/git/worktree.ts (createWorktree, removeWorktree, WORKTREE_BASE)
- src/config/repo-config.ts (ensureRepoConfig, runBootstrap)

FILE: src/cli.ts

Central command registration. Import `program` from commander. Register all subcommands by
importing their handler functions. Export a `setupCli()` function called from src/index.ts.

Register these subcommands:
  plan [details...]     — handler: planCommand (stub in this phase)
  queue [folder]        — handler: queueCommand
  start                 — handler: startCommand (stub in this phase)
  status                — handler: statusCommand
  list                  — handler: listCommand
  remove <run-id>       — handler: removeCommand
  pause                 — handler: pauseCommand
  resume                — handler: resumeCommand
  clean                 — handler: cleanCommand, with option --all
  bootstrap             — handler: bootstrapCommand, with options --detect, --stub, --edit

All handlers are async. Wrap each in a try/catch that prints the error message and exits 1.

FILE: src/index.ts (update from Phase 01)

Import setupCli from src/cli.ts. Call setupCli() then program.parse(). Remove any placeholder
comments about subcommands (they're now real).

FILE: src/commands/queue.ts

queueCommand(folder?: string): Promise<void>

1. Get primary repo: getPrimaryRepo() — catch and print friendly error if not in a git repo
2. Read app config: readConfig()
3. Call ensureRepoConfig(repoPath, config.gitea_host) to check/create bootstrap config
4. If folder is undefined: scan primary repo's docs/ directory for subdirectories containing
   PROGRESS.md. If none, print "No plans found in docs/. Run `cpe plan` to create one." and exit.
   If one or more found, list them numbered and prompt "Pick a plan: ". Read one line from stdin.
   If invalid choice, exit 1.
5. Validate: docs/<folder>/PROGRESS.md exists in primary repo. At least one PHASE_*.prompt.md
   exists in docs/<folder>/. If either fails, print specific error and exit 1.
6. Generate run ID: ulid()
7. Set feature branch: 'feature/' + folder
8. Set target branch: config.target_branch ?? 'main'
9. Create worktree: createWorktree(repoPath, runId, featureBranch, targetBranch)
   On failure: print error, exit 1
10. Run bootstrap: runBootstrap(worktreePath, repoConfig.bootstrap, logsDir + '/bootstrap.log')
    logsDir = getLogsDir(runId). On failure: print "Bootstrap failed: <failedCommand> (exit <code>)".
    Print "Run logs at: <logsDir>/bootstrap.log". Mark run status 'failed' in meta, exit 1.
11. Enumerate phases: glob 'PHASE_*.prompt.md' in worktreePath/docs/<folder>/, sort numerically.
    Build phases array: each entry has number (parsed from filename), prompt_file (filename),
    status: 'pending', retry_count: 0.
12. Detect remote: try getRemote(repoPath, config.gitea_host); catch → remote = undefined
13. Write meta.json: writeMeta(runId, { id: runId, primary_repo_path: repoPath, worktree_path,
    plan_folder: folder, feature_branch: featureBranch, target_branch: targetBranch, remote,
    status: 'queued', total_cost_usd: 0, bootstrapped: true, phases })
14. Commit the docs folder to the feature branch (run inside worktree):
    git add docs/<folder> && git commit -m "docs: plan <folder>"
    (Use Bun.spawnSync with cwd: worktreePath)
15. Enqueue: enqueue(runId)
16. Print: "Queued: <folder> (<phases.length> phases) — run ID <runId.slice(0,8)>..."
    "Worktree: <worktreePath>"
    "Run `cpe start` to begin execution."

Helper function queuePlan(repoPath, folder, runId, worktreePath, config, repoConfig) — extracts
steps 11-16 as a shared function callable from plan.ts in Phase 09 without re-entering the CLI.
Export this function.

FILE: src/commands/list.ts

listCommand(): Promise<void>

Read queue. If empty, print "Queue is empty." and return. For each entry, readMeta(run_id).
Print a formatted table using simple string padding (no external table library):
  #   ID        REPO/PLAN                    STATUS      PHASES
  1   01JXYZ…   meatbot/001-add-tests         queued       0/5
  2   01JABC…   bird-det/001-yolo             queued       0/11
Truncate long fields to fit 80 columns. ID is the first 8 chars of the full ULID.
Count completed phases as phases where status === 'complete'.

FILE: src/commands/status.ts

statusCommand(): Promise<void>

Read queue. Count runs by status across all meta.json files. Print a one-liner:
  "Queue: N run(s) — M executing, K queued, J paused"
  "Total phases: P (Q complete, R pending)"
If queue empty: "Queue is empty. Run `cpe queue` to add a plan."

FILE: src/commands/remove.ts

removeCommand(runId: string): Promise<void>

Find the run: scan queue entries for a run_id that starts with runId (allow prefix match on the
first 8 chars). If none found, print "Run not found: <runId>" and exit 1.
If the run's meta.json status is 'executing', print:
  "Cannot remove an actively executing run. Use K from the TUI to kill the session first."
  Exit 1.
Prompt: "Remove run <shortId> (<plan_folder>) from the queue? [y/N] "
On n/empty: print "Cancelled." and return.
On y: removeFromQueue(runId). updateMeta(runId, { status: 'failed' }).
Print "Removed."

FILE: src/commands/clean.ts

cleanCommand(options: { all?: boolean }): Promise<void>

Scan ~/.local/state/cpe/runs/ for directories. For each, readMeta(). Filter to runs with status
'complete' or 'pr-created'. If none, print "Nothing to clean." and return.
For each cleanable run:
  If not options.all: prompt "Remove worktree for <plan_folder> (run <shortId>)? [y/N] "
  On y (or --all): removeWorktree(primary_repo_path, worktree_path, true /* force */);
    fs.rmSync(runDir, { recursive: true });
    removeFromQueue(runId) (in case it's still in queue somehow)
    print "Cleaned: <plan_folder>"
Print summary: "Cleaned N run(s)."

FILE: src/commands/plan.ts (stub only in this phase)

planCommand(details: string[]): Promise<void>
  console.log('cpe plan — not yet implemented (Phase 09)');
  process.exit(0);

FILE: src/commands/start.ts (stub only in this phase)

startCommand(): Promise<void>
  console.log('cpe start — not yet implemented (Phase 09)');
  process.exit(0);

Pause/resume handlers (add inline in cli.ts or as thin functions):
pauseCommand: read queue, set paused: true, writeQueue. Print "Queue paused."
resumeCommand: read queue, set paused: false, writeQueue. Print "Queue resumed."

VERIFY before committing:
1. bun run build produces ./cpe
2. ./cpe --help lists all subcommands
3. ./cpe list (with empty queue) prints "Queue is empty."
4. ./cpe status (with empty queue) prints the empty-queue message
5. ./cpe remove bad-id prints "Run not found" and exits 1
6. ./cpe clean (with no complete runs) prints "Nothing to clean."
7. bun run typecheck passes

After all criteria pass:
1. git add src/cli.ts src/index.ts src/commands/
2. git commit -m "feat: phase 05 — CLI parsing and non-TUI commands"
3. git push -u origin feature/claude-plan-executor-phase-5
4. Create PR targeting feature/claude-plan-executor

Update docs/claude-plan-executor/PROGRESS.md on start and completion.

Your final message in this conversation must be a JSON object matching the schema you have been
given. Do all your work using tools first, then emit only the JSON as your closing message.
