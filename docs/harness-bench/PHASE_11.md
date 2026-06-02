# Phase 11 - plandex adapter (+ orchestrator write-up)

## Summary
Add the **plandex** harness adapter following the Phase 07 template, **plus** a bonus deliverable: a
write-up on how plandex's client/server split maps to the eventual "run harnesses on a server from an
orchestrator" goal. plandex is a client/server tool - the `plandex` CLI talks to a plandex server.

## Pre-flight
Confirm the `plandex` CLI is installed (`which plandex`, `plandex version`). If missing, STOP and point
the user at the official install instructions: https://docs.plandex.ai/ (repo:
https://github.com/plandex-ai/plandex). Do not auto-install. Also confirm a plandex server is
reachable/runnable (it is a prerequisite for any run) and surface a clear message if not.

## plandex specifics (verify against current docs in step 1)
- Client/server: the CLI talks to a plandex server; document how to point it at a local server and at
  OpenAI-compatible/Ollama models for the local model.
- It has its own diff/apply sandbox; ensure applied changes land in the clone for capture.

## Completion mode
Expected **opaque** (apply changes to the repo). Confirm in step 2.

## Bonus deliverable (orchestrator notes)
Write `docs/harness-bench/orchestrator-notes.md`: does adopting plandex's client/server model (or
imitating it) make the eventual orchestrator easier? Could plandex's server be the orchestration
substrate, or is it just another adapter? This is evaluation only - do not build the orchestrator.

## Files expected to change
- `src/harness/plandex.ts` (new) - the adapter (opaque mode)
- `src/harness/registry.ts` - register plandex
- `docs/harness-bench/orchestrator-notes.md` (new) - the write-up
- (read-only references) `src/harness/types.ts`, `src/runner/capture.ts`, `src/git/clone.ts`
