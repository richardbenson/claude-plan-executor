# Harness Bench - Progress

Single working branch: `feature/harness-bench` (off `main`). **One commit per phase** on that branch -
no per-phase branches, no per-phase PRs (we build and test locally; nobody else reviews). See
[README.md](README.md) for scope, branching, and Definition of Done.

## Core platform + bench

| Phase | Title | Status | Depends on |
|-------|-------|--------|-----------|
| 01 | Run parameterization + Harness contract & registry | complete | - |
| 02 | Executor dispatch refactor (single-prompt + phase-loop) | complete | 01 |
| 03 | Anthropic->Ollama proxy + local-model provider preset | not-started | 02 |
| 04 | Clone isolation + capture + branch push + activity-timeout + pause | not-started | 02 |
| 05 | Matrix / bench command + summary table | not-started | 04 |
| 06 | Bounded live TUI + manual bail | not-started | 04 |

## Adapters (one harness per phase; template = Phase 07)

| Phase | Title | Status | Depends on |
|-------|-------|--------|-----------|
| 07 | opencode adapter (canonical template) | not-started | 05 |
| 08 | aider adapter | not-started | 07 |
| 09 | goose adapter | not-started | 07 |
| 10 | openhands adapter | not-started | 07 |
| 11 | plandex adapter + orchestrator write-up | not-started | 07 |
| 12 | pi adapter | not-started | 07 |
| 13 | crush adapter | not-started | 07 |
| 14 | codex-cli adapter | not-started | 07 |
| 15 | swe-agent adapter | not-started | 07 |

Backlog detail and per-harness intel: [ADAPTER_BACKLOG.md](ADAPTER_BACKLOG.md). Every adapter phase
(08-15) follows the Phase 07 template; since the whole matrix may run for many hours, we phase in the
full set rather than stopping at plandex.

## Per-phase notes

### Phase 01
- Status: complete
- Started: 2026-06-02 / Completed: 2026-06-02
- Notes: Added Harness contract (src/harness/types.ts), registry + claude-code adapter, persisted {harness,model,provider} on RunMeta via --harness/--model/--provider on plan/queue/prompt. No runtime dispatch change yet (Phase 02). Registry test added; existing tests unchanged.

### Phase 02
- Status: complete
- Started: 2026-06-02 / Completed: 2026-06-02
- Notes: Regression gate passed - full suite (43 tests, incl. envelope/jsonl-tail) passes unchanged;
  build/typecheck/lint clean. single-prompt.ts and phase-loop.ts now resolve the adapter via
  registry.get(meta.harness ?? harness_for_phases ?? 'claude-code') and dispatch through adapter.run();
  the claude-code adapter forwards byte-for-byte identical args to runSession (provider env + modelArgs +
  skipPermissions), so default claude runs are unchanged. finalise.ts gates summarise to structured
  adapters (opaque -> skip + 'text' info event). resumeOrRestart left claude-specific (rate-limit resume,
  not part of the contract this phase). Unknown harness fails fast via existing error paths.

### Phase 03
- Status: not-started
- Started: - / Completed: -
- Notes: The immediate cost escape; enables claude-on-local for validating phases 04-06 for free.

### Phase 04
- Status: not-started
- Started: - / Completed: -
- Notes:

### Phase 05
- Status: not-started
- Started: - / Completed: -
- Notes:

### Phase 06
- Status: not-started
- Started: - / Completed: -
- Notes:

### Phase 07
- Status: not-started
- Started: - / Completed: -
- Notes: First non-claude adapter; opaque completion mode expected. Validates the contract end-to-end.

### Phases 08-15
- One adapter per phase (aider, goose, openhands, plandex, pi, crush, codex-cli, swe-agent), each a
  commit on `feature/harness-bench`. See ADAPTER_BACKLOG.md.
