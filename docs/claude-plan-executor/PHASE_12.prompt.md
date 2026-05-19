Read docs/claude-plan-executor/PHASE_12.md for full context before starting.

You are implementing phase 12 of the Claude Plan Executor (`cpe`) project. This is the final phase:
Manage mode (triptych layout), command palette, kill-confirmation modal, and phase drilldown.

Working directory: /home/ubuntu/Code/claude-plan-executor
Branch: feature/claude-plan-executor-phase-12 (create it off feature/claude-plan-executor)
PR target: feature/claude-plan-executor

CRITICAL: Read docs/DESIGN.md §5 (Manage anatomy, §5.1 selection model, §5.2 keybinds, §5.3
status line, §5.4 command palette, §5.5 kill modal) and §6 (phase drilldown) in full before
writing any component. The design doc is the source of truth.

Read these existing files before starting:
- src/tui/App.tsx (where Manage will be mounted — replace the placeholder)
- src/tui/theme.ts, src/tui/state.ts (colours and state helpers)
- src/tui/hooks/useQueueState.ts (QueueState hook from Phase 11)
- src/tui/components/StateChip.tsx, Spinner.tsx, Sparkline.tsx
- src/events/bus.ts, src/events/types.ts
- src/storage/meta.ts (readMeta, updateMeta, updatePhase)
- src/storage/queue.ts (readQueue, writeQueue)
- src/runner/phase-loop.ts (for retry/skip operations)

FILE: src/tui/Manage.tsx

Props: { columns: number; rows: number }

State:
- focusedPane: 'queue' | 'phases' | 'executing' — useState('queue')
- selectedRunIndex: number — useState(0)
- selectedPhaseIndex: number — useState(0)
- showPalette: boolean — useState(false)
- killConfirm: boolean — useState(false)
- drilldown: { runId: string; phaseNumber: number } | null — useState(null)

If drilldown is set: render <Drilldown runId={drilldown.runId} phaseNumber={drilldown.phaseNumber}
  onClose={() => setDrilldown(null)} columns={columns} rows={rows} />

Otherwise render the triptych:
<Box flexDirection="column" width={columns} height={rows-2}>
  <Box flexDirection="row" height={rows-5}>
    <QueuePane ... />
    <Text color={borderHi}> · </Text>
    <PhasesPane ... />
    <Text color={borderHi}> · </Text>
    <ExecutingPane ... />
  </Box>
  <StatusLine ... />
  <CommandBar focusedPane={focusedPane} queuePaused={isPaused} sessionActive={sessionActive} />
</Box>
{showPalette && <CommandPalette onClose={() => setShowPalette(false)} onRun={handlePaletteCommand} />}
{killConfirm && <KillConfirmModal ... onConfirm={handleKill} onCancel={() => setKillConfirm(false)} />}

useInput key handling (DESIGN.md §5.2):
- Tab: cycle focusedPane (queue → phases → executing → queue)
- ArrowUp / ArrowDown (or k/j for vim): move selection in focused pane
- Option+ArrowUp / Option+ArrowDown: reorder queue (only in 'queue' pane)
  Reorder: read queue, move selectedRunIndex entry up/down, writeQueue, re-fetch.
- Return: if 'queue' pane → open phases for selected run (selectedPhaseIndex = 0, focusedPane = 'phases')
          if 'phases' pane → open drilldown
- 'p': toggle isPaused (writeQueue with { paused: !isPaused }); emit PauseEvent on activityBus
- 'r': remove selected run — prompt inline (briefly show "Press r again to confirm")
- 'R': retry current phase — kill session (send SIGTERM to PID stored in meta.json), then call
  updatePhase(runId, phaseNumber, { status: 'pending', retry_count: 0 }) and updateMeta to
  'queued' — the queue processor will pick it up. Confirm first with a brief inline message.
- 'S': skip phase — updatePhase(runId, phaseNumber, { status: 'failed', summary: 'skipped by user' })
  then updateMeta advancing to next phase status 'pending'. Brief confirmation.
- 'K': setKillConfirm(true)
- 'e': Bun.spawn([$EDITOR ?? 'vi', meta.worktree_path], { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' })
- 'l': Bun.spawn([$PAGER ?? 'less', logPath], { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' })
- ':': setShowPalette(true)
- 'q': if sessionActive → showQuitConfirm (from App.tsx); else process.exit(0)
- 'v': handled by App.tsx (toggle mode)
- Escape: if drilldown → setDrilldown(null); if showPalette → setShowPalette(false);
           if killConfirm → setKillConfirm(false)
- 'a': Bun.spawn(['cpe', 'queue'], { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' })
       (runs cpe queue interactively in a sub-process)

For session kill: store the active claude PID in meta.json during phase execution. Add a
`claude_pid?: number` field to RunMeta (update src/types/meta.ts). The phase loop writes this
before awaiting the session. The kill handler: process.kill(pid, 'SIGTERM'); setTimeout(() =>
{ try { process.kill(pid, 'SIGKILL'); } catch {} }, 5000).

FILE: src/tui/components/QueuePane.tsx

Props: { runs: RunMeta[]; selectedIndex: number; focused: boolean; onSelect: (i: number) => void }

borderStyle="round", width=14, borderColor={focused ? cyan : border}
Title: "QUEUE · " + runs.length

Each run occupies 4 rows (DESIGN.md §5):
Row 1: (selected ? '▶ ' : '  ') + repoBasename (truncated to 9 chars)
Row 2: '  /' + planFolder (truncated to 10 chars)
Row 3: '  ' + <StateChip status={run.status} /> + ' ' + completePhases + '/' + totalPhases
Row 4: (executing? show a short progress bar of width 8; otherwise empty)

Selected row group: backgroundColor={bgFloat} on all 4 rows. Left edge '┃' in cyan.

File: src/tui/components/PhasesPane.tsx

Props: { phases: PhaseEntry[]; selectedRun: RunMeta | null; selectedIndex: number; focused: boolean; onSelect: (i: number) => void; isPaused: boolean }

borderStyle="round", flexGrow=1, borderColor={focused ? cyan : border}
Title: "PHASES" + (selectedRun ? ' · ' + selectedRun.plan_folder : '')

If isPaused: show dim caption "queue paused — phases will not start"

Each phase: one row.
Format: <StateChip status={phase.status} showLabel={false} />
  ' ' + String(phase.number).padStart(2,'0')
  ' ' + phaseName (derived from prompt_file: PHASE_02.prompt.md → '02')
  (if cost_usd: '  $' + phase.cost_usd.toFixed(3))
Truncate phaseName+cost to fit pane width.

Selected phase: backgroundColor={bgHi}.

FILE: src/tui/components/ExecutingPane.tsx

Props: { runMeta: RunMeta | null; events: ActivityEvent[]; focused: boolean }

borderStyle="round", width=26, borderColor={focused ? cyan : border}
Title: "EXECUTING" + (runMeta ? ' · ' + runMeta.primary_repo_path.split('/').pop() : '')

If no runMeta or activePhase: <Text color={dim}> idle </Text>

Otherwise:
Line 1: phaseName (from activePhase.prompt_file)
Line 2: 'session ' + (activePhase.session_id?.slice(0,8) ?? '—') + '…'
Line 3: separator '····················'
Line 4: 'TOOL CALLS ' + toolCallCount (count Edit+Bash events for this phase)
Lines 5+: Last N tool events from the activity buffer for this phase (newest first):
  For Edit/Bash events:
    (completed ? '✓' : <Spinner />) + ' ' + kind + ' ' + description.slice(0,14) + durationStr
  Truncate to available height.

Line near bottom: 'tokens ' + formatTokens(input + cache_read) + ' + ' + formatTokens(cache_creation)
Line: 'cost   $' + phase.cost_usd.toFixed(3) + ' phase'
formatTokens: divide by 1000, format as '4.2k' or '33k'.

FILE: src/tui/components/CommandBar.tsx

Props: { focusedPane: 'queue'|'phases'|'executing'; queuePaused: boolean; sessionActive: boolean }

Two rows:
Row 1 (QUEUE ops): 'QUEUE  ↑↓ select  ⌥↑↓ reorder  ↵ phases  '
  + (queuePaused ? color(yellow,'p RESUME') : 'p pause') + '  r remove  a add plan'
Row 2 (RUN ops): 'RUN    R retry phase  S skip phase  K kill session  e $EDITOR  l log  : palette'

Inactive keybinds (no session): dim K, R, S, l. Active: color with fg.

FILE: src/tui/components/CommandPalette.tsx

Props: { onClose: () => void; onRun: (command: string) => void; visible: boolean }

If !visible: return null.
Modal overlay: render a Box filling the terminal with a dim background (spaces in bgFloat color),
then position the palette card absolutely (Ink doesn't have absolute positioning — use a Box with
marginTop and marginLeft computed to centre the 80×26 card).

Commands list (define as a typed array of { category, name, description, action }):
- queue: move up, move down, pause/resume, add plan, remove run, remove run + worktree
- run: retry phase, skip phase, kill session, open worktree, tail phase log, open PR

useInput inside the palette component to capture ↑↓ (select), ↵ (run and close), Esc (close).
Filter commands by the query string using simple substring match.

Use ink-text-input for the query input field: import TextInput from 'ink-text-input'.
Add ink-text-input: bun add ink-text-input.

FILE: src/tui/components/KillConfirmModal.tsx

Props: { runMeta: RunMeta; phaseEntry: PhaseEntry; elapsedMs: number;
         onConfirm: () => void; onCancel: () => void }

Modal: 56×14 Box, borderStyle="round", borderColor={red}, backgroundColor={bgFloat}
Title: '⚠ KILL SESSION'

Content (DESIGN.md §5.5 exactly):
'Force-kill the running phase?'
''
'run     ' + runMeta.plan_folder
'phase   ' + phaseEntry.number + ' · ' + phaseName
'session ' + phaseEntry.session_id?.slice(0,8) + '…'
'elapsed ' + formatDuration(elapsedMs) + ' · $' + (phaseEntry.cost_usd ?? 0).toFixed(3) + ' spent so far'
''
'This will:'
'  · send SIGTERM to claude, then SIGKILL after 5s'
'  · mark phase ' + phaseEntry.number + ' failed, do NOT retry'
'  · pause the run; queue advances to next'
''
'                              [n] cancel    [K] kill'

useInput: 'K' → onConfirm(); 'n' | Escape → onCancel().

FILE: src/tui/Drilldown.tsx

Props: { runId: string; phaseNumber: number; onClose: () => void; columns: number; rows: number }

Full-screen split: left pane (cols 0-47) phase list, right pane (cols 49 to columns-1) details.

Left pane — phase list with cursor (same rendering as PhasesPane but without the outer border,
full height). useInput for ↑↓ to change selected phase, Esc to call onClose.

Right pane content (DESIGN.md §6):
1. Metadata row: <StateChip status> · sha[:7] · retry_count retries · duration · $cost · tokens
2. "Summary:" + phase.summary
3. "Commit:" + (phase.commit_message ?? '—')
4. "Notes for next:" + (phase.notes_for_next_phase || '—') (wrap at pane width)
5. "Session log:" + last 15 ActivityEvents for this phase from activityBus.getBuffer()
   filtered by runId + phaseNumber. Render one line each in compact format.
6. "Stdout tail:" + last 3 lines of the phase log file (read synchronously with fs.readFileSync,
   split on newlines, take last 3).

Right-pane keybinds (show in a footer row within the drilldown):
'↑↓ phase  l log  e edit  r retry  s skip  d diff  Esc back'

Handle 'l', 'e', 'd' by spawning sub-processes:
- l: Bun.spawn([$PAGER || 'less', logPath], inherited stdio)
- e: Bun.spawn([$EDITOR || 'vi', phase.prompt_file_absolute_path], inherited stdio)
- d: Bun.spawn(['git', 'diff', headBefore + '..' + commitSha], { cwd: worktreePath }, inherited stdio via $PAGER)

Update src/tui/App.tsx: replace the Manage placeholder with the real <Manage /> component.

Add a StatusLine component inline in Manage.tsx (no separate file needed):
"selected  {repoName}/{planFolder} · {status} · {position}th · eta ~Xh"
"          worktree {runId[:8]} · {diskSize estimate}"
diskSize: statSync the worktree path and format as MB (rough estimate using lstatSync or du).

VERIFY before committing (requires running the full cpe binary):
1. bun run typecheck passes
2. bun run build produces ./cpe
3. 'v' in Watch → Manage; 'v' in Manage → Watch
4. Tab cycles pane focus: queue → phases → executing → queue (border colour changes to cyan)
5. ↑↓ moves selection; border glyph ┃ appears on selected row in cyan
6. ↵ on a queue row shows phases for that run
7. ↵ on a phase row opens drilldown; Esc closes it
8. ':' shows the command palette; typing filters commands; Esc dismisses
9. 'K' shows the kill modal; 'n' dismisses it

After all criteria pass:
1. git add src/tui/Manage.tsx src/tui/Drilldown.tsx src/tui/components/QueuePane.tsx
   src/tui/components/PhasesPane.tsx src/tui/components/ExecutingPane.tsx
   src/tui/components/CommandBar.tsx src/tui/components/CommandPalette.tsx
   src/tui/components/KillConfirmModal.tsx src/tui/App.tsx (updated) src/types/meta.ts (claude_pid field)
2. git commit -m "feat: phase 12 — TUI Manage mode and phase drilldown"
3. git push -u origin feature/claude-plan-executor-phase-12
4. Create PR targeting feature/claude-plan-executor

Update docs/claude-plan-executor/PROGRESS.md on start and completion. Set the final phase to
complete and add a "Project complete" note.

Your final message in this conversation must be a JSON object matching the schema you have been
given. Do all your work using tools first, then emit only the JSON as your closing message.
