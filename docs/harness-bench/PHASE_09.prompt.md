Read docs/harness-bench/PHASE_09.md, docs/harness-bench/ADAPTER_BACKLOG.md, and docs/harness-bench/PHASE_07.prompt.md (the canonical adapter template) before starting. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Depends on Phase 07.

Goal: implement the goose (Block) harness adapter and validate it end-to-end on gemma4-cpe:31b.

Follow the adapter template (do them in order):
0. Pre-flight install check: verify goose is installed and runnable (which goose; goose --version). If it is NOT installed, STOP immediately, tell the user goose is missing, and point them at the official install instructions: https://block.github.io/goose/docs/getting-started/installation (repo https://github.com/block/goose). Do not auto-install it or continue the phase.
1. Read goose's current official docs for headless/non-interactive use. Confirm the exact run command (expected: goose run -t / -i), and crucially how it selects provider/model - it uses goose config profiles, not just flags. Work out how to materialise an Ollama profile pointing at the local model + base URL, and how to isolate that config per run (temp config dir / env override) so it does not touch the user's global goose config. Note any MCP extensions needed for file editing. Record findings as a comment block at the top of src/harness/goose.ts.
2. Directly test goose in a scratch dir against gemma4-cpe:31b using the isolated Ollama profile. Confirm it runs to completion non-interactively and edits files. Determine completionMode empirically (expected: opaque). Note observations in the comment block.
3. Implement src/harness/goose.ts as a Harness (src/harness/types.ts) with name 'goose' and the completionMode you determined. Materialise the per-run Ollama profile/config from ctx.model/provider into a temp config dir, set the env so goose uses it, spawn goose run in ctx.cwd capturing stdout/stderr to ctx.logPath, and clean the temp config up afterwards. For opaque mode, derive HarnessResult.outcome from exit code + whether git diff in the clone is non-empty (changes + exit 0 = 'completed'; exit 0 + no diff = 'no-op'; non-zero = 'error'). Populate tokens/costUsd only if goose reports them.
4. Register goose in src/harness/registry.ts.
5. Validate end-to-end: cpe bench "<the homelab update-mechanism prompt>" --harness goose --model gemma4-cpe:31b against a fresh clone of the baseline (the CWD repo at its current branch). Confirm results/goose__gemma4-cpe-31b/{meta.json,diff,transcript} is written and (with a remote) harnesstests/goose__gemma4-cpe-31b is pushed.

Patterns and edge cases:
- Mirror src/harness/claude-code.ts structure but for an opaque harness; reuse provider env mapping (src/runner/provider.ts) and the clone/capture/timeout machinery from Phase 04.
- goose's global config is the main hazard: never mutate the user's real goose profiles - always use an isolated per-run config and remove it after.
- Keep any goose global state/config out of the captured diff.
- Treat "ran but made no changes" as 'no-op', distinct from 'error'. Do not let goose inherit cpe's own ANTHROPIC_* env.

Acceptance criteria:
- bun run build, lint, and existing tests pass; claude-code runs remain unaffected.
- goose is selectable via --harness goose and runs headless to completion on gemma4-cpe:31b using an isolated Ollama profile.
- A bench run produces correct captures and a pushed harnesstests/goose__gemma4-cpe-31b branch whose diff matches what goose changed.
- The completionMode decision and the config-isolation approach are documented in the adapter file.

When done, update docs/harness-bench/PROGRESS.md (Phase 09 complete, date, completionMode) and commit the phase on feature/harness-bench.
