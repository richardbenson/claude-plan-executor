# Phase 14 - codex-cli adapter (OpenAI)

## Summary
Add the **codex-cli** (OpenAI, Apache-2.0) harness adapter following the Phase 07 template. It is
sandbox-focused; the key risk is local-model support, which may require a custom base URL (reuse the
Phase 03 proxy if needed).

## Pre-flight
Confirm the codex CLI is installed (`which codex`, `codex --version`). If missing, STOP and point the
user at the official install instructions: https://github.com/openai/codex . Do not auto-install.

## codex-cli specifics (verify against current docs in step 1)
- Verify local-model support and how to point it at a custom base URL / OpenAI-compatible endpoint.
  If it only speaks OpenAI's API, route it through the Phase 03 Anthropic/OpenAI-compatible proxy (or
  point it straight at Ollama's OpenAI-compatible endpoint) for the local model.
- Find the headless/non-interactive run invocation and the model/base-URL wiring.

## Completion mode
Expected **opaque** (exit + git diff). Confirm in step 2.

## Files expected to change
- `src/harness/codex.ts` (new) - the adapter (opaque mode)
- `src/harness/registry.ts` - register codex-cli (name e.g. `codex` or `codex-cli`)
- (read-only references) `src/harness/types.ts`, `src/runner/capture.ts`, `src/git/clone.ts`
