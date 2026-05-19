Read docs/claude-plan-executor/PHASE_11.md for full context before starting.

You are implementing phase 11 of the Claude Plan Executor (`cpe`) project. This phase builds the
complete Watch mode layout wired to live data.

Working directory: /home/ubuntu/Code/claude-plan-executor
Branch: feature/claude-plan-executor-phase-11 (create it off feature/claude-plan-executor)
PR target: feature/claude-plan-executor

CRITICAL: Read docs/DESIGN.md §3 (Watch anatomy), §4.1 (user-paused), §4.2 (limit-paused) in
full before writing any component. Also open docs/tui-design.html in a browser to understand the
visual target. The design doc is the source of truth — implement it faithfully.

Read these existing files before starting:
- src/tui/theme.ts (all color constants)
- src/tui/state.ts (getStateStyle)
- src/tui/components/Spinner.tsx
- src/tui/components/Sparkline.tsx
- src/tui/components/StateChip.tsx
- src/tui/components/Header.tsx
- src/tui/App.tsx (where Watch will be mounted — replace the placeholder)
- src/events/bus.ts (activityBus, ActivityEvent, the event kinds)
- src/events/types.ts (all ActivityEvent interfaces)
- src/storage/meta.ts (readMeta)
- src/storage/queue.ts (readQueue)
- src/types/meta.ts (RunMeta, PhaseEntry)

DATA HOOK — useQueueState

Before writing components, create a shared data hook in src/tui/hooks/useQueueState.ts:

interface QueueState {
  activeRun: RunMeta | null;
  activePhase: PhaseEntry | null;
  queuedRuns: RunMeta[];  // queued runs (not yet executing)
  allRuns: RunMeta[];     // all runs in queue
  isPaused: boolean;
  isLimitPaused: boolean;
  limitResumeAt: Date | null;
  phasesCompleteToday: number;
  budgetToday: number;
  commitsToday: number;
  prsToday: number;
  retriesToday: number;
  failuresToday: number;
}

useQueueState(): QueueState — polls every 2 seconds via setInterval in a useEffect. Reads
readQueue() and readMeta() for each run. Derives:
- activeRun: first run with status 'executing' or 'finalising'
- activePhase: the phase in activeRun with status 'executing'
- queuedRuns: runs with status 'queued'
- isPaused: readQueue().paused
- isLimitPaused: activeRun?.status === 'paused-limit'
- limitResumeAt: parse from the most recent LimitEvent in activityBus.getBuffer()
- today stats: filter meta files where completed_at's date === today; sum across all

Export useQueueState. Place it in src/tui/hooks/useQueueState.ts.

FILE: src/tui/Watch.tsx

Props: { columns: number; rows: number }

Uses useQueueState() and activityBus.getBuffer() + subscription for the activity feed.

If queueState.isLimitPaused: render <WatchPaused variant="limit" ... />
If queueState.isPaused: render a version of the layout with the hero replaced by
  <WatchPaused variant="user" ... />
Default: render the full Watch layout.

Full Watch layout (flexDirection="column"):
Row 0: already rendered by App.tsx (<Header>)
Box remaining height: flexDirection="column"
  - <WatchHero queueState={queueState} /> (rows 2-13 area — use a fixed height Box or let it
    auto-size based on content)
  - <Box flexDirection="column"> "LIVE ACTIVITY" header + <ActivityFeed events={events} availableRows={feedRows} /> </Box>
  - <WatchBottomStrip queueState={queueState} columns={columns} />
  - Footer row: <Text color={dim}>tue 17 may · HH:mm:ss BST</Text> right-aligned with
    <Text color={dim2}> v manage  q quit</Text>

feedRows = rows - heroRows - bottomStripRows - headerRows - footerRows (approximately rows - 20).

FILE: src/tui/components/WatchHero.tsx

Props: { queueState: QueueState }

Use borderStyle="round" Box with borderColor based on state:
- executing → cyan
- finalising → teal
- paused → yellow
- paused-limit → magenta (though WatchPaused handles this)
- idle → border

Left column (flexGrow: 1):
Line 1: <Text color={cyan} bold>NOW EXECUTING</Text> (or "IDLE" if no active run)
Line 2: <Text color={fgDark}>{activeRun.primary_repo_path basename} / {activeRun.plan_folder}</Text>
Line 3: empty
Line 4: <Text>phase {activePhase.number} / {totalPhases} — {phaseName}</Text>
Line 5: "plan " + progress bar (block characters representing phases complete / total)
  Filled blocks: '█'.repeat(complete). Empty blocks: '░'.repeat(remaining).
  Width: min(40, columns - rightColWidth - 10)

Progress bar calculation:
  complete = phases with status 'complete' or 'pr-created'
  total = all phases
  filledWidth = Math.round((complete / total) * barWidth)
  bar = '█'.repeat(filledWidth) + '░'.repeat(barWidth - filledWidth)

Right column (width: 28, fixed):
Line 1: <Text color={dim}>today's progress</Text>
Line 2: <Text color={fg}>{phasesCompleteToday} phases complete</Text>
Line 3: empty
Line 4: <Text color={dim}>budget today</Text>
Line 5: <Text color={yellow}>${budgetToday.toFixed(2)} across {runCount} runs</Text>
Line 6: <Text color={dim}>cost/hour  </Text><Sparkline data={hourlyData} width={10} color={yellow} />

For hourlyData: derive last 18 hour slots from activityBus.getBuffer(), grouping OkEvents by
hour and summing costUsd. Pass an array of 18 numbers.

FILE: src/tui/components/ActivityFeed.tsx

Props: { events: ActivityEvent[]; availableRows: number; activeSessionId?: string }

"LIVE ACTIVITY" header row:
<Text> <Text color={green}>●</Text> <Text color={dim}>streaming session </Text>
  <Text color={green2}>{shortSessionId}…</Text> </Text>

Separator: <Text color={borderHi}>{'·'.repeat(Math.min(columns-2, 48))}</Text>

Event rows (most recent first — reverse the events array for display):
Truncate to availableRows - 2 (subtract header and separator).

For each event, format one line:
  timestamp (HH:mm:ss) + '  ' + glyph + ' ' + kind.padEnd(6) + '  ' + description

Descriptions per kind (match the DESIGN.md §3 activity feed format):
- phase: "started phase " + phaseNumber + " — " + phaseName
- edit: file + (inProgress ? ' █' : ' +' + additions + ' −' + deletions)
- bash: command.slice(0, 40) + (result ? ' → ' + result.slice(0, 30) : '')
- commit: sha.slice(0,7) + ' · ' + message.slice(0,50)
- ok: 'phase ' + phaseNumber + ' complete — ' + summary.slice(0,40) + ' · $' + costUsd.toFixed(2)
- pause: 'queue paused'
- error: message.slice(0,60)
- limit: 'session limit — resumes at ' + resumeAt.toLocaleTimeString()

Colors per kind — use the exact colors from DESIGN.md §3:
  phase → cyan, edit → magenta, bash → green, commit → green2,
  ok → green, pause → yellow, error → red, limit → magenta

Use Ink's <Static> for events that have been emitted and won't change (all events older than the
newest in-progress edit). Keep the most recent in-progress event as a live-updating <Text>.
When no events: render <Text color={dim}> (no events yet) </Text>

FILE: src/tui/components/WatchBottomStrip.tsx

Props: { queueState: QueueState; columns: number }

Three columns, each ≈ columns/3 wide, separated by ' · ' dividers.
Use flexDirection="row" Box.

Left — UP NEXT:
"UP NEXT" header (dim, bold)
For each of the next 3 queued runs (queueState.queuedRuns.slice(0,3)):
  <Text> <Text color={dim2}>{pos}</Text> <StateChip status="queued" showLabel={false} />
  {' '}{repoBasename}/{planFolder truncated to ~14 chars} </Text>
"queue ETA {eta}" — sum of (phases remaining × 5 min estimate) per run. Show "ETA unknown" if
queue empty.

Centre — LIMIT WINDOW:
"LIMIT WINDOW" header (dim, bold)
Countdown: compute time until limitResumeAt (if set) or show "window open"
Progress bar: "▰▰▰▰▰▱▱▱▱▱▱▱▱▱" — placeholder (real usage from §8.3 in v2). Show 0% used for now.
"resets {time} {timezone}" — if limitResumeAt, format it
"tokens this window  " + <Sparkline data={[0]} width={8} color={dim2} /> (placeholder)

Right — TODAY:
"TODAY" header (dim, bold)
<Text color={green}>✓ {phasesCompleteToday}  phases done</Text>
<Text color={green2}>◆ {commitsToday}   commits pushed</Text>
<Text color={teal}>▸ {prsToday}   PRs opened</Text>
<Text color={orange}>↻ {retriesToday}   phase retried</Text>
<Text color={red}>✕ {failuresToday}   failures</Text>

FILE: src/tui/components/WatchPaused.tsx

Props: {
  variant: 'user' | 'limit';
  queueState: QueueState;
  columns: number;
  rows: number;
}

Variant 'user' (§4.1): Render within the normal Watch layout. Override the hero box:
  borderColor: yellow, title: "FINISHING THIS PHASE, THEN STOPPING"
  Left: <Text color={yellow}>‖ QUEUE PAUSED · by user</Text>
  Right: "queued: N runs · M phases waiting · none will start while paused"
  Footer shows: <Text color={yellow}>‖ queue paused — no runs will start until resumed</Text>

Variant 'limit' (§4.2): Full-screen replacement. No normal hero. Full-width magenta-bordered box.
Left side: render the countdown as large text. Use the `figlet` npm package:
  import figlet from 'figlet';
  const countdownText = formatCountdown(timeUntilReset); // e.g. "2h 14m"
  const big = figlet.textSync(countdownText, { font: 'Small' });
  Render: <Text color={magenta}>{big}</Text>
  Below the big text: "WAITING FOR WINDOW RESET" + "resumes at " + resumeAt
Right side: "window usage 100%" + filled progress bar + "api_error_status: 429"
Add figlet as a dependency: bun add figlet @types/figlet

Below the hero: "WHAT'S WAITING" — list the paused run + queued runs.

Update src/tui/App.tsx: replace the Watch placeholder with the real <Watch /> component.

VERIFY before committing (test with cpe start — may need a queued run to see full output):
1. bun run typecheck passes
2. bun run build produces ./cpe
3. With an empty queue: Watch mode renders the header, idle hero, empty activity feed, bottom strip
4. Activity feed shows most recent events at the top
5. Bottom strip countdown ticks every second (observe for 5 seconds)
6. Pressing v switches to Manage placeholder and back to Watch
7. At 80×24, Watch renders without crashing (check Bun.spawn with COLUMNS=80 LINES=24)

After all criteria pass:
1. git add src/tui/Watch.tsx src/tui/hooks/ src/tui/components/WatchHero.tsx
   src/tui/components/ActivityFeed.tsx src/tui/components/WatchBottomStrip.tsx
   src/tui/components/WatchPaused.tsx src/tui/App.tsx (updated)
2. git commit -m "feat: phase 11 — TUI Watch mode"
3. git push -u origin feature/claude-plan-executor-phase-11
4. Create PR targeting feature/claude-plan-executor

Update docs/claude-plan-executor/PROGRESS.md on start and completion.

Your final message in this conversation must be a JSON object matching the schema you have been
given. Do all your work using tools first, then emit only the JSON as your closing message.
