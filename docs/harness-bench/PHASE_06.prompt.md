Read docs/harness-bench/PHASE_06.md and docs/harness-bench/README.md before starting. Also read docs/DESIGN.md first (project rule: it is the source of truth for TUI layout, colour, state mapping, and keybinds) before touching any TUI surface. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Depends on Phase 04 (Phase 05 recommended so you have matrix runs to display).

Goal: a bounded live output pane plus matrix progress in the Ink TUI, and a manual bail keybind to stop a misbehaving run. There is NO headless mode in this plan - do not build one.

Files to create/modify and why:
- src/runner/output-tail.ts (new): a generic, harness-agnostic tail over a run's log file / stdout stream that tracks the last N lines and the timestamp of the most recent line. Emit updates onto the existing ActivityBus (src/events/bus.ts). This is also the activity signal Phase 04's activity-based timeout uses - reuse the same source, do not build a second reader. This replaces reliance on the claude-specific src/runner/jsonl-tail.ts for non-claude harnesses (leave jsonl-tail.ts in place for the claude-code structured path).
- src/tui/Bench.tsx (new) or extend src/tui/Watch.tsx: render (a) the matrix queue with each combo's state (done/running/pending), (b) the current harness__model and elapsed time, and (c) a BOUNDED scrolling pane showing the live tail (fixed height, does not take over the whole screen). Follow docs/DESIGN.md and the existing Ink component conventions in src/tui (theme.ts, state.ts, SubprocessContext.tsx). For a quiet harness, show elapsed and "last output Ns ago" rather than a blank/frozen pane.
- Manual bail: add a keybind in the bench view (per docs/DESIGN.md - prefer 'b' or a confirmed ctrl-c) that fires the cancel/bail signal built into the Phase 04 dispatch site: it process-tree-kills the current combo, records it as 'bailed', still runs capture, and lets the matrix continue to the next combo after the pause. Bailing one run must not abort the whole matrix.
- src/tui/App.tsx: wire the new view into navigation alongside the existing views.
- src/events/bus.ts: add a new event kind only if necessary for generic output lines or the bail action; prefer reusing existing event kinds.

Patterns and edge cases:
- Bounded pane: cap the live region to a fixed number of rows; old lines scroll out. Never let one chatty harness blow up the layout.
- Handle a harness that produces no output for a long time without looking hung: surface elapsed + last-output age (this is the same age the activity-timeout watches, so the user can see when a run is approaching the inactivity cut-off and bail early if they prefer).
- Do not regress the existing claude TUI experience (Watch/Manage/Drilldown) - if extending Watch.tsx, keep its current behaviour for claude runs.

Acceptance criteria:
- bun run build, lint, and existing tests pass.
- Running a bench matrix in a terminal shows the matrix progress and a bounded live tail that updates and does not take over the screen.
- The bail keybind stops the running combo (no surviving child processes), records it as 'bailed', writes its capture, and the matrix proceeds to the next combo.
- A deliberately quiet/slow run shows elapsed + last-output age, not a frozen blank.

When done, update docs/harness-bench/PROGRESS.md (Phase 06 complete, date) and commit the phase on feature/harness-bench.
