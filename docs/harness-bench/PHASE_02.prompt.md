Read docs/harness-bench/PHASE_02.md and docs/harness-bench/README.md before starting. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Phase 01 must be complete first.

Goal: route execution through the Harness registry instead of hardcoding claude, with the claude-code adapter taking the default path so behaviour is unchanged. This is a regression-gated refactor - do not alter what claude does, only how it is invoked.

Files to modify and why:
- src/runner/single-prompt.ts: replace the direct runSession call with adapter dispatch. Resolve the adapter via registry.get(meta.harness ?? appConfig.harness_for_phases ?? 'claude-code') and call adapter.run(ctx), building HarnessContext from the same inputs runSession received (cwd/worktree path, prompt or promptFile, sessionId, logPath, schema, resolved provider env, model args). Consume the returned HarnessResult where the SessionResult/envelope is consumed today.
- src/runner/phase-loop.ts: same dispatch change for the per-phase execution. Preserve all retry, meta update, and bus.emit logic exactly; only the spawn/execute step changes to go through the adapter.
- src/runner/finalise.ts: route the summarise spawn through the claude-code adapter. Add a guard so the summarise step only runs for structured-mode adapters (completionMode === 'structured'); for opaque adapters, skip summarise and emit an informational event. Keep the existing summary-file and plan-folder verification checks.
- src/harness/claude-code.ts: extend the adapter only if the phase-loop call shape needs it (for example a flag to select the summarise prompt vs the phase prompt). Keep runSession itself untouched.

Patterns to follow:
- Keep every bus.emit(...) call and updateMeta(...) call identical for the claude path - the TUI and storage depend on them (see src/events/bus.ts consumers and src/storage/meta.ts).
- Preserve the existing provider resolution (resolveProvider in src/runner/provider.ts) and pass its env/modelArgs through the HarnessContext rather than re-implementing env injection.
- Preserve --dangerously-skip-permissions handling and the --output-format json / --json-schema requirement for claude (it lives in runSession; the adapter just calls it).

Edge cases and error handling:
- If meta.harness names an adapter that is not registered, fail fast with a clear message before any execution.
- An adapter returning outcome 'error' or a non-zero exitCode must follow the existing error path (same bus.emit error event and meta status as a failed claude run today).
- Do not run summarise for opaque harnesses; make the skip explicit and logged, not silent.

Acceptance criteria (regression gate):
- bun run build and lint pass.
- The full existing test suite passes UNCHANGED - especially src/runner/envelope.test.ts and src/runner/jsonl-tail.test.ts. If a test would need changing, stop and reconsider the refactor instead.
- A default single-prompt run (no --harness) produces identical claude behaviour, identical meta fields, and identical events compared to before the refactor (verify by running one and diffing the produced branch/log against a pre-refactor run).
- Passing --harness claude-code explicitly behaves the same as omitting it.

When done, update docs/harness-bench/PROGRESS.md (Phase 02 complete, date, note that the regression gate passed) and commit the phase on feature/harness-bench.
