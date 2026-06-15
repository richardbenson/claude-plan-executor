# Phase 04 — TUI auto-update loop + footer badge

**Branch:** feature/self-update
**Dependencies:** Phase 02 (engine). Phase 03 only shares the config flag semantics (`update_auto !== false`).

## Summary

Make `cpe start` keep itself up to date: a background loop checks every 6
hours and silently installs newer releases. Because the running process keeps
executing the old binary image after the on-disk swap, every TUI mode shows a
persistent yellow footer badge — `↑ vX.Y.Z installed — restart to apply` —
until the user restarts. Per the user's decision this is a badge only: no
activity-feed event. DESIGN.md is updated, since it is the source of truth
for TUI surfaces (see CLAUDE.md).

## Context

- `src/commands/start.ts` → `startCommand()` boots the queue processor and
  re-renders the Ink `App` in a loop (TUI restarts around interactive
  subprocesses). The auto-update loop must be started once, outside that
  render loop, alongside `runQueueProcessor`.
- The updater runs in the same process as the TUI, so badge state can be a
  tiny in-process store with a subscribe function (no file polling needed),
  consumed by a hook — see `src/tui/hooks/` for existing hook patterns and
  `activityBus.subscribe` usage in `App.tsx` for the subscription-in-
  useEffect shape. The store must live at module scope so the badge survives
  the App unmount/re-render cycle around interactive subprocesses.
- Footers to extend (right-aligned hint text, `dim2` color):
  - `src/tui/Watch.tsx` — footer around lines 195/222/233-235 (normal,
    compact, and paused variants; paused uses `UserPausedFooter`)
  - `src/tui/Manage.tsx` — keybind footer around line 428
  - `src/tui/Bench.tsx` — equivalent footer line
- Badge styling: `yellow` (`#e0af68`) from `src/tui/theme.ts`, consistent
  with the "needs your attention" semantics in DESIGN.md §2.2/2.3.
- Guards: loop runs only when `CPE_VERSION !== 'dev'` and
  `config.update_auto !== false`. Failures are silent (a failed check just
  waits for the next tick); a check must never overlap a still-running
  install.

## Files expected to change

- `src/update/auto.ts` (new) — loop + badge store (`startAutoUpdateLoop`, `subscribeInstalledUpdate`, `getInstalledUpdate`)
- `src/update/auto.test.ts` (new) — loop guards and store semantics with injected timers/stubs
- `src/commands/start.ts` — start the loop in `startCommand()`
- `src/tui/hooks/useInstalledUpdate.ts` (new) — hook over the store
- `src/tui/Watch.tsx`, `src/tui/Manage.tsx`, `src/tui/Bench.tsx` — footer badge
- `docs/DESIGN.md` — badge spec (placement, color, copy) in the footer documentation
