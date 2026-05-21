# TUI Design Gaps — Summary

## Original Requirements

Close 15 gaps identified by comparing every built screen against `docs/DESIGN.md`. All work in `src/tui/` and supporting `src/types/` and `src/storage/` files.

The gaps fell into four categories:

1. **Missing data** — phase titles never stored or displayed; limit-window usage hardcoded to zero
2. **Broken keybinds** — Drilldown `r`/`s` listed in footer but not wired
3. **Incomplete Manage state** — no yellow banner when queue paused; status line missing ETA and paused suffix
4. **Missing Watch polish** — no "LIVE ACTIVITY" label; header elapsed time not wired; "WHILE YOU WAIT" block absent

Notable out-of-scope items: 160×50 roomy layout; limit-window token capacity percentage (API doesn't expose the cap).

## What Was Built

All 7 phases were completed on 2026-05-21, each landing a single commit on `feature/tui-design-gaps`.

### Phase 1 — Phase titles throughout TUI (`cf27b4f`)

Added a `title?: string` field to `PhaseEntry`. An `extractPhaseTitle()` helper in `src/storage/meta.ts` reads the first heading (`## Phase N — <title>`) from the plan's `PHASE_NN.md` file at queue time. The title is surfaced in `WatchHero`, `PhasesPane`, and `Drilldown`'s left pane. Also fixed `PhasesPane` selection highlight to use `bgFloat` rather than `bgHi` per §5.1 of the design doc. Existing records without a `title` field deserialise cleanly via the optional field.

### Phase 2 — Header live indicator + ActivityFeed label (`f87281f`)

`App.tsx` now imports `useQueueState` and tracks `sessionStartedAt` (set on first `phase` event). `Header.tsx` replaced the unused `elapsed?: number` prop with `startedAt?: Date` and computes a formatted `active Xh Ym` string itself. A green `●` dot now precedes the status text when a session is active. Status text distinguishes active, limit-paused (`queue paused · waiting on 5h limit window`), and user-paused states. `ActivityFeed` gained the `LIVE ACTIVITY` label before the streaming indicator.

### Phase 3 — StatusLine improvements + Drilldown keybinds (`03beaaa`)

`StatusLine` in `Manage.tsx` now shows real disk size via `execSync('du -sh')` with a `'?'` fallback, ETA as remaining-phases × 5 min, and a `‖ paused` suffix when the queue is paused. `Drilldown.tsx` gained `r` (retry) and `s` (skip) handlers in `useInput`, mirroring the `R`/`S` logic in `Manage.tsx`. The `isPaused` value was threaded through to `StatusLine` from `Manage`'s `qs.isPaused`.

### Phase 4 — CommandBar + Manage paused banner (`4e776b3`)

`CommandBar.tsx` now uses its `focusedPane` prop to highlight the active row label in cyan and appends `q quit` to the RUN row. `Manage.tsx` renders a full-width yellow `‖‖ QUEUE PAUSED` banner between the header and triptych when `qs.isPaused` is true, adjusting the container height accordingly. `ExecutingPane` gained an `isPaused?: boolean` prop that renders a `‖ this phase will finish · queue won't advance` message.

### Phase 5 — Limit window real data + Watch paused polish (`84267a3`)

`LimitWindow` in `WatchBottomStrip.tsx` was rewired to show a real hourly-cost sparkline derived from `activityBus` rather than hardcoded zeros; when limit-paused it shows a full bar. `UpNext` entries now carry `‖ paused` tags when the queue is paused. `WatchPaused` (user variant) computes time-since-pause from the most recent `pause` event in the activity bus buffer. `WatchPaused` (limit variant) gained a static "WHILE YOU WAIT" hint block explaining auto-resume behaviour.

### Phase 6 — Modal dynamic centering (`c650258`)

Both modals received a `columns` prop (passed from `Manage.tsx`) and now compute `marginLeft` dynamically: `Math.max(0, Math.floor((columns - (width + 2)) / 2))`. `CommandPalette` also gained `height={26}` with `overflow="hidden"` to match the design-spec maximum height.

### Phase 7 — Responsive sizing 80×24 compact layout (`e356795`)

A `compact` flag (`columns < 100 || rows < 30`) is derived in each component from the existing `columns`/`rows` props. In compact Watch: no bottom strip, no hero box (collapsed to 3-line summary), activity feed fills remaining rows, header drops datetime and elapsed time. In compact Manage: single pane visible at a time, `Tab` cycles between queue/phases/executing panes, status line and command bar collapse to one row each. No new component files were introduced — compact branches live inside the existing components.

## Lessons Learned

- **Optional field on persisted types is the right pattern.** Adding `title?: string` to `PhaseEntry` meant zero migration work — old records deserialise fine and the TUI falls back gracefully. This pattern should be the default for any future additions to `meta.json` records.

- **Threading state through props caught late.** `isPaused` was not passed to `StatusLine` or `ExecutingPane`, which was only discovered while implementing the relevant phase. Future phases that touch downstream components should audit the full prop chain upfront.

- **Ink doesn't support background colour tints.** The design called for a yellow banner in Manage — Ink only supports named foreground colours, so `dimColor` on a yellow `<Text>` was the only option. Background fills shown in the design HTML are not achievable in Ink without a workaround.

- **`du -sh` is the practical disk-size solution** but is synchronous and can block the render loop on slow filesystems. Wrapping in try/catch is essential; a future improvement could move this to an async probe with a cached result.

- **Compact layout via conditional branches, not new files.** The design specified a full second layout mode, but all 7 changes fit cleanly inside existing components using an `if (compact)` branch. This kept the diff reviewable and avoided proliferating component files.

- **`activityBus.getBuffer()` is the right source for historical event data** (pause timestamps, cost-per-hour buckets). Phase 5 confirmed this pattern works; future watch-mode features should reach for it first before looking elsewhere.

## Final PR

PR not recorded.
