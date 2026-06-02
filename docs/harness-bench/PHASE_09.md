# Phase 09 - goose adapter (Block)

## Summary
Add the **goose** (Block) harness adapter following the Phase 07 template. goose is a Rust single
binary supporting 15+ providers including Ollama; it is MCP-centric for tool use.

## Pre-flight
Confirm `goose` is installed (`which goose`, `goose --version`). If missing, STOP and point the user at
the official install instructions: https://block.github.io/goose/docs/getting-started/installation
(repo: https://github.com/block/goose). Do not auto-install.

## goose specifics (verify against current docs in step 1)
- Headless invocation: `goose run -t "<prompt>"` (or `-i instructions.md`), executed in the run cwd.
- Provider/model: configured via goose config (profiles), not purely via flags - materialise an Ollama
  profile pointing at the local model and base URL. The profile/config location is global, so isolate
  a per-run config (a temp config dir / env override) and clean it up after.
- Note which MCP extensions (if any) goose needs for file editing in this setup.

## Completion mode
Expected **opaque** (exit code + git diff). Confirm in step 2.

## Files expected to change
- `src/harness/goose.ts` (new) - the adapter (opaque mode), materialising + isolating an Ollama profile
- `src/harness/registry.ts` - register goose
- (read-only references) `src/harness/types.ts`, `src/runner/capture.ts`, `src/git/clone.ts`
