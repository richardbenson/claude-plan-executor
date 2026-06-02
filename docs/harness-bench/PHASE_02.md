# Phase 02 - Executor dispatch refactor

## Summary
Make the executor dispatch through the `Harness` registry instead of hardcoding `claude`. The
`claude-code` adapter (Phase 01) becomes the path taken when `harness` is unset or `'claude-code'`,
so existing behaviour is preserved. This is the **regression-gated** phase.

## Context
- Two places spawn claude today:
  - `src/runner/single-prompt.ts` and `src/runner/phase-loop.ts` drive phase/prompt execution via
    `runSession` (`src/runner/session.ts`).
  - `src/runner/finalise.ts` spawns `claude -p` for the summarise step.
- The Ink TUI consumes events from `src/events/bus.ts` and tails output via `src/runner/jsonl-tail.ts`
  (claude-JSONL specific - leave as-is for claude; generic tail comes in Phase 06).

## Approach
- In `single-prompt.ts` and `phase-loop.ts`, resolve the adapter with
  `registry.get(meta.harness ?? appConfig.harness_for_phases ?? 'claude-code')` and call
  `adapter.run(ctx)`; consume the returned `HarnessResult` exactly where the `SessionResult`/envelope
  is consumed today.
- `finalise.ts` (summarise) is claude/planbot-specific. For this phase, route it through the
  claude-code adapter too, but gate the summarise step to structured adapters - opaque harnesses skip
  summarise (document this; a general summarise is out of scope here).
- Keep all event emissions (`bus.emit`) and meta updates identical for the claude path.

## Regression gate (hard acceptance criterion)
With default settings (no `--harness`), claude-code execution must be **byte-for-byte identical** to
pre-refactor. Proven by the existing test suite passing unchanged, plus a manual single-prompt run
diffed against a pre-refactor run.

## Files expected to change
- `src/runner/single-prompt.ts` - dispatch via registry.
- `src/runner/phase-loop.ts` - dispatch via registry.
- `src/runner/finalise.ts` - route summarise through the claude-code adapter; gate to structured mode.
- `src/harness/claude-code.ts` - extend if needed so the adapter covers the phase-loop call shape.
- (possibly) `src/harness/types.ts` - only if the contract needs a small addition discovered here.
