# TUI Design Gaps

## Requirements

Close the 15 gaps identified by comparing every built screen against `docs/DESIGN.md`.  
All work is in `src/tui/` and its supporting `src/types/` and `src/storage/` files.

The gaps fall into four categories:

1. **Missing data** — phase titles are never stored or displayed; limit-window usage is hardcoded
2. **Broken keybinds** — Drilldown `r`/`s` listed in footer but not wired
3. **Incomplete Manage state** — no yellow banner when queue is paused; status line missing ETA and paused suffix
4. **Missing Watch polish** — no "LIVE ACTIVITY" label; header elapsed time not wired; "WHILE YOU WAIT" block absent

## Scope

### In scope
- Phase titles stored in `PhaseEntry` and rendered everywhere
- `PhasesPane` selection colour fixed (`bgFloat` not `bgHi`)
- Header: live `●` dot, elapsed time, paused/limit status text
- ActivityFeed: "LIVE ACTIVITY" label
- Drilldown: `r` retry and `s` skip keybinds wired
- StatusLine: ETA, `‖ paused` suffix, real disk size
- Manage: yellow 2-row paused banner, ExecutingPane paused message
- CommandBar: `q quit` shown, pane-sensitive rendering
- Limit window: real cost-based sparkline, not hardcoded zeros
- WatchPaused: "WHILE YOU WAIT" block, time-since-pause label, up-next paused tags
- Modal centering: dynamic `marginLeft` based on terminal columns
- Responsive sizing: 80×24 compact layout

### Out of scope
- 160×50 roomy layout
- Limit-window token capacity percentage (API doesn't expose the cap)

## Definition of Done

- [ ] Phase list in PhasesPane shows human titles (e.g. "Set up project scaffolding"), not `PHASE_04`
- [ ] WatchHero phase line shows the human title
- [ ] Drilldown left pane shows human titles
- [ ] PhasesPane selected row uses `bgFloat` not `bgHi`
- [ ] Header shows `● queue chewing` (green dot) when active; `today · active Xh Ym` on right
- [ ] Header reads "queue paused · waiting on 5h limit window" when limit-paused
- [ ] ActivityFeed header line reads `LIVE ACTIVITY ● streaming session…`
- [ ] Drilldown `r` retries, `s` skips the selected phase
- [ ] StatusLine shows `eta ~Xh Ym` and `‖ paused` when relevant
- [ ] StatusLine disk size is a real `du -sh` value
- [ ] Manage shows a yellow banner when queue is paused
- [ ] ExecutingPane shows "‖ this phase will finish · queue won't advance" when paused
- [ ] CommandBar shows `q quit`; QUEUE row is highlighted when queue pane is focused
- [ ] Limit window sparkline shows real hourly cost data
- [ ] WatchPaused (user) shows time-since-pause; up-next runs show `‖ paused` tag
- [ ] WatchPaused (limit) has a "WHILE YOU WAIT" hint block
- [ ] CommandPalette centred dynamically; height ≤ 26 rows
- [ ] KillConfirmModal centred dynamically
- [ ] At 80×24 terminal: single-pane Watch and Manage with Tab to swap, no bottom strip
- [ ] `bun run typecheck` passes after every phase
- [ ] `bun run build` succeeds after every phase

## Links

- [PROGRESS.md](./PROGRESS.md) — phase status table
- [PHASE_01.md](./PHASE_01.md) — Phase titles throughout TUI
- [PHASE_02.md](./PHASE_02.md) — Header live indicator + ActivityFeed label
- [PHASE_03.md](./PHASE_03.md) — StatusLine improvements + Drilldown keybinds
- [PHASE_04.md](./PHASE_04.md) — CommandBar + Manage paused banner
- [PHASE_05.md](./PHASE_05.md) — Limit window real data + Watch paused polish
- [PHASE_06.md](./PHASE_06.md) — Modal dynamic centering
- [PHASE_07.md](./PHASE_07.md) — Responsive sizing (80×24 compact)
