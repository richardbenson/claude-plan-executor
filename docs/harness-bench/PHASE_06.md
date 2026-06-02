# Phase 06 - Bounded live TUI + manual bail

## Summary
Give bench runs a **bounded live output pane** (Docker-like - occupies part of the screen, not a
full takeover) plus matrix progress, and a **manual bail** keybind so the user can stop a misbehaving
combo. (A headless no-TTY mode is explicitly **out of scope** for this plan - it belongs to a later,
properly-designed orchestrator effort; do not build it here.)

## Context
- The Ink TUI lives in `src/tui/` (`App.tsx`, `Watch.tsx`, `Manage.tsx`, `Drilldown.tsx`,
  `SubprocessContext.tsx`, `state.ts`, `theme.ts`) and is started by `src/commands/start.ts`. It
  consumes `src/events/bus.ts`.
- Live tailing today is `src/runner/jsonl-tail.ts`, which is **claude-JSONL specific**. Opaque
  harnesses emit arbitrary stdout, so a generic tail is needed.

## Approach
- `src/runner/output-tail.ts` (new): a generic line tail over a run's log/stdout that emits the last
  N lines + "time since last output", regardless of harness, feeding the bus/TUI. This is the same
  activity signal the Phase 04 activity-based timeout consumes - share it, don't duplicate it.
- `src/tui/Bench.tsx` (new) or extend `Watch.tsx`: a view showing the matrix queue (done / running /
  pending), the current `<harness>__<model>`, elapsed, and a bounded scrolling pane of the live tail.
  Degrade gracefully for quiet harnesses: show elapsed + last-output age, not a frozen blank.
- Manual bail: a keybind (e.g. `b`, or a confirmed `ctrl-c`) in the bench view that stops the
  currently-running combo - it fires the cancel/bail signal the Phase 04 dispatch site honours
  (process-tree kill, run recorded as `'bailed'`, capture still runs). The matrix then continues with
  the next combo (after the configured pause), so bailing one run does not abort the whole matrix.

## Files expected to change
- `src/runner/output-tail.ts` (new)
- `src/tui/Bench.tsx` (new) or `src/tui/Watch.tsx` (extend) + `src/tui/App.tsx` (wire the view)
- `src/commands/start.ts` and/or `src/commands/bench.ts` - bail keybind wiring into the dispatch cancel
- `src/events/bus.ts` - only if a new event kind is needed for generic output lines
