Read docs/harness-bench/PHASE_08.md, docs/harness-bench/ADAPTER_BACKLOG.md, and docs/harness-bench/PHASE_07.prompt.md (the canonical adapter template) before starting. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Depends on Phase 07.

Goal: implement the aider harness adapter and validate it end-to-end on gemma4-cpe:31b (and gemma4-cpe:26b), exposing aider's edit-format as an adapter option.

Follow the adapter template (do them in order):
0. Pre-flight install check: verify aider is installed and runnable (which aider; aider --version). If it is NOT installed, STOP immediately, tell the user aider is missing, and point them at the official install instructions: https://aider.chat/docs/install.html . Do not auto-install it or continue the phase.
1. Read aider's current official docs for headless use. Confirm the exact non-interactive command (expected: aider --message / --message-file with --yes-always), how to point it at a local Ollama model (--model ollama/<model> or OpenAI-compatible config), and the --edit-format options. Record findings as a comment block at the top of src/harness/aider.ts.
2. Directly test aider in a scratch dir against gemma4-cpe:31b. Confirm it runs to completion non-interactively, and observe its output and that it auto-commits. Determine completionMode empirically (expected: opaque). Note what you observed in the comment block.
3. Implement src/harness/aider.ts as a Harness (src/harness/types.ts) with name 'aider' and the completionMode you determined. Build invocation/env/cwd from HarnessContext; map ctx.model/provider to aider's --model; expose an edit-format option (whole|diff|udiff) with a sensible default for the local model. Because aider auto-commits, derive HarnessResult.outcome and the captured diff from aider's commits (commits since the clone's base ref = 'completed'; no commits + exit 0 = 'no-op'; non-zero exit = 'error'; timeout/bail handled by the dispatch wrapper). Populate tokens/costUsd only if aider reports them.
4. Register aider in src/harness/registry.ts.
5. Validate end-to-end: cpe bench "<the homelab update-mechanism prompt>" --harness aider --model gemma4-cpe:31b,gemma4-cpe:26b against a fresh clone of the baseline (the CWD repo at its current branch). Confirm results/aider__gemma4-cpe-31b and results/aider__gemma4-cpe-26b are written with {meta.json,diff,transcript}, and (with a remote) the harnesstests/* branches are pushed. The 26b run is the edit-strategy hypothesis test - record whether whole-file editing rescues the MoE.

Patterns and edge cases:
- Mirror src/harness/claude-code.ts structure but for an opaque, auto-committing harness; reuse provider env mapping (src/runner/provider.ts) and the clone/capture/timeout machinery from Phase 04.
- Reconcile aider's auto-commit with capture/branch-push: use aider's commits as the source of truth for the diff and the harnesstests branch; do not double-commit.
- Treat "ran but made no changes" as 'no-op', distinct from 'error'.
- Do not let aider inherit cpe's own ANTHROPIC_* env; pass only what aider needs.

Acceptance criteria:
- bun run build, lint, and existing tests pass; claude-code runs remain unaffected.
- aider is selectable via --harness aider and runs headless to completion on the local model.
- A bench run produces correct captures and pushed harnesstests/aider__* branches whose diffs match aider's commits.
- The completionMode decision, the edit-format handling, and the 26b edit-strategy result are documented in the adapter file and the PROGRESS note.

When done, update docs/harness-bench/PROGRESS.md (Phase 08 complete, date, completionMode, and the 26b edit-strategy finding) and commit the phase on feature/harness-bench.
