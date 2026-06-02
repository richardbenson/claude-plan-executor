# Phase 12 - pi adapter (pi.dev)

## Summary
Add the **pi** (https://pi.dev/) harness adapter following the Phase 07 template. Expected to be
lightweight with native Ollama support - likely the easiest extra adapter.

## Pre-flight
Confirm the pi CLI is installed and runnable (`which pi`, `pi --version` - verify the actual binary
name in step 1). If missing, STOP and point the user at the official install instructions:
https://pi.dev/ . Do not auto-install.

## pi specifics (verify against current docs in step 1)
- Confirm the non-interactive run command and how it selects model + base URL (expected: native Ollama,
  so pointing at the local model and base URL should be straightforward).

## Completion mode
Expected **opaque** (exit + git diff). Confirm in step 2.

## Files expected to change
- `src/harness/pi.ts` (new) - the adapter (opaque mode)
- `src/harness/registry.ts` - register pi
- (read-only references) `src/harness/types.ts`, `src/runner/capture.ts`, `src/git/clone.ts`
