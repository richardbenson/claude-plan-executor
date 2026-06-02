# Phase 08 - aider adapter (the edit-strategy comparison)

## Summary
Add the **aider** harness adapter following the Phase 07 template. aider's selectable **edit format**
(`whole` / `diff` / `udiff`) is the most interesting single variable in the whole set: `whole`
rewrites entire files and sidesteps the exact-`oldString` edit failure that broke the fast MoE under
opencode. Expose edit-format as an adapter option and test it.

## Pre-flight
Confirm `aider` is installed (`which aider`, `aider --version`). If missing, STOP and point the user at
the official install instructions: https://aider.chat/docs/install.html . Do not auto-install.

## aider specifics (verify against current docs in step 1)
- Headless invocation: `aider --message "<prompt>" --yes-always --model <provider>/<model>` (or
  `--message-file <file>`). Local model via `--model ollama/<model>` or an OpenAI-compatible config.
- Edit format: `--edit-format whole|diff|udiff`. Expose this as an adapter option; default to a value
  that works for the local model (likely `whole` for the MoE).
- Model matrix for validation should include **gemma4-cpe:26b** (the fast MoE) to test the core
  hypothesis: does `whole`-file editing rescue the MoE that failed opencode's exact-`oldString` edits?

## Completion mode
Expected **opaque** (exit code + git diff). aider **auto-commits** its changes, so capture must use
aider's own commits rather than assuming a dirty working tree.

## Files expected to change
- `src/harness/aider.ts` (new) - the adapter (opaque mode), with an edit-format option
- `src/harness/registry.ts` - register aider
- (read-only references) `src/harness/types.ts`, `src/runner/capture.ts`, `src/git/clone.ts`
