Read docs/harness-bench/PHASE_11.md, docs/harness-bench/ADAPTER_BACKLOG.md, and docs/harness-bench/PHASE_07.prompt.md (the canonical adapter template) before starting. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Depends on Phase 07.

Goal: implement the plandex harness adapter and validate it end-to-end on gemma4-cpe:31b, plus write the orchestrator-notes bonus deliverable.

Follow the adapter template (do them in order):
0. Pre-flight install check: verify plandex is installed and runnable (which plandex; plandex version). If it is NOT installed, STOP immediately, tell the user plandex is missing, and point them at the official install instructions: https://docs.plandex.ai/ (repo https://github.com/plandex-ai/plandex). Also confirm a plandex server is reachable/runnable; if not, STOP with a clear message (and document the server setup). Do not auto-install anything or continue the phase.
1. Read plandex's current official docs for headless use and its client/server model. Confirm how the CLI runs a task non-interactively, how to point it at a local plandex server, and how to wire an OpenAI-compatible/Ollama model for the local model. Record findings as a comment block at the top of src/harness/plandex.ts.
2. Directly test plandex in a scratch dir against gemma4-cpe:31b (with a local server). Confirm it applies changes to the repo and runs to completion. Determine completionMode empirically (expected: opaque). Note observations in the comment block.
3. Implement src/harness/plandex.ts as a Harness (src/harness/types.ts) with name 'plandex' and the completionMode you determined. Wire model/provider/server from ctx, run in ctx.cwd (the clone) so applied changes land there, capture stdout/stderr to ctx.logPath. For opaque mode, derive HarnessResult.outcome from exit code + whether git diff in the clone is non-empty. Populate tokens/costUsd only if plandex reports them.
4. Register plandex in src/harness/registry.ts.
5. Validate end-to-end: cpe bench "<the homelab update-mechanism prompt>" --harness plandex --model gemma4-cpe:31b against a fresh clone of the baseline (the CWD repo at its current branch). Confirm results/plandex__gemma4-cpe-31b/{meta.json,diff,transcript} is written and (with a remote) harnesstests/plandex__gemma4-cpe-31b is pushed.

Bonus deliverable (do this too): write docs/harness-bench/orchestrator-notes.md - evaluate whether plandex's client/server split maps onto the eventual "run harnesses on a server from an orchestrator" goal. Could plandex's server be the orchestration substrate, or is it just another adapter? Evaluation only; do not build the orchestrator.

Patterns and edge cases:
- Mirror src/harness/claude-code.ts structure but for an opaque harness; reuse provider env mapping (src/runner/provider.ts) and the clone/capture/timeout machinery from Phase 04.
- plandex's apply sandbox must land changes in the clone for capture; keep plandex server state/config out of the captured diff.
- Treat "ran but made no changes" as 'no-op', distinct from 'error'. Do not let plandex inherit cpe's own ANTHROPIC_* env.

Acceptance criteria:
- bun run build, lint, and existing tests pass; claude-code runs remain unaffected.
- plandex is selectable via --harness plandex and runs headless to completion on gemma4-cpe:31b against a local server.
- A bench run produces correct captures and a pushed harnesstests/plandex__gemma4-cpe-31b branch whose diff matches what plandex applied.
- docs/harness-bench/orchestrator-notes.md exists with the client/server-vs-orchestrator evaluation.
- The completionMode decision and the server setup are documented in the adapter file.

When done, update docs/harness-bench/PROGRESS.md (Phase 11 complete, date, completionMode) and commit the phase on feature/harness-bench.
