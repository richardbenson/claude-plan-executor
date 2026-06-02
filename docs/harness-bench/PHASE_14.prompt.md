Read docs/harness-bench/PHASE_14.md, docs/harness-bench/ADAPTER_BACKLOG.md, and docs/harness-bench/PHASE_07.prompt.md (the canonical adapter template) before starting. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Depends on Phase 07.

Goal: implement the codex-cli (OpenAI) harness adapter and validate it end-to-end on gemma4-cpe:31b, including local-model support.

Follow the adapter template (do them in order):
0. Pre-flight install check: verify the codex CLI is installed and runnable (which codex; codex --version). If it is NOT installed, STOP immediately, tell the user codex-cli is missing, and point them at the official install instructions: https://github.com/openai/codex . Do not auto-install it or continue the phase.
1. Read codex-cli's current official docs for headless/non-interactive use AND for local-model support. Confirm the exact run command, how to point it at a custom base URL / OpenAI-compatible endpoint, and how it selects model. If it only targets OpenAI's API, plan to route it via the Phase 03 proxy or Ollama's OpenAI-compatible endpoint for the local model. Record findings as a comment block at the top of src/harness/codex.ts.
2. Directly test codex-cli in a scratch dir against gemma4-cpe:31b (via the base URL / proxy you identified). Confirm it runs headless to completion and edits files. Determine completionMode empirically (expected: opaque). Note observations in the comment block.
3. Implement src/harness/codex.ts as a Harness (src/harness/types.ts) with name 'codex' (or 'codex-cli') and the completionMode you determined. Build invocation/env/cwd from HarnessContext, mapping ctx.model/provider to codex's model + base URL (using the proxy if required), run headless in ctx.cwd capturing stdout/stderr to ctx.logPath. For opaque mode, derive HarnessResult.outcome from exit code + whether git diff in the clone is non-empty. Populate tokens/costUsd only if codex reports them.
4. Register codex-cli in src/harness/registry.ts (use a consistent name and document it).
5. Validate end-to-end: cpe bench "<the homelab update-mechanism prompt>" --harness codex --model gemma4-cpe:31b against a fresh clone of the baseline (the CWD repo at its current branch). Confirm results/codex__gemma4-cpe-31b/{meta.json,diff,transcript} is written and (with a remote) harnesstests/codex__gemma4-cpe-31b is pushed.

Patterns and edge cases:
- Mirror src/harness/claude-code.ts structure but for an opaque harness; reuse provider env mapping (src/runner/provider.ts) and the clone/capture/timeout machinery from Phase 04. Reuse the Phase 03 proxy rather than inventing a new local-model path.
- codex-cli is sandbox-focused: ensure its sandbox/permissions allow editing the clone and that the edits land there for capture; keep its global config/state out of the captured diff.
- Treat "ran but made no changes" as 'no-op'. Do not let codex inherit cpe's own ANTHROPIC_* env (give it only the OpenAI-compatible/base-URL env it needs).

Acceptance criteria:
- bun run build, lint, and existing tests pass; claude-code runs remain unaffected.
- codex-cli is selectable via --harness codex and runs headless to completion on gemma4-cpe:31b.
- A bench run produces correct captures and a pushed harnesstests/codex__gemma4-cpe-31b branch whose diff matches what codex changed.
- The completionMode decision and the local-model/base-URL wiring are documented in the adapter file.

When done, update docs/harness-bench/PROGRESS.md (Phase 14 complete, date, completionMode, local-model approach) and commit the phase on feature/harness-bench.
