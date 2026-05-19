# Phase 11 — TUI Watch Mode

## Summary

Implement the complete Watch mode layout wired to live data from the event bus and meta.json.
After this phase `cpe start` shows a fully functional Watch screen — hero, activity feed, bottom
strip — and correctly reshapes for user-pause and limit-pause states.

## Context

Read `docs/DESIGN.md §3` (Watch anatomy), `§4.1` (user-paused), and `§4.2` (limit-paused) in
full before writing any component. The visual reference is `docs/tui-design.html`.

### src/tui/Watch.tsx
Root Watch layout. Reads data from:
- `activityBus.getBuffer()` for the activity feed initial state
- Event bus subscription for live updates
- A `useQueueState()` hook (or prop) that polls meta.json every 2 seconds for run/phase data
  (Ink has no reactive store; polling is the simplest correct approach)

Layout (120×40 canonical):
- Row 0: `<Header mode="WATCH" />`
- Rows 2-13: `<WatchHero />` (bordered box)
- Below hero: `<ActivityFeed />`
- Bottom strip: `<WatchBottomStrip />`
- Footer row: `tue 17 may · HH:mm:ss BST · v manage · q quit`

When run status is `paused`, render `<WatchPaused variant="user" />` instead of the normal hero.
When run status is `paused-limit`, render `<WatchPaused variant="limit" />` as the full-screen
alternate layout (spec §4.2 — the countdown becomes the hero).

### src/tui/components/WatchHero.tsx
Shows the currently-executing run/phase. Left column:
- "NOW EXECUTING" label (cyan, bold)
- `<repo> / <plan-folder>` (fgDark)
- Empty line
- `phase <N> / <total> — <phase-name>` (fg)
- Plan progress bar using block characters: `████████████░░░░░░░░░░░░░`
  (filled = phases complete / total phases)

Right column (stats that don't change while the current phase runs):
- "today's progress" label + count (phases completed today across all runs)
- "budget today" label + `$X.XX across N runs`
- "cost/hour" label + `<Sparkline />` (last 18 hours, per-hour cumulative cost)

The hero is wrapped in a `borderStyle="round"` Box with `borderColor={cyan}` when executing.

### src/tui/components/ActivityFeed.tsx
Real-time activity feed. DESIGN.md §3 specifies:
- Most recent event at the TOP
- Truncate to fit visible area (compute available rows = terminal height minus header, hero, strip)
- Use `<Static>` for events that have already been emitted (Ink's `<Static>` is efficient for
  prepend-only lists)
- A live row at the top for the current in-progress event (e.g. an edit that hasn't completed)

Each row format: `HH:mm:ss  <glyph> <kind>  <description>`

Glyph + color per ActivityEvent kind — see DESIGN.md §3 activity feed table. Summary:
- `phase`: `▸` cyan, "started phase NN — <name>"
- `edit`: `✎` magenta, "<file> +N −M" (with `█` suffix if inProgress)
- `bash`: `$` green, "<command> → <result>"
- `commit`: `◆` green2, "<sha> · <message>"
- `ok`: `✓` green, "phase NN complete — <summary> · $X.XX"
- `pause`: `‖` yellow, "queue paused"
- `error`: `✕` red, "<message>"
- `limit`: `◴` magenta, "session limit hit — resumes at <time>"

"LIVE ACTIVITY ● streaming session <sha>…" header above the feed (the `●` is green and animates
with the spinner tick).

### src/tui/components/WatchBottomStrip.tsx
Three equal-width columns (each ≈ terminal_width / 3), separated by a `·` divider.

Left — Up next:
- "UP NEXT" label
- Next 3 queued runs: `<position> <glyph> <repo/plan truncated>`
- "queue ETA <HH:MM>" (sum of estimated ETAs; placeholder "ETA unknown" if no data yet)

Centre — Limit window:
- "LIMIT WINDOW" label
- "Xh Ym until reset" countdown (updated every second)
- Progress bar `▰▰▰▰▰▰▱▱▱▱▱▱▱▱ XX% used`
- "resets <time> <timezone>" line
- "tokens this window  <Sparkline />" (placeholder sparkline until §8.3 implemented)

Right — Today:
- "TODAY" label
- `✓ N phases done`, `◆ N commits pushed`, `▸ N PRs opened`, `↻ N retried`, `✕ N failures`
  (all counts from today's runs in meta.json)

### src/tui/components/WatchPaused.tsx
`<WatchPaused variant="user" | "limit" />`

Variant "user" (§4.1): yellow colour scheme. Hero border → yellow. Hero left says "FINISHING THIS
PHASE, THEN STOPPING". Right column says "queued behind: N runs · M phases waiting". Up-next rows
get `‖ paused` tag. Footer adds "‖ queue paused".

Variant "limit" (§4.2): magenta colour scheme. Full-screen hero with no normal hero content.
Left: huge countdown (`figlet` or manual large-text rendering — use the npm package `figlet` with
"Small" font, rendered into a multi-line string, then wrapped in `<Text>`). "WAITING FOR WINDOW
RESET" label. "resumes at <time> <timezone>". Right: window usage % + filled progress bar +
`api_error_status: 429` diagnostic. Below hero: "WHAT'S WAITING" list.

### Responsive sizing
- At 80×24: collapse bottom strip to two lines; hero shows only left column; header drops datetime
- At 120×40: canonical layout above
- At 160×50: add a stat-card row above activity feed with Active/Budget/Limit/Queue cards

Detect terminal size from `useStdoutDimensions()` already wired in `App.tsx`.

## Files Expected to Change

- `src/tui/Watch.tsx` — created
- `src/tui/components/WatchHero.tsx` — created
- `src/tui/components/ActivityFeed.tsx` — created
- `src/tui/components/WatchBottomStrip.tsx` — created
- `src/tui/components/WatchPaused.tsx` — created

## Acceptance Criteria

1. `tsc --noEmit` passes
2. `cpe start` with no runs in the queue renders Watch mode without crashing; bottom strip shows
   "Queue is empty" or equivalent placeholder
3. With a running phase, the hero shows the correct repo/plan/phase info
4. Activity feed renders chronologically (newest first); `<Static>` is used for historical entries
5. Bottom strip countdown ticks every second without causing layout thrash
6. Variant "limit" WatchPaused renders the large countdown (figlet or manual)
7. At 80×24 the TUI doesn't crash and shows something useful (no strict layout requirement for
   compact mode — just no crashes or overflows)

## Dependencies

Phase 10 (TUI shell, theme, shared primitives, App.tsx wired to start.ts).
