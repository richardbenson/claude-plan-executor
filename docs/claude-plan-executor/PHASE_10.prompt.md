Read docs/claude-plan-executor/PHASE_10.md for full context before starting.

You are implementing phase 10 of the Claude Plan Executor (`cpe`) project. This phase builds the
Ink application shell and all shared primitive components. After this phase `cpe start` renders a
real Ink UI that reacts to terminal dimensions.

Working directory: /home/ubuntu/Code/claude-plan-executor
Branch: feature/claude-plan-executor-phase-10 (create it off feature/claude-plan-executor)
PR target: feature/claude-plan-executor

CRITICAL: Read docs/DESIGN.md in full before writing any component. It is the source of truth for
layout, colour, state mapping, and keybinds. Also open docs/tui-design.html in a browser if
possible to see the visual reference.

Read these existing files before starting:
- src/types/state.ts (STATE_TABLE, RunStatus, PhaseStatus)
- src/events/bus.ts (activityBus, ActivityBus)
- src/commands/start.ts (startCommand, runQueueProcessor — will be updated here)

FILE: src/tui/theme.ts

Export all Tokyo Night color tokens as string constants. Use the exact hex values from
DESIGN.md §2.2. Name them exactly as the design doc names them:

export const bg = '#1a1b26';
export const bgFloat = '#1f2335';
export const bgHi = '#292e42';
export const border = '#3b4261';
export const borderHi = '#414868';
export const dim = '#565f89';
export const dim2 = '#737aa2';
export const fgMute = '#9aa5ce';
export const fgDark = '#a9b1d6';
export const fg = '#c0caf5';
export const blue = '#7aa2f7';
export const cyan = '#7dcfff';
export const cyan2 = '#2ac3de';
export const teal = '#73daca';
export const green = '#9ece6a';
export const green2 = '#41a6b5';
export const yellow = '#e0af68';
export const orange = '#ff9e64';
export const red = '#f7768e';
export const magenta = '#bb9af7';

Also export a Colors type: type Colors = typeof import('./theme').

FILE: src/tui/state.ts

Import STATE_TABLE and getStateInfo from src/types/state.ts. Re-export them.
Additionally export the helper used by TUI components:
- getStateStyle(status: RunStatus | PhaseStatus): { glyph: string; color: string; label: string }
  This is just getStateInfo with a friendlier name for TUI use.

FILE: src/tui/components/StateChip.tsx

Props: { status: RunStatus | PhaseStatus; showLabel?: boolean }
Renders: <Text color={info.color}>{info.glyph}{showLabel ? ' ' + info.label : ''}</Text>
Default showLabel: true.

FILE: src/tui/components/Spinner.tsx

Wraps ink-spinner. Props: { color?: string }
Renders: <Spinner type="dots" /> (from ink-spinner) wrapped in <Text color={color ?? cyan}>
The dots spinner matches DESIGN.md §8 (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ cycle).

FILE: src/tui/components/Sparkline.tsx

Props: { data: number[]; width: number; color?: string }
The eighth-block glyphs in order (index 0-7): const BLOCKS = '▁▂▃▄▅▆▇█';
Normalise data to [0,7]: find max value; map each point to Math.round((v/max)*7). If max===0,
all map to 0. Truncate or right-pad to width characters. Render as a single <Text color>.
If data is empty, render width spaces.

FILE: src/tui/components/Header.tsx

Props: {
  mode: 'WATCH' | 'MANAGE';
  statusText: string;    // e.g. "queue chewing ●" or "queue paused"
  elapsed?: number;      // milliseconds active, or undefined if not running
}

Layout: one row (Box flexDirection="row" justifyContent="space-between"):
Left: <Text color={blue}>▮ cpe</Text><Text color={borderHi}> · </Text>
      <Text color={mode==='WATCH' ? teal : orange} bold>{mode}</Text>
      <Text color={borderHi}> · </Text>
      <Text color={fgDark}>{statusText}</Text>

Right: <Text color={dim}>{formattedDatetime}</Text>

formattedDatetime: "tue 17 may · HH:mm:ss BST" — use Intl.DateTimeFormat to get the user's local
time. Update every second via a useEffect + setInterval that calls a state setter.
Use 'en-GB' locale, timeZoneName: 'short' to get BST/GMT/etc.

FILE: src/tui/App.tsx

The root Ink component.

interface AppProps {
  config: AppConfig;
}

State:
- mode: 'watch' | 'manage' — useState('watch')
- sessionActive: boolean — useState(false)  (true when a phase is executing)
- showQuitConfirm: boolean — useState(false)

useStdoutDimensions() from the 'ink' package — get { columns, rows }.

useInput from 'ink':
- 'v': toggle mode (setMode(m => m === 'watch' ? 'manage' : 'watch'))
- 'q': if sessionActive, setShowQuitConfirm(true); else process.exit(0)
- If showQuitConfirm is shown: 'y' → process.exit(0); 'n' → setShowQuitConfirm(false)

useEffect: subscribe to activityBus on mount; unsubscribe on unmount. Update sessionActive based
on executing events (kind === 'phase' → true; kind === 'ok' || kind === 'error' → check if any
run is still executing). Keep it simple for now: true when any PhaseEvent arrives, false when an
OkEvent or ErrorEvent arrives.

Render:
<Box flexDirection="column" width={columns} height={rows}>
  <Header mode={mode.toUpperCase() as 'WATCH'|'MANAGE'} statusText={queueStatusText} />
  {showQuitConfirm && <QuitConfirmBar />}
  {mode === 'watch' ? <Watch columns={columns} rows={rows} /> : <Manage columns={columns} rows={rows} />}
</Box>

<QuitConfirmBar /> (inline, no separate file): renders one line:
<Text color={yellow}> Really quit? Session is active. [y] quit  [n] cancel </Text>

<Watch /> and <Manage /> are placeholders in this phase:
Watch: <Box><Text color={dim2}> Watch mode — coming in Phase 11 </Text></Box>
Manage: <Box><Text color={dim2}> Manage mode — coming in Phase 12 </Text></Box>

queueStatusText: 'queue running' if any run is executing, 'queue idle' otherwise. For now,
derive from the event bus buffer: scan for the most recent PhaseEvent.

FILE: src/commands/start.ts (update from Phase 09)

Replace the console.log-based start command with one that renders the Ink app, then runs the
queue processor in parallel.

startCommand(): Promise<void>
  const config = readConfig();
  // Render the TUI
  const { unmount } = render(<App config={config} />);
  // Run the queue processor in the background
  // When it returns (queue drained), unmount the TUI
  try {
    await runQueueProcessor(config, activityBus);
  } finally {
    unmount();
  }

Remove the console.log activity subscriber added in Phase 09 (the TUI handles display now).
Remove the inline bus.subscribe in startCommand — the TUI components subscribe via App.tsx.

VERIFY before committing:
1. bun run typecheck passes
2. bun run build produces ./cpe binary
3. ./cpe start renders the Ink TUI (placeholder Watch/Manage content is fine)
4. 'v' key toggles between Watch and Manage placeholder screens
5. 'q' key with no active session exits immediately
6. Terminal resize doesn't crash the app
7. <Sparkline data={[0,1,2,3,4,5,6,7]} width={8} color="#9ece6a" /> renders ▁▂▃▄▅▆▇█

After all criteria pass:
1. git add src/tui/ src/commands/start.ts
2. git commit -m "feat: phase 10 — TUI shell and shared primitives"
3. git push -u origin feature/claude-plan-executor-phase-10
4. Create PR targeting feature/claude-plan-executor

Update docs/claude-plan-executor/PROGRESS.md on start and completion.

Your final message in this conversation must be a JSON object matching the schema you have been
given. Do all your work using tools first, then emit only the JSON as your closing message.
