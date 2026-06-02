Read docs/harness-bench/PHASE_13.md, docs/harness-bench/ADAPTER_BACKLOG.md, and docs/harness-bench/PHASE_07.prompt.md (the canonical adapter template) before starting. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Depends on Phase 07.

Goal: implement the crush (Charmbracelet) harness adapter and validate it end-to-end on gemma4-cpe:31b - IF crush has a headless mode.

Follow the adapter template (do them in order):
0. Pre-flight install check: verify crush is installed and runnable (which crush; crush --version). If it is NOT installed, STOP immediately, tell the user crush is missing, and point them at the official install instructions: https://github.com/charmbracelet/crush . Do not auto-install it or continue the phase.
1. Read crush's current official docs/README. The decisive check: does crush expose a non-interactive/headless run mode that takes a prompt and exits (not just the Bubble Tea TUI)? If NOT, record that finding in the PROGRESS note, mark this phase blocked/parked (do not try to puppet the interactive TUI), and stop. If it does, confirm how to pass the prompt + model + base URL for the local model. Record findings as a comment block at the top of src/harness/crush.ts.
2. Directly test crush headless in a scratch dir against gemma4-cpe:31b. Confirm it runs to completion non-interactively and edits files. Determine completionMode empirically (expected: opaque). Note observations in the comment block.
3. Implement src/harness/crush.ts as a Harness (src/harness/types.ts) with name 'crush' and the completionMode you determined. Build invocation/env/cwd from HarnessContext mapping ctx.model/provider to crush's model + base URL, run headless in ctx.cwd capturing stdout/stderr to ctx.logPath. For opaque mode, derive HarnessResult.outcome from exit code + whether git diff in the clone is non-empty. Populate tokens/costUsd only if crush reports them.
4. Register crush in src/harness/registry.ts.
5. Validate end-to-end: cpe bench "<the homelab update-mechanism prompt>" --harness crush --model gemma4-cpe:31b against a fresh clone of the baseline (the CWD repo at its current branch). Confirm results/crush__gemma4-cpe-31b/{meta.json,diff,transcript} is written and (with a remote) harnesstests/crush__gemma4-cpe-31b is pushed.

Patterns and edge cases:
- Mirror src/harness/claude-code.ts structure but for an opaque harness; reuse provider env mapping (src/runner/provider.ts) and the clone/capture/timeout machinery from Phase 04.
- If crush only runs interactively, do NOT hack around it - record the limitation and park the adapter; that is an acceptable outcome for this phase.
- Keep any crush global config/state out of the captured diff. Treat "ran but made no changes" as 'no-op'. Do not let crush inherit cpe's own ANTHROPIC_* env.

Acceptance criteria:
- bun run build, lint, and existing tests pass; claude-code runs remain unaffected.
- Either: crush is selectable via --harness crush and runs headless to completion on gemma4-cpe:31b with correct captures and a pushed harnesstests/crush__gemma4-cpe-31b branch; OR the PROGRESS note clearly records that crush has no headless mode and the adapter is parked.
- The headless-mode finding and the completionMode decision are documented in the adapter file (or PROGRESS note if parked).

When done, update docs/harness-bench/PROGRESS.md (Phase 13 complete or parked, date, completionMode/headless finding) and commit the phase on feature/harness-bench.
