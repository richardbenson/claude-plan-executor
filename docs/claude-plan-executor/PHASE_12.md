# Phase 12 — TUI Manage Mode + Phase Drilldown

## Summary

Implement the Manage mode triptych (queue / phases / executing panes), the full keybind surface
(reorder, pause, remove, retry, skip, kill), the command palette, the kill-confirmation modal,
and the phase drilldown view. After this phase the TUI is feature-complete.

## Context

Read `docs/DESIGN.md §5` (Manage anatomy, selection model, keybinds, palette, kill modal) and
`§6` (phase drilldown) in full before writing any component. The visual reference is
`docs/tui-design.html`.

### src/tui/Manage.tsx
Root Manage layout. Three columns with a `·` separator (DESIGN.md §5):
- Column 1 (≈ 14 cols): Queue pane
- Column 2 (≈ auto): Phases pane
- Column 3 (≈ 24 cols): Executing pane

Below the triptych: status line (§5.3), command bar (§5.2 — two contextual rows: QUEUE and RUN).

State:
- `focusedPane: 'queue' | 'phases' | 'executing'`
- `selectedRunIndex: number` (index in the queue list)
- `selectedPhaseIndex: number` (index in the phases list for the selected run)
- `showPalette: boolean`
- `killConfirm: boolean`
- `drilldown: { runId: string; phaseNumber: number } | null`

When `drilldown` is set, render `<Drilldown />` full-screen instead of the triptych.

Key handling (in Manage.tsx, not in individual panes):
- `Tab`: cycle focusedPane
- `↑ / ↓`: move selection in focused pane
- `⌥↑ / ⌥↓` (Option+Arrow): reorder selected queue run up/down
- `↵` on queue row: open phases for that run (set selectedRunId)
- `↵` on phase row: open drilldown
- `p`: toggle queue pause (write queue.json.paused, emit PauseEvent)
- `r`: remove selected run (prompt keep/delete worktree)
- `R`: retry current phase (kill session, requeue phase, resume run)
- `S`: skip current phase (mark complete: false, committed: false, advance)
- `K`: show kill confirmation modal
- `e`: open worktree in `$EDITOR` via `Bun.spawn`
- `l`: tail phase log in `$PAGER` via `Bun.spawn`
- `:`: show command palette
- `q`: quit (with confirmation if session active)
- `v`: switch to Watch mode (set in App.tsx state)
- `Esc`: dismiss palette / modal / drilldown
- `a`: invoke `cpe queue` flow inline (simplest: spawn interactive `cpe queue` in a child process)

### src/tui/components/QueuePane.tsx
`<QueuePane runs={RunMeta[]} selectedIndex={number} focused={boolean} />`

Each queue entry occupies 3 rows (DESIGN.md §5):
- Row 1: `▶ <repo-name>` (▶ only on selected row; cyan border-left `┃` on all rows of selection)
- Row 2: `  /<plan-folder>`
- Row 3: `  <StateChip status> <N>/<total> <progress-bar>`

Selected row: `bgFloat` background fill, `┃` cyan left-edge marker. Focused pane: `borderColor={cyan}`.
Non-focused: `borderColor={border}`.

### src/tui/components/PhasesPane.tsx
`<PhasesPane phases={PhaseEntry[]} selectedRun={RunMeta} selectedIndex={number} focused={boolean} />`

Each phase is one row: `<StateChip> <NN> <name-from-prompt-file>  [<cost>]`
Selected phase: `bgHi` background. `↵` triggers drilldown.

The phase name is derived from the prompt file name: `PHASE_01.prompt.md` → strip prefix/suffix,
use `PHASE_01` or read the first line of the prompt file if available.

### src/tui/components/ExecutingPane.tsx
`<ExecutingPane runMeta={RunMeta} events={ActivityEvent[]} />`

Shows the currently-executing phase details:
- Phase name and session ID (truncated to 8 chars)
- Spinner + "TOOL CALLS N" header
- Last N tool-call events (Edit, Bash) with status (✓ done / ⠋ in-progress) and duration
- Token count and cost for the current phase
- `borderColor={cyan}` when focused

### src/tui/components/CommandBar.tsx
`<CommandBar focused={FocusedPane} queuePaused={boolean} sessionActive={boolean} />`

Two rows below the triptych. Content changes based on `focused` pane:
- QUEUE row: `↑↓ select  ⌥↑↓ reorder  ↵ phases  p pause  r remove  a add plan`
  (if paused: `p pause` → `p RESUME` in yellow)
- RUN row: `R retry phase  S skip phase  K kill session  e $EDITOR  l log  : palette`
Inactive/inapplicable keybinds are dimmed (color `dim`).

### src/tui/components/CommandPalette.tsx
`<CommandPalette onClose={fn} onRun={(cmd) => fn} visible={boolean} />`

Modal overlay, DESIGN.md §5.4:
- Dim everything underneath (`bgFloat` at 35% opacity — in Ink, achieve this with a `Box` filling
  the terminal with spaces in a dim color, then absolutely-positioned modal on top)
- Centred 80×26 box, `borderColor={cyan}`, `backgroundColor={bgFloat}`
- Top line: `: <query>█` — use `ink-text-input` for the query field
- Below: filtered command list. Each row: category chip (dim) + command + description (dim2)
- `↑↓` to select, `↵` to execute, `Esc` to dismiss

Commands list: matches all keybinds from §5.2 plus `remove run + worktree`, `open PR`, `open
worktree`, `tail phase log`.

### src/tui/components/KillConfirmModal.tsx
`<KillConfirmModal session={PhaseEntry & { runMeta: RunMeta }} onConfirm={fn} onCancel={fn} />`

DESIGN.md §5.5: red-bordered 56×14 card. Content exactly as specified. `n` or `Esc` → cancel.
`K` (capital) → confirm. On confirm: send SIGTERM to the claude process, after 5s send SIGKILL.
Mark phase `failed` (no retry), mark run `paused` (not failed — user can decide next step).

The claude process handle must be accessible from the kill modal. Pass the process handle through
context or a ref from the phase loop. Store the child process PID in meta.json during execution
so it survives the TUI state.

### src/tui/Drilldown.tsx
DESIGN.md §6: full-screen view. Left pane (cols 0-47): phase list with current selection. Right
pane (cols 49-119): selected phase details.

Right pane content:
1. Metadata: StateChip, commit SHA (first 7 chars), retry count, duration (completed_at -
   started_at), cost, token total (input + output + cache_read), session UUID
2. Summary (structured_output.summary)
3. Commit message (structured_output.commit_message or parsed from git log)
4. Notes for next phase (structured_output.notes_for_next_phase)
5. Session log: top 15 events from the in-memory activity buffer filtered to this phase
6. Stdout tail: last 3 lines of `~/.local/state/cpe/runs/<id>/logs/phase-NN.log`

Keybinds in drilldown: `↑↓` next/prev phase, `l` open log in $PAGER, `e` edit in $EDITOR,
`r` retry, `s` skip, `d` show git diff (spawn `git diff <head_before>..<commit_sha>` in $PAGER),
`Esc` back to Manage.

## Files Expected to Change

- `src/tui/Manage.tsx` — created
- `src/tui/components/QueuePane.tsx` — created
- `src/tui/components/PhasesPane.tsx` — created
- `src/tui/components/ExecutingPane.tsx` — created
- `src/tui/components/CommandBar.tsx` — created
- `src/tui/components/CommandPalette.tsx` — created
- `src/tui/components/KillConfirmModal.tsx` — created
- `src/tui/Drilldown.tsx` — created

## Acceptance Criteria

1. `tsc --noEmit` passes
2. `v` in Watch mode switches to Manage; `v` in Manage switches back to Watch
3. `↑↓` moves queue selection; `Tab` shifts focus between panes
4. `K` shows the kill modal with the correct run/phase/session info; `n` dismisses it
5. `:` opens the command palette; typing filters the list; `Esc` dismisses
6. `↵` on a phase row opens the drilldown; `Esc` returns to Manage
7. Drilldown right pane renders all 6 sections without crashing
8. Phase list in both PhasesPane and Drilldown left pane correctly shows all states with correct
   glyphs and colours from the STATE_TABLE
9. `bun run build` produces a working binary with the complete TUI

## Dependencies

Phase 11 (Watch mode, App.tsx, all shared primitives complete).
