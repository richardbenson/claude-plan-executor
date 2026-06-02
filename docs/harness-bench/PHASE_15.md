# Phase 15 - swe-agent adapter (Princeton)

## Summary
Add the **swe-agent** (Princeton) harness adapter following the Phase 07 template. It is
research/benchmark-grade: very scriptable but config-heavy, and uses LiteLLM for local models. Budget
extra time for configuration.

## Pre-flight
Confirm the swe-agent CLI is installed (`which sweagent`, `sweagent --version` - verify the actual
binary/command in step 1). If missing, STOP and point the user at the official install instructions:
https://swe-agent.com/ (repo: https://github.com/SWE-agent/SWE-agent). Do not auto-install.

## swe-agent specifics (verify against current docs in step 1)
- Uses **LiteLLM** for model access - configure a LiteLLM/Ollama model string + base URL for the local
  model.
- Very scriptable but config-heavy: expect to materialise a run config (model, repo/workspace, task).
  Point its workspace at the run's clone so edits land there for capture.

## Completion mode
Expected **opaque** (exit + git diff / patch output). Confirm in step 2.

## Files expected to change
- `src/harness/swe-agent.ts` (new) - the adapter (opaque mode), materialising a per-run config
- `src/harness/registry.ts` - register swe-agent
- (read-only references) `src/harness/types.ts`, `src/runner/capture.ts`, `src/git/clone.ts`
