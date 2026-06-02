# Phase 07 - opencode adapter (canonical adapter template)

## Summary
Implement the first non-claude harness adapter, **opencode**, and validate the whole platform +
bench pipeline end-to-end on `gemma4-cpe:31b`. This phase is the **canonical template** every later
adapter phase follows (08+). One adapter per phase.

## The adapter-phase template (every adapter phase does a pre-flight, then these 5 steps)
0. **Pre-flight install check** - confirm the harness CLI is installed and runnable before anything
   else. If it is missing, STOP and tell the user, with the official install link; do not auto-install
   or proceed.
1. **Read the harness's official docs/README** - find the non-interactive/headless invocation, how
   to select model + base URL/provider, and the run/output format.
2. **Directly test the harness CLI** in a scratch dir against `gemma4-cpe:31b`: does it emit
   **structured/parseable completion** (status/result JSON, like claude's envelope) or only **exit
   code + git diff**? This decision sets the adapter's `completionMode`. Record what you found.
3. **Implement the adapter** (`src/harness/<name>.ts`) in the correct mode against the `Harness`
   contract (`src/harness/types.ts`); register it (`src/harness/registry.ts`).
4. **Validate end-to-end**: a `cpe bench` run of `<name>__gemma4-cpe-31b` on a clone of the baseline
   (the CWD repo at its current branch) produces captured results and (with a remote) a pushed
   `harnesstests/*` branch.
5. **Update PROGRESS.md**.

## opencode specifics
- Headless invocation (verify against current docs): `opencode run --model <provider>/<model>
  "<prompt>"` executed in the run cwd; exits when done.
- Model wiring: opencode uses its own provider config (OpenAI-compatible/Ollama). Map cpe's
  `model`/`provider` to opencode's `--model <provider>/<model>` and/or its config; the homelab setup
  already has a `desktop-ollama` provider pointing at `gemma4-cpe:31b`.
- Expected `completionMode`: **opaque** (exit code + git diff). Confirm in step 2 - if opencode `run`
  can emit machine-readable status, capture it as a bonus but do not depend on it.

## Files expected to change
- `src/harness/opencode.ts` (new) - the adapter (opaque mode)
- `src/harness/registry.ts` - register opencode
- (read-only references) `src/harness/types.ts`, `src/runner/capture.ts`, `src/git/clone.ts`
