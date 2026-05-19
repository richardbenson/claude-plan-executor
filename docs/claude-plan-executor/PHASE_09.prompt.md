Read docs/claude-plan-executor/PHASE_09.md for full context before starting.

You are implementing phase 09 of the Claude Plan Executor (`cpe`) project. This phase implements
`cpe plan` (the interactive planning kickoff) and `cpe start` (the queue processing loop). After
this phase the tool is functionally end-to-end — every command works with plain stdout output.
The TUI replaces the stdout logging in phases 10-12.

Working directory: /home/ubuntu/Code/claude-plan-executor
Branch: feature/claude-plan-executor-phase-9 (create it off feature/claude-plan-executor)
PR target: feature/claude-plan-executor

Before writing anything, read:
- docs/000-claude-plan-executor-spec.md §7.1 (cpe plan flow — all steps)
- docs/000-claude-plan-executor-spec.md §7.2 (queueing details)
- docs/000-claude-plan-executor-spec.md §10 (resilience requirements)
- src/commands/queue.ts — the queuePlan() helper you'll call from plan.ts
- src/runner/phase-loop.ts — runPhase(), resumeOrRestart()
- src/runner/finalise.ts — finaliseRun()
- src/runner/limit.ts — waitUntil()
- src/git/worktree.ts — createWorktree, removeWorktree, deleteBranch, reconcileWorktrees
- src/storage/meta.ts — readMeta, updateMeta
- src/storage/queue.ts — readQueue, isQueuePaused, dequeue
- src/prompts/index.ts — PLANBOT_PROMPT

FILE: src/commands/plan.ts

Replace the Phase 05 stub with the full implementation.

planCommand(details: string[]): Promise<void>

1. Determine plan details. If details.length === 0:
   Print: "Enter plan details (Ctrl+D when done):"
   Read stdin until EOF: const input = await readStdinToEof(). Trim.
   If empty after trim: print "No details provided. Exiting." and exit 0.
   details = [input]
   If details.length > 0 from args: join with space.
   planDetails = details.join(' ').trim()

2. Get primary repo: getPrimaryRepo(). On error: print error, exit 1.

3. Read app config: readConfig().

4. Ensure repo config: await ensureRepoConfig(repoPath, config.gitea_host).

5. Generate run ID: ulid(). Timestamp: Date.now().
   tempBranch = 'cpe/planning-' + Date.now()

6. Create worktree: await createWorktree(repoPath, runId, tempBranch, config.target_branch ?? 'main')
   On error: print "Failed to create worktree: " + err.message. Exit 1.

7. Run bootstrap: runBootstrap(worktreePath, repoConfig.bootstrap, logsDir + '/bootstrap.log').
   On failure: removeWorktree(repoPath, worktreePath, true); deleteBranch(repoPath, tempBranch).
   Print "Bootstrap failed. Worktree cleaned up." Exit 1.

8. Snapshot docs/ before Claude starts:
   const docsBefore = listDocsFolders(worktreePath) — helper that returns Set<string> of
   subdirectory names in <worktreePath>/docs/ that contain PROGRESS.md. If docs/ doesn't exist,
   return empty Set.

9. Assemble kickoff message:
   const message = PLANBOT_PROMPT + '\n\n---\n\n' + planDetails
   Write to temp file: const tmpFile = os.tmpdir() + '/cpe-plan-' + runId + '.md'
   Bun.write(tmpFile, message)

10. Spawn Claude interactively:
    Print: "\n🚀 Starting planning session. Claude will guide you through creating the plan.\n"
    Print: "   When done, exit Claude (Ctrl+D or type 'exit').\n\n"
    const proc = Bun.spawn(['claude'], {
      cwd: worktreePath,
      stdin: Bun.file(tmpFile),   // seeds the first message; Claude still goes interactive
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await proc.exited
    const exitCode = proc.exitCode

11. Delete temp file: fs.unlinkSync(tmpFile) — wrap in try/catch, swallow errors.

12. Check for rate-limit (exit code 1 means something went wrong; we can't parse stdout since it
    was inherited). Print: "Claude exited with code " + exitCode + ". If you hit the session
    limit, wait for the window to reset and re-run `cpe plan`."
    Do not abort — still check for a plan folder below.

13. Discover new docs folders:
    const docsAfter = listDocsFolders(worktreePath)
    const newFolders = [...docsAfter].filter(f => !docsBefore.has(f))

14. Handle outcomes:
    If newFolders.length === 0:
      print "No plan folder found in docs/. Planning cancelled."
      removeWorktree(repoPath, worktreePath, true)
      deleteBranch(repoPath, tempBranch)
      Exit 0.
    If newFolders.length > 1:
      print "Multiple new folders found: " + newFolders.join(', ')
      print "Unexpected — using the first one: " + newFolders[0]
    const folder = newFolders[0]

15. Rename branch and move worktree:
    const featureBranch = 'feature/' + folder
    renameWorktreeBranch(repoPath, tempBranch, featureBranch)
    const newWorktreePath = path.join(WORKTREE_BASE, folder + '-' + runId.slice(0, 8))
    moveWorktree(repoPath, worktreePath, newWorktreePath)
    worktreePath = newWorktreePath
    Print: "\nPlan created: docs/" + folder + "/"

16. Prompt to queue:
    process.stdout.write("Queue this plan now? [Y/n] ")
    const answer = await readOneLine()
    If answer.toLowerCase() === 'n': print "Run `cpe queue " + folder + "` to queue it later."
    Else: await queuePlan(repoPath, folder, runId, worktreePath, config, repoConfig)
          print "Run `cpe start` to begin execution."

Helper readStdinToEof(): Promise<string> — reads process.stdin in text mode until EOF. Use
process.stdin as an async iterable (for await chunk of process.stdin).
Helper readOneLine(): Promise<string> — reads one line from process.stdin.
Helper listDocsFolders(worktreePath): Set<string> — scans <worktreePath>/docs/ using fs.readdirSync,
filters to directories that contain 'PROGRESS.md'.

FILE: src/commands/start.ts

Replace the Phase 05 stub with the queue processor. This version uses console.log output; the
TUI replaces it in Phase 10.

startCommand(): Promise<void>
  const config = readConfig()
  const bus = activityBus  // imported from src/events/bus.ts
  // Subscribe to bus to print activity to stdout (temporary, replaced in Phase 10)
  const unsub = bus.subscribe(event => {
    const ts = new Date().toTimeString().slice(0, 8)
    console.log(ts, event.kind, 'runId=' + event.runId.slice(0,8))
  })
  await runQueueProcessor(config, bus)
  unsub()

runQueueProcessor(config: AppConfig, bus: ActivityBus): Promise<void>
  Infinite loop:
  1. Check paused: if isQueuePaused(): await Bun.sleep(5_000); continue
  2. Dequeue: const runId = dequeue(). If null: await Bun.sleep(10_000); continue
  3. const meta = readMeta(runId)
  4. Reconcile worktrees (once per unique primary_repo_path encountered):
     Use a Set<string> of already-reconciled repos to avoid repeating per run.
     Call reconcileWorktrees(meta.primary_repo_path, [runId]).
     If any orphaned: console.warn("Orphaned worktrees found: " + orphaned.map(w=>w.path).join(', '))
     If any missing: handle per §10 — print warning and mark run failed; continue to next run.
  5. Phase loop:
     for (const phase of meta.phases.filter(p => p.status !== 'complete')):
       if (phase.status === 'executing'): // crash recovery — already started
         console.log("[cpe] Resuming interrupted phase " + phase.number + " for run " + runId.slice(0,8))
       console.log('[cpe] Starting phase ' + phase.number + '/' + meta.phases.length)
       let phaseResult = await runPhase(runId, phase.number, config, bus)

       while (phaseResult.outcome === 'paused'):
         console.log('[cpe] Rate limit. Waiting until ' + phaseResult.resumeAt.toISOString())
         await waitUntil(phaseResult.resumeAt)
         phaseResult = await resumeOrRestart(runId, phase.number, config, bus)

       if (phaseResult.outcome === 'failed'):
         console.log('[cpe] Run ' + runId.slice(0,8) + ' failed at phase ' + phase.number)
         break  // move to next queued run
       console.log('[cpe] Phase ' + phase.number + ' complete ($' + (phaseResult.result.summary ?? '') + ')')

  6. Check if all phases complete:
     const finalMeta = readMeta(runId)
     if (finalMeta.phases.every(p => p.status === 'complete')):
       console.log('[cpe] All phases done. Finalising...')
       const { prUrl } = await finaliseRun(runId, bus)
       console.log('[cpe] Done! PR: ' + prUrl)
     // Then loop continues — dequeue next run

Export runQueueProcessor so Phase 10 can import it without going through the CLI layer.

VERIFY before committing:
1. bun run typecheck passes
2. cpe plan with no docs/ produces no plan folder → worktree cleaned up, temp branch deleted
3. cpe start with an empty queue prints nothing and loops (test by interrupting with Ctrl+C)
4. The queue processor calls runPhase for each pending phase in order
5. On rate-limit (phaseResult.outcome === 'paused'), the processor calls waitUntil then
   resumeOrRestart — not runPhase again directly

After all criteria pass:
1. git add src/commands/plan.ts src/commands/start.ts src/commands/queue.ts (updated)
2. git commit -m "feat: phase 09 — cpe plan flow and queue processor"
3. git push -u origin feature/claude-plan-executor-phase-9
4. Create PR targeting feature/claude-plan-executor

Update docs/claude-plan-executor/PROGRESS.md on start and completion.

Your final message in this conversation must be a JSON object matching the schema you have been
given. Do all your work using tools first, then emit only the JSON as your closing message.
