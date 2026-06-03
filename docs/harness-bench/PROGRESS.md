# Harness Bench - Progress

Single working branch: `feature/harness-bench` (off `main`). **One commit per phase** on that branch -
no per-phase branches, no per-phase PRs (we build and test locally; nobody else reviews). See
[README.md](README.md) for scope, branching, and Definition of Done.

## Core platform + bench

| Phase | Title | Status | Depends on |
|-------|-------|--------|-----------|
| 01 | Run parameterization + Harness contract & registry | complete | - |
| 02 | Executor dispatch refactor (single-prompt + phase-loop) | complete | 01 |
| 03 | Anthropic->Ollama proxy + local-model provider preset | complete | 02 |
| 04 | Clone isolation + capture + branch push + activity-timeout + pause | complete | 02 |
| 05 | Matrix / bench command + summary table | complete | 04 |
| 06 | Bounded live TUI + manual bail | complete | 04 |

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
- Status: complete
- Started: 2026-06-03 / Completed: 2026-06-03
- Notes: The immediate cost escape; enables claude-on-local for validating phases 04-06 for free.
  **Correction:** the phase premise (a translation proxy is required) is obsolete - modern Ollama
  (verified 0.30.2) natively serves the Anthropic /v1/messages API incl. tool use, so **no proxy is
  needed**; point ANTHROPIC_BASE_URL straight at Ollama (as the repo's existing providers already do).
  Final approach: `cpe provider add --preset desktop-ollama` -> direct
  (anthropic_base_url=http://192.168.1.3:11434, health_check_url=/api/tags, env-overridable, no
  hardcoded secrets). Validated end-to-end: claude -p direct and a full cpe single-prompt run on
  gemma4-cpe:31b both created+committed a file with valid structured output, status `complete`, zero
  api.anthropic.com traffic. docs/harness-bench/proxy.md documents the direct path; LiteLLM
  (docker-compose.yml + litellm-config.yaml, verified working) is demoted to an optional appendix for
  non-Anthropic-native backends only. Test artifacts cleaned up afterwards.

### Phase 04
- Status: complete
- Started: 2026-06-03 / Completed: 2026-06-03
- Notes: New: src/git/clone.ts (full clone per run from CWD repo+branch, agent-git-safe),
  src/runner/proc-tree.ts (setsid process-group + killTree), src/runner/run-guard.ts (activity timeout
  w/ repeat-suppression + bail registry), src/runner/capture.ts (diff/transcript/meta -> results/
  <harness>__<model>/ + optional harnesstests/* push). Bench runs take a distinct path in
  single-prompt.ts (clone cwd + guard + capture, no retry/PR ceremony); default worktree runs unchanged.
  Activity is fed from raw JSONL line growth via startJsonlTail onActivity (the same reader the live tail
  uses) so a slow model mid-turn isn't killed. Inter-run pause in start.ts (interruptible, injectable).
  Added 'timeout'/'bailed' RunStatus. Validated: process-tree kill leaves 0 orphans; silent/sleeper run
  killed as 'timeout', manual bail as 'bailed' (both 0 orphans, capture ran); capture writes real
  non-empty diff + baseline (deterministic); harnesstests/* pushed to a bare remote; real gemma4-cpe:31b
  clone run created+committed a file IN the clone with the baseline untouched (isolation holds); pause
  unit-tested. 55 tests pass, lint/build clean. Note: harnesstests push validated against a throwaway
  bare repo (not a real github/gitea remote, to avoid pushing test branches).

### Phase 05
- Status: complete
- Started: 2026-06-03 / Completed: 2026-06-03
- Notes: New src/commands/bench.ts: `cpe bench "<prompt>" --harness a,b --model x,y [--provider --repo
  --branch --prompt-file --force]` enqueues the harness×model cross-product as clone-isolated
  single-prompt runs (baseline = CWD repo at current branch, overridable; nothing hardcoded). Validates
  all harnesses up front (enqueues nothing on unknown); requires ≥1 model; de-dupes combos; skips combos
  with existing results unless --force; prints the planned matrix first. `cpe bench summary` tabulates
  results/*/meta.json (harness/model/outcome/duration/files/lines/tokens/cost/branch), tolerating
  missing/partial/unreadable meta. cli.ts registers `bench` + `bench summary`. start.ts: skip
  worktree-reconcile for clone runs (they clone lazily) — needed so the queue processor runs bench runs.
  Validated: fail-fast (queue unchanged), matrix enqueue (correct names/meta), skip/--force, summary
  table (incl. partial/unreadable rows), and the queue processor running two clone runs SEQUENTIALLY
  with the configured pause (reconcile guard: neither failed). 55 tests pass, lint/build clean.
  NOTE: during validation a too-broad cleanup rm deleted all cpe run *metadata* in ~/.local/state/cpe/runs
  (no code/git loss; all branches intact). User accepted the loss. Lesson saved to memory.

### Phase 06
- Status: complete
- Started: 2026-06-03 / Completed: 2026-06-03
- Notes: New src/runner/output-tail.ts — generic, harness-agnostic poll-based line tail over a run's
  log/stdout; emits a new `output` ActivityEvent per appended line. It is the live-output source for
  opaque harnesses AND the activity signal the Phase 04 timeout consumes (bench dispatch subscribes to
  the bus and treats each event as activity), so no second reader. single-prompt.ts bench path now
  selects the tail by adapter.completionMode: structured→jsonl-tail (claude, unchanged), opaque→
  output-tail. New src/tui/Bench.tsx + src/tui/hooks/useBenchState.ts (testable deriveBenchState):
  matrix of clone runs (running→pending→finished, with glyph/colour from the state table + counts),
  a NOW line (current harness__model + elapsed + last-output age, age→yellow when quiet >10s, 1s clock
  so it never looks frozen), and a BOUNDED live pane (height clamped to MAX_LIVE_ROWS=14, matrix to 12,
  overflow hidden — one chatty harness can't blow up the layout). Manual bail: `b` in the bench view →
  confirm → requestBail(runId) → Phase 04 guard.bail() → process-tree kill → recorded 'bailed' → capture
  still runs → matrix continues after the pause (bailing one run never aborts the matrix). App.tsx: `v`
  now cycles watch→manage→bench→watch (first press still watch→manage, so the claude flow is unchanged);
  Header gained a BENCH mode (cyan). ActivityFeed renders the new `output` kind (`·`). Verified: build/
  typecheck/lint clean (0 errors), 63 tests pass (8 new: output-tail line/partial/stop-flush/late-file;
  deriveBenchState filter/order+counts/slugify/empty). Bail plumbing (requestBail→guard→abort→'bailed'+
  capture) already covered by run-guard.test.ts and validated end-to-end in Phase 04. The live Ink
  render + keybind interaction needs a real TTY (raw mode) and is the in-terminal manual acceptance step;
  no headless mode was built (explicitly out of scope).

### Phase 07
- Status: not-started
- Started: - / Completed: -
- Notes: First non-claude adapter; opaque completion mode expected. Validates the contract end-to-end.

### Phases 08-15
- One adapter per phase (aider, goose, openhands, plandex, pi, crush, codex-cli, swe-agent), each a
  commit on `feature/harness-bench`. See ADAPTER_BACKLOG.md.
