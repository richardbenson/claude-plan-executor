Read docs/harness-bench/PHASE_10.md, docs/harness-bench/ADAPTER_BACKLOG.md, and docs/harness-bench/PHASE_07.prompt.md (the canonical adapter template) before starting. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Depends on Phase 07. This is the heaviest adapter - budget extra time.

Goal: implement the openhands (All-Hands) harness adapter and validate it end-to-end on gemma4-cpe:31b, with its sandboxed runtime operating on the run's clone.

Follow the adapter template (do them in order):
0. Pre-flight install check: verify the openhands CLI is installed and runnable (which openhands; openhands --version; the CLI-only package is openhands-cli). If it is NOT installed, STOP immediately, tell the user openhands is missing, and point them at the official install instructions: https://docs.all-hands.dev/ (repo https://github.com/All-Hands-AI/OpenHands). Also verify the sandbox runtime prerequisite (e.g. Docker) is available; if not, STOP with a clear message. Do not auto-install anything or continue the phase.
1. Read openhands' current official docs for headless/CLI-only use. Confirm the exact command (expected: openhands -t "<prompt>" --headless), how to configure the LLM (ollama/<model> + base_url), and how its sandboxed runtime selects a workspace directory. Record findings as a comment block at the top of src/harness/openhands.ts.
2. Directly test openhands in a scratch dir against gemma4-cpe:31b. Confirm it runs headless to completion and that the file changes land where you can capture them. Determine completionMode empirically (expected: opaque; check whether it emits a structured event log you could parse as a bonus). Note observations in the comment block.
3. Implement src/harness/openhands.ts as a Harness (src/harness/types.ts) with name 'openhands' and the completionMode you determined. Configure the LLM from ctx.model/provider, and make the sandbox use ctx.cwd (the clone) as its workspace so edits land in the clone. Spawn headless, capturing stdout/stderr (and the event log if present) to ctx.logPath. For opaque mode, derive HarnessResult.outcome from exit code + whether git diff in the clone is non-empty. Populate tokens/costUsd only if openhands reports them.
4. Register openhands in src/harness/registry.ts.
5. Validate end-to-end: cpe bench "<the homelab update-mechanism prompt>" --harness openhands --model gemma4-cpe:31b against a fresh clone of the baseline (the CWD repo at its current branch). Confirm results/openhands__gemma4-cpe-31b/{meta.json,diff,transcript} is written and (with a remote) harnesstests/openhands__gemma4-cpe-31b is pushed.

Patterns and edge cases:
- Mirror src/harness/claude-code.ts structure but for an opaque harness; reuse provider env mapping (src/runner/provider.ts) and the clone/capture/timeout machinery from Phase 04.
- The single biggest risk is the sandbox not editing the clone: confirm the workspace mount/path so changes are captured and pushed. Keep any sandbox/global state out of the captured diff.
- Heavy startup may look like inactivity - the Phase 04 activity-based timeout should tolerate quiet startup; verify a real run is not killed prematurely.
- Treat "ran but made no changes" as 'no-op', distinct from 'error'. Do not let openhands inherit cpe's own ANTHROPIC_* env.

Acceptance criteria:
- bun run build, lint, and existing tests pass; claude-code runs remain unaffected.
- openhands is selectable via --harness openhands and runs headless to completion on gemma4-cpe:31b with its sandbox operating on the clone.
- A bench run produces correct captures and a pushed harnesstests/openhands__gemma4-cpe-31b branch whose diff matches what openhands changed.
- The completionMode decision and the sandbox/workspace wiring are documented in the adapter file.

When done, update docs/harness-bench/PROGRESS.md (Phase 10 complete, date, completionMode, sandbox notes) and commit the phase on feature/harness-bench.
