# Phase 13 - crush adapter (Charmbracelet)

## Summary
Add the **crush** (Charmbracelet) harness adapter following the Phase 07 template. crush is a Bubble
Tea TUI agent, so the decisive question is whether it has a **headless/non-interactive** mode at all -
the adapter cannot drive an interactive-only TUI.

## Pre-flight
Confirm `crush` is installed (`which crush`, `crush --version`). If missing, STOP and point the user at
the official install instructions: https://github.com/charmbracelet/crush . Do not auto-install.

## crush specifics (verify against current docs in step 1)
- The key step-1 check: does crush expose a scriptable, non-interactive run mode (e.g. a `run`/`-p`
  style flag that takes a prompt and exits)? If it does **not**, record that finding and park the
  adapter (do not try to puppet the TUI).
- If it does: find how to pass the prompt + model + base URL for the local model.

## Completion mode
Expected **opaque** (exit + git diff). Confirm in step 2.

## Files expected to change
- `src/harness/crush.ts` (new) - the adapter (opaque mode), if a headless mode exists
- `src/harness/registry.ts` - register crush
- (read-only references) `src/harness/types.ts`, `src/runner/capture.ts`, `src/git/clone.ts`
