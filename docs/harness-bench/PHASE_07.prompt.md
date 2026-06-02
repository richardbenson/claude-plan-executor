Read docs/harness-bench/PHASE_07.md and docs/harness-bench/README.md before starting. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Depends on Phase 05. This phase is the template all later adapter phases (08-15) follow.

Goal: implement the opencode harness adapter and validate the full platform + bench pipeline end-to-end on gemma4-cpe:31b.

Follow the adapter template (do them in order):
0. Pre-flight install check: verify opencode is installed and runnable (which opencode; opencode --version). If it is NOT installed, STOP immediately, tell the user opencode is missing, and point them at the official install instructions (https://opencode.ai/docs / https://github.com/sst/opencode). Do not auto-install it or continue the phase.
1. Read opencode's current official docs/README for its non-interactive run mode. Confirm the exact headless command, how to pass the model and provider/base URL, and what it prints. Record findings as a short comment block at the top of src/harness/opencode.ts.
2. Directly test opencode in a scratch directory against gemma4-cpe:31b (via the existing desktop-ollama provider / OpenAI-compatible endpoint). Determine empirically whether opencode run emits structured/parseable completion output (a status/result you can parse, like claude's envelope) or only exit code + git diff. This sets completionMode. Write down what you observed in the same comment block.
3. Implement src/harness/opencode.ts as a Harness (src/harness/types.ts) with name 'opencode' and the completionMode you determined (expected: 'opaque'). Build the invocation (argv/env/cwd) from HarnessContext: spawn opencode run with --model mapped from ctx.model/provider, in ctx.cwd, capturing stdout/stderr to ctx.logPath. For opaque mode, derive HarnessResult.outcome from exit code plus whether git diff in the clone is non-empty (non-zero changes + exit 0 => 'completed'; exit 0 + no diff => 'no-op'; non-zero => 'error'; timeout is handled by the dispatch wrapper). Populate tokens/costUsd only if opencode actually reports them.
4. Register opencode in src/harness/registry.ts.
5. Validate end-to-end: run cpe bench "<the homelab update-mechanism prompt>" --harness opencode --model gemma4-cpe:31b against a fresh clone of the baseline (the CWD repo at its current branch, as detected by Phase 04/05 - no hardcoded modeltests/sandbox-no-docs). Confirm results/opencode__gemma4-cpe-31b/{meta.json,diff,transcript} is written and (with a remote) harnesstests/opencode__gemma4-cpe-31b is pushed.

Patterns to follow:
- Mirror the structure of src/harness/claude-code.ts but for an opaque harness (no envelope; derive outcome from exit + diff).
- Reuse the provider env mapping (src/runner/provider.ts) and the clone/capture/timeout machinery from Phase 04 - the adapter only owns "how to invoke this harness and interpret its completion".
- Use the existing spawn conventions (Bun.spawn with cwd, piped stdout/stderr to the log) seen in src/runner/session.ts.

Edge cases and error handling:
- opencode may need its provider/model configured in a config file rather than purely via --model; if so, the adapter must materialise that config into the clone (or a temp config dir) before running, and clean it up after. Document this.
- If opencode writes outside the clone (global config/state), keep that out of the captured diff.
- Treat "ran but made no changes" as 'no-op', distinct from 'error', so the summary is meaningful.
- Do not let opencode inherit cpe's own ANTHROPIC_* env; pass only what opencode needs.

Acceptance criteria:
- bun run build, lint, and existing tests pass; claude-code runs remain unaffected.
- opencode is selectable via --harness opencode and runs headless to completion on gemma4-cpe:31b.
- A bench run produces correct captures and a pushed harnesstests/opencode__gemma4-cpe-31b branch whose diff matches what opencode actually changed.
- The completionMode decision (and how it was tested) is documented in the adapter file.

When done, update docs/harness-bench/PROGRESS.md (Phase 07 complete, date, and the opencode completionMode you found) and commit the phase on feature/harness-bench.
