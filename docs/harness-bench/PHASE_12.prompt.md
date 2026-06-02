Read docs/harness-bench/PHASE_12.md, docs/harness-bench/ADAPTER_BACKLOG.md, and docs/harness-bench/PHASE_07.prompt.md (the canonical adapter template) before starting. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Depends on Phase 07.

Goal: implement the pi (https://pi.dev/) harness adapter and validate it end-to-end on gemma4-cpe:31b.

Follow the adapter template (do them in order):
0. Pre-flight install check: verify pi is installed and runnable (which pi; pi --version - confirm the actual binary name from the docs at https://pi.dev/ in step 1). If it is NOT installed, STOP immediately, tell the user pi is missing, and point them at the official install instructions: https://pi.dev/ . Do not auto-install it or continue the phase.
1. Read pi's current official docs for non-interactive use. Confirm the exact run command, how to pass the prompt, and how it selects model + base URL (expected: native Ollama, so wiring the local model should be simple). Record findings as a comment block at the top of src/harness/pi.ts.
2. Directly test pi in a scratch dir against gemma4-cpe:31b. Confirm it runs to completion and edits files. Determine completionMode empirically (expected: opaque). Note observations in the comment block.
3. Implement src/harness/pi.ts as a Harness (src/harness/types.ts) with name 'pi' and the completionMode you determined. Build invocation/env/cwd from HarnessContext mapping ctx.model/provider to pi's model + base URL, run in ctx.cwd capturing stdout/stderr to ctx.logPath. For opaque mode, derive HarnessResult.outcome from exit code + whether git diff in the clone is non-empty. Populate tokens/costUsd only if pi reports them.
4. Register pi in src/harness/registry.ts.
5. Validate end-to-end: cpe bench "<the homelab update-mechanism prompt>" --harness pi --model gemma4-cpe:31b against a fresh clone of the baseline (the CWD repo at its current branch). Confirm results/pi__gemma4-cpe-31b/{meta.json,diff,transcript} is written and (with a remote) harnesstests/pi__gemma4-cpe-31b is pushed.

Patterns and edge cases:
- Mirror src/harness/claude-code.ts structure but for an opaque harness; reuse provider env mapping (src/runner/provider.ts) and the clone/capture/timeout machinery from Phase 04.
- Keep any pi global config/state out of the captured diff. Treat "ran but made no changes" as 'no-op', distinct from 'error'. Do not let pi inherit cpe's own ANTHROPIC_* env.

Acceptance criteria:
- bun run build, lint, and existing tests pass; claude-code runs remain unaffected.
- pi is selectable via --harness pi and runs to completion on gemma4-cpe:31b.
- A bench run produces correct captures and a pushed harnesstests/pi__gemma4-cpe-31b branch whose diff matches what pi changed.
- The completionMode decision and the confirmed install source are documented in the adapter file.

When done, update docs/harness-bench/PROGRESS.md (Phase 12 complete, date, completionMode) and commit the phase on feature/harness-bench.
