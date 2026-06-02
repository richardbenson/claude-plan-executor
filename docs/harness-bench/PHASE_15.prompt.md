Read docs/harness-bench/PHASE_15.md, docs/harness-bench/ADAPTER_BACKLOG.md, and docs/harness-bench/PHASE_07.prompt.md (the canonical adapter template) before starting. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Depends on Phase 07. Config-heavy - budget extra time.

Goal: implement the swe-agent (Princeton) harness adapter and validate it end-to-end on gemma4-cpe:31b via LiteLLM.

Follow the adapter template (do them in order):
0. Pre-flight install check: verify swe-agent is installed and runnable (confirm the binary/command in step 1 - likely sweagent; sweagent --version). If it is NOT installed, STOP immediately, tell the user swe-agent is missing, and point them at the official install instructions: https://swe-agent.com/ (repo https://github.com/SWE-agent/SWE-agent). Do not auto-install it or continue the phase.
1. Read swe-agent's current official docs for its scriptable run mode and LiteLLM model config. Confirm the exact run command, how to configure a LiteLLM/Ollama model + base URL for the local model, and how to point its workspace at a given repo directory. Record findings as a comment block at the top of src/harness/swe-agent.ts.
2. Directly test swe-agent in a scratch dir against gemma4-cpe:31b via LiteLLM. Confirm it runs to completion and produces edits/a patch. Determine completionMode empirically (expected: opaque). Note observations in the comment block.
3. Implement src/harness/swe-agent.ts as a Harness (src/harness/types.ts) with name 'swe-agent' and the completionMode you determined. Materialise the per-run config (model via LiteLLM/Ollama from ctx.model/provider, workspace = ctx.cwd the clone, the task/prompt) into a temp config, run capturing stdout/stderr to ctx.logPath, and clean up. Ensure edits land in the clone (apply the patch if swe-agent emits one rather than editing in place). For opaque mode, derive HarnessResult.outcome from exit code + whether git diff in the clone is non-empty. Populate tokens/costUsd only if swe-agent reports them.
4. Register swe-agent in src/harness/registry.ts.
5. Validate end-to-end: cpe bench "<the homelab update-mechanism prompt>" --harness swe-agent --model gemma4-cpe:31b against a fresh clone of the baseline (the CWD repo at its current branch). Confirm results/swe-agent__gemma4-cpe-31b/{meta.json,diff,transcript} is written and (with a remote) harnesstests/swe-agent__gemma4-cpe-31b is pushed.

Patterns and edge cases:
- Mirror src/harness/claude-code.ts structure but for an opaque harness; reuse provider env mapping (src/runner/provider.ts) and the clone/capture/timeout machinery from Phase 04.
- Config-heavy is the main risk: isolate the per-run config and remove it after; keep swe-agent global state out of the captured diff.
- If swe-agent emits a patch instead of editing in place, apply it to the clone so capture/diff/branch-push see the changes.
- Treat "ran but made no changes" as 'no-op'. Do not let swe-agent inherit cpe's own ANTHROPIC_* env (give it only the LiteLLM/base-URL env it needs).

Acceptance criteria:
- bun run build, lint, and existing tests pass; claude-code runs remain unaffected.
- swe-agent is selectable via --harness swe-agent and runs to completion on gemma4-cpe:31b via LiteLLM.
- A bench run produces correct captures and a pushed harnesstests/swe-agent__gemma4-cpe-31b branch whose diff matches what swe-agent changed.
- The completionMode decision and the LiteLLM/config approach are documented in the adapter file.

When done, update docs/harness-bench/PROGRESS.md (Phase 15 complete, date, completionMode) and commit the phase on feature/harness-bench.
