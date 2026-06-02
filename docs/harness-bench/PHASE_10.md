# Phase 10 - openhands adapter (All-Hands)

## Summary
Add the **openhands** (All-Hands) harness adapter following the Phase 07 template. This is the
heaviest adapter: openhands runs inside a sandboxed runtime (often Docker). Budget extra time.

## Pre-flight
Confirm the openhands CLI is installed (`which openhands`, `openhands --version`; the CLI-only package
is `openhands-cli` if avoiding the web UI). If missing, STOP and point the user at the official install
instructions: https://docs.all-hands.dev/ (repo: https://github.com/All-Hands-AI/OpenHands). Do not
auto-install. Also check the sandbox runtime prerequisite (e.g. Docker) and surface a clear message if
it is absent.

## openhands specifics (verify against current docs in step 1)
- Headless invocation: `openhands -t "<prompt>" --headless` (use the CLI-only `openhands-cli` package
  to avoid the web UI).
- LLM via config: `ollama/<model>` plus base_url for the local model.
- It runs inside a sandboxed runtime - ensure the sandbox **mounts/uses the clone as its workspace**
  so the changes it makes land in the clone for capture.

## Completion mode
Expected **opaque**, but openhands may emit a structured **event log** - check in step 2 and capture it
as a bonus if present (do not depend on it for outcome).

## Files expected to change
- `src/harness/openhands.ts` (new) - the adapter (opaque mode), wiring the sandbox to the clone
- `src/harness/registry.ts` - register openhands
- (read-only references) `src/harness/types.ts`, `src/runner/capture.ts`, `src/git/clone.ts`
