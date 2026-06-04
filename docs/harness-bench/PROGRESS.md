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
| 07 | opencode adapter (canonical template) | complete | 05 |
| 08 | aider adapter | complete | 07 |
| 09 | goose adapter | complete | 07 |
| 10 | openhands adapter | complete | 07 |
| 11 | plandex adapter + orchestrator write-up | complete (live validation deferred — server parked) | 07 |
| 12 | pi adapter | complete | 07 |
| 13 | crush adapter | complete | 07 |
| 14 | codex-cli adapter | complete | 07 |
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
- Status: complete
- Started: 2026-06-03 / Completed: 2026-06-03
- Notes: First non-claude adapter. **completionMode = opaque** (confirmed empirically): `opencode run
  --format json` streams newline-delimited event objects (step_start/tool_use/step_finish/text), not a
  single parseable result envelope; outcome derived from exit code + git diff (exit0+diff→completed,
  exit0+no-diff→no-op, non-zero→error). opencode v1.15.13. New src/harness/opencode.ts (registered in
  registry.ts): builds `opencode run --dir <cwd> --model <provider>/<model> --format json
  --dangerously-skip-permissions <prompt>`; spawns with ANTHROPIC_* stripped from env; translates cpe's
  provider env (ANTHROPIC_BASE_URL) into a temp opencode config (`@ai-sdk/openai-compatible` provider
  `cpe-local` at <base>/v1) referenced via OPENCODE_CONFIG so it never lands in the clone's diff; parses
  step_finish tokens/cost best-effort. Honors ctx.signal (process-group kill) like session.ts.
  **Two bugs found + fixed during validation:** (1) the bench dispatch wrapped the prompt in the
  claude-specific SINGLE_PROMPT_TEMPLATE for ALL harnesses — now gated on completionMode (opaque gets the
  raw prompt). (2) **isolation breach**: opencode does NOT use the spawn cwd as its project root — for a
  clone whose git `origin` is the local source repo it followed origin and edited the ORIGINAL working
  tree; fixed by passing `--dir <clone>` explicitly (verified via opencode's own startup logs:
  `service=project directory=<clone> fromDirectory`). Also: 'no-op' run_outcome now maps to status
  'complete' (not 'failed') — it's a clean non-error result; the distinction stays in run_outcome + the
  summary OUTCOME column. Validated end-to-end on gemma4-cpe:31b via the real runSinglePrompt bench path:
  run_outcome=completed, results/opencode__gemma4-cpe-31b/{meta.json,diff,transcript} written, diff
  (CHANGELOG.md | 4 ++++) matches opencode's actual change IN THE CLONE (real repo untouched), tokens
  parsed (36464 in / 253 out), harnesstests/opencode__gemma4-cpe-31b pushed to origin. 69 tests pass
  (4 new opencode tests: registration/opaque, base-url mapping, outcome rules, usage parsing), lint/build
  clean. Test artifacts cleaned up afterward (by exact id/name).

### Phase 08
- Status: complete
- Started: 2026-06-03 / Completed: 2026-06-03
- Notes: aider adapter (aider 0.86.2). **completionMode = opaque** (confirmed empirically): `aider
  --message` prints human-readable progress and AUTO-COMMITS; there is no machine-readable result
  envelope. Outcome from exit + change: exit0+change→completed, exit0+no-change→no-op, nonzero→error.
  New src/harness/aider.ts (registered in registry.ts): `aider --model openai/<model> --edit-format
  <fmt> --message <prompt> --yes-always --no-gitignore --no-pretty --no-fancy-input
  --no-check-update --no-analytics --no-show-model-warnings`. **Streaming left ON** (no --no-stream) so
  aider writes the response incrementally — the bench output tail (startOutputTail) surfaces it line-by-
  line to the live TUI and feeds the activity timeout; `--no-pretty` keeps the stream clean/tailable.
  (Verified: response lines arrive with progressing timestamps, not one final burst; a silent prefill
  gap before the first token is inherent to the model.) **Model wiring:** OpenAI-compatible via
  LiteLLM — `openai/<model>` with OPENAI_API_BASE=<base>/v1 + OPENAI_API_KEY (Ollama ignores it but
  LiteLLM requires one), translated from cpe's provider env; ANTHROPIC_* stripped so aider can't inherit
  cpe creds. **Edit format** (`whole|diff|udiff`) is exposed via CPE_AIDER_EDIT_FORMAT (default `whole`)
  since the Harness contract has no per-harness option slot.
  **Auto-commit reconciliation:** aider's commits are the source of truth — Phase-04 capture diffs the
  index against the clone's base ref, so committed changes are captured with no double-commit; the
  adapter's change-detection is "HEAD advanced since entry OR dirty tree" (not `git status` alone, which
  is clean right after an auto-commit).
  **Bug found + fixed during validation:** letting aider manage `.gitignore` (its default `.aider*`
  housekeeping) auto-commits a `.gitignore` line that (a) pollutes every diff and (b) FALSELY reports
  'completed' even when the real edit fails (the housekeeping commit moves HEAD). Fixed by keeping
  `.aider*` out of capture via the clone's `.git/info/exclude` (local-only, never committed, honoured by
  `git add -A`) + `--no-gitignore`; now HEAD only advances on a genuine task commit, so completed/no-op
  is honest. Verified: a no-op run captures an empty diff (was a spurious `.gitignore | 1 +`).
  **Validation (synthetic, per the new scope — see below):** a single fast-model run confirms wiring,
  not the full matrix. Validated end-to-end on **gemma4-cpe:31b**: a bounded create-file task →
  run_outcome=completed, aider auto-committed (UPDATING.md), results/aider__gemma4-cpe-31b/{meta.json,
  diff,transcript} written, captured diff matches the commit exactly, tokens parsed (2000 in / 131 out),
  harnesstests/aider__gemma4-cpe-31b pushed to origin, real repo untouched (clone isolation held). 88
  tests pass (incl. new aider tests: registration/opaque, openAiBaseFrom, deriveAiderOutcome, edit-format
  env, usage parsing, .git/info/exclude idempotency), lint/build clean. Test artifacts (results, clones,
  run dirs, remote branch, scratch dir, driver) cleaned up afterward by exact id/name.
  **Scope note:** per-adapter validation is now a lightweight single-fast-model wiring check; the full
  harness×model comparison runs once, after all adapters (08–15) exist. The dense 24b
  (`devstral-small-2-cpe:24b`) is pathologically slow on this endpoint (no 16-token reply in 90s) — the
  **MoE** gemma4 models are the fast ones; whole-file rewrites of large files (e.g. the README) are
  expensive under `--no-stream`, so synthetic checks use small bounded tasks.
  **26b edit-strategy hypothesis (whole-file rescuing the fast MoE):** NOT settled here. gemma4-cpe:26b
  under aider `whole` mode did not land a valid edit in two attempts — it emitted a unified-diff block
  (ignoring the whole-file convention) and then `--yes-always` auto-added every file it name-dropped,
  spiralling into aider's 3-reflection "which files do you need?" loop (ending in a clean no-op after the
  isolation fix). This isn't apples-to-apples (26b ran the heavy README task; 31b ran a light create-file
  task), so the real whole-vs-diff / 26b-vs-31b verdict is deferred to the full matrix on a common task.

### Phase 09
- Status: complete
- Started: 2026-06-03 / Completed: 2026-06-04
- Notes: goose (Block) adapter (goose 1.37.0). **completionMode = opaque** (confirmed empirically):
  `goose run` prints human progress + tool-call traces, no result envelope; outcome from exit + git
  diff (exit0+changes→completed, exit0+no-diff→no-op, nonzero→error). goose does NOT auto-commit — it
  edits the working tree — so change-detection is `git status --porcelain` (like opencode), and Phase-04
  capture diffs the staged tree vs base ref as usual. New src/harness/goose.ts (registered in
  registry.ts): `goose run --no-session --max-turns <n> -t <prompt>` in ctx.cwd. File editing works out
  of the box via goose's built-in developer tools (write/edit/shell/todo_write) — **no MCP extension
  config needed**. `--max-turns` is a loop backstop (env CPE_GOOSE_MAX_TURNS, default 50).
  **Provider/model + isolation:** goose is config-driven (global `$XDG_CONFIG_HOME/goose/config.yaml`)
  and persists sessions/logs under XDG_DATA/STATE — the global-config hazard the phase warned about. We
  avoid touching the user's real config by pointing ALL FOUR XDG base dirs (CONFIG/DATA/STATE/CACHE) at a
  per-run temp dir and selecting the model purely via env: GOOSE_PROVIDER=ollama, GOOSE_MODEL=<model>,
  OLLAMA_HOST=<provider base url> (cpe's ANTHROPIC_BASE_URL maps straight to it; goose prepends http://
  if absent). ANTHROPIC_* stripped from the spawn env. Verified `goose info` honours XDG_CONFIG_HOME and
  that a run wrote only to the temp dirs — the real ~/.config/goose/config.yaml mtime was unchanged
  (it's the user's own install-time `goose configure` output, not ours). Temp dir removed after the run,
  so no goose state lands in the captured diff. **Tokens** parsed best-effort from goose's per-request
  logs ($XDG_STATE_HOME/goose/logs/llm_request.*.jsonl), each carrying a `usage` object — summed across
  requests; cost not reported for a local model (omitted).
  **Validation (synthetic, single fast model per the scope decision):** validated end-to-end on
  gemma4-cpe:31b via the bench path with a bounded create-file task → run_outcome=completed, aider-style
  capture wrote results/goose__gemma4-cpe-31b/{meta.json,diff,transcript}, diff (UPDATING.md | 3 +++)
  matches goose's change, tokens parsed (15166 in / 529 out), harnesstests/goose__gemma4-cpe-31b pushed,
  real repo + real goose config untouched (isolation held). Output streams live (the bench output tail
  surfaced goose's progress). 94 tests pass (6 new goose tests: registration/opaque, ollamaHostFrom,
  deriveGooseOutcome, max-turns env, usage parsing across logs, empty-logs), lint/build clean. Test
  artifacts (results, clone, run dir, remote branch, scratch + XDG temp dirs, driver) cleaned up by exact
  id/name afterward.

### Phase 10
- Status: complete
- Started: 2026-06-04 / Completed: 2026-06-04
- Notes: openhands (All-Hands) adapter (OpenHands SDK CLI v1.16.1 / `openhands` 1.14.0). Pre-flight
  checked the CLI **and** Docker (29.5.2, daemon reachable) — but Docker turned out to be unnecessary.
  **completionMode = opaque.** New src/harness/openhands.ts (registered in registry.ts):
  `openhands --headless --json --override-with-envs --exit-without-confirmation -t <prompt>` in ctx.cwd.
  **Runtime/workspace (the phase's biggest risk):** despite the "sandboxed Docker runtime" expectation,
  the SDK v1 CLI uses a **LOCAL runtime** — it runs its bash/file tools directly in the process CWD.
  Verified empirically: no Docker image/container was created and the agent's edits landed in the spawn
  cwd (untracked, NOT auto-committed). So the adapter just spawns in ctx.cwd (the clone) — no mount or
  workspace config needed; change-detection is `git status --porcelain` like opencode/goose, and capture
  diffs the staged tree vs base ref.
  **LLM wiring:** `--override-with-envs` takes LLM settings from env — LLM_MODEL=ollama/<model>,
  LLM_BASE_URL=<ollama root> (cpe's ANTHROPIC_BASE_URL), LLM_API_KEY=<token or 'ollama'> (Ollama ignores
  it but LiteLLM needs one). OPENHANDS_SUPPRESS_BANNER=1 silences the banner. ANTHROPIC_* stripped.
  **Isolation:** openhands persists conversations/cache/profiles under ~/.openhands (no env to relocate
  it, but it keys off HOME), and writes NOTHING into the cwd — so the captured diff is already clean. To
  also keep the user's home clean we point HOME at a per-run temp dir (verified: a run left the real
  ~/.openhands with no new conversation) and remove it after. **Tokens** parsed best-effort from the
  persisted conversation's base_state.json (stats.usage_to_metrics.<component>.accumulated_token_usage,
  summed across agent/condenser); cost is 0 for a local model (omitted). The `--json` JSONL event stream
  is captured to the transcript as a bonus (not depended on for outcome).
  **Validation (synthetic, single fast model):** end-to-end on gemma4-cpe:31b via the bench path with a
  bounded create-file task → run_outcome=completed, results/openhands__gemma4-cpe-31b/{meta.json,diff,
  transcript} written, diff (UPDATING.md | 3 +++) matches openhands' change, tokens parsed (48606 in /
  248 out), harnesstests/openhands__gemma4-cpe-31b pushed, real repo + real ~/.openhands both untouched
  (isolation held). 100 tests pass (6 new openhands tests: registration/opaque, model-arg prefix,
  baseUrlFrom, deriveOpenhandsOutcome, base_state usage parse across components, empty-state), lint/build
  clean. Test artifacts (results, clone, run dir, remote branch, scratch dirs, temp HOME, the one real-
  home conversation from an early non-isolated probe, driver) cleaned up by exact id/name afterward.

### Phase 11
- Status: complete (adapter + orchestrator notes + tests) — **live validation DEFERRED (server parked)**
- Started: 2026-06-04 / Completed: 2026-06-04
- Notes: plandex adapter + orchestrator write-up. plandex CLI v2.2.1 installed manually from the GitHub
  release tarball (docs.plandex.ai was down). **completionMode = opaque** (applies changes to the working
  tree; outcome from exit + git diff). New src/harness/plandex.ts (registered): runs `plandex new
  --no-auto` then `plandex tell <prompt> --apply --skip-commit --no-exec --skip-menu --stop` in ctx.cwd;
  ANTHROPIC_* stripped; `stdin: null` so a missing server fails fast instead of hanging; outcome from
  `git status` (plandex applies uncommitted, like opencode/goose). Tokens omitted (server-side only).
  **Key finding — plandex is client/server and the SERVER is the engine:** the CLI is a thin front-end;
  the server holds model providers/endpoints, runs the agent loop, stores plan state, and does token/cost
  accounting. Verified offline: with no server/account even `plandex new` blocks on an interactive
  Cloud-auth prompt and errors (EOF). Consequences: (a) a reachable, AUTHENTICATED server is required for
  any run; (b) the local model/endpoint (cpe's ANTHROPIC_BASE_URL → Ollama) is configured SERVER-SIDE,
  not passed by the client — a genuine mismatch with cpe's per-run provider model (every other adapter
  wires the provider env directly).
  **Server PARKED by user decision** ("may come in use later if plandex proves a good harness"), so the
  end-to-end bench run is DEFERRED. What IS done and green: CLI installed, adapter implemented from the
  documented client interface + registered, 5 unit tests (registration/opaque, plan-name slug, new/tell
  arg builders, outcome rules), and the bonus deliverable docs/harness-bench/orchestrator-notes.md (verdict:
  keep plandex as just-another-adapter, low priority; do NOT adopt its server as cpe's orchestration
  substrate — evolve cpe's own bench pipeline instead). 105 tests pass, lint/build clean. **When a server
  is stood up (with the local model configured), validate like the others:** `cpe bench "<task>" --harness
  plandex --model <model>` and confirm the captured diff matches what plandex applied.

### Phase 12
- Status: complete
- Started: 2026-06-04 / Completed: 2026-06-04
- Notes: pi (pi.dev / @earendil-works/pi-coding-agent) adapter, **the easiest extra so far** as predicted.
  pi CLI v0.78.0 (confirmed official binary name + install source https://pi.dev/; pre-flight gates on
  `which pi`). **completionMode = opaque** (confirmed empirically): pi prints assistant text / JSONL
  events, no single result envelope, and does NOT auto-commit — it edits the working tree directly
  (a created file shows as `?? <file>`). Outcome from exit + git diff (exit0+changes→completed,
  exit0+no-diff→no-op, nonzero→error); change-detection is `git status --porcelain` like opencode/goose.
  New src/harness/pi.ts (registered): `pi -p --provider ollama --model <model> --mode json --no-session
  -t read,write,edit,bash,grep,find,ls <prompt>` in ctx.cwd. **Tool allowlist is explicit** — an early
  scratch run with neither `-t` nor the right flags produced empty output + no edit; allowlisting pi's
  full built-in tool set made runs deterministic.
  **Provider/model + ISOLATION:** pi is config-driven — custom providers (Ollama/vLLM/LM Studio) live in
  `$PI_CODING_AGENT_DIR/models.json` (default ~/.pi/agent). We point PI_CODING_AGENT_DIR (+ SESSION_DIR)
  at a per-run temp dir and materialise a models.json there declaring an `ollama` provider:
  baseUrl=<ANTHROPIC_BASE_URL>/v1, api=openai-completions, apiKey=<token|"ollama">,
  compat={supportsDeveloperRole:false, supportsReasoningEffort:false} (recommended for OpenAI-compatible
  servers), models=[{id:<model>}]. cpe's ANTHROPIC_BASE_URL maps straight to the provider baseUrl;
  ANTHROPIC_* stripped from the spawn env; temp dir removed after. Verified the real ~/.pi was untouched
  (all mtimes predate the runs; sessions/ empty under --no-session). **Tokens** parsed best-effort from
  the `--mode json` stream: each assistant message repeats its `usage` ({input,output,cacheRead,
  cacheWrite,totalTokens,cost}) across update/end/turn_end/agent_end events tagged with a `responseId`,
  so we dedupe by responseId then sum; cost omitted (0 for a local model).
  **Validation (synthetic, single fast model per the scope decision):** end-to-end on gemma4-cpe:31b via
  the bench path with a bounded create-file task → run_outcome=completed, results/pi__gemma4-cpe-31b/
  {meta.json,diff,transcript} written, diff (UPDATING.md | 3 +++) matches pi's change, tokens parsed
  (16574 in / 737 out), harnesstests/pi__gemma4-cpe-31b pushed to origin, real repo + real ~/.pi both
  untouched (isolation held). Output streams live (the bench output tail surfaced pi's JSONL deltas). 113
  tests pass (8 new pi tests: registration/opaque, openAiBaseFrom, derivePiOutcome, piRunArgs,
  buildModelsJson, parsePiUsage dedupe-by-responseId + cost-gating + empty), lint/build clean. Test
  artifacts (results, run dir, remote branch, scratch + temp agent dirs, driver) cleaned up by exact
  id/name afterward.

### Phase 13
- Status: complete
- Started: 2026-06-04 / Completed: 2026-06-04
- Notes: crush (Charmbracelet / @charmland/crush) adapter, crush v0.75.0. **Headless mode: YES** (the
  decisive step-1 check) — despite being a Bubble Tea TUI, crush ships `crush run "<prompt>"` which runs
  one prompt non-interactively and exits (verified: edited a file, printed "Done"). So the adapter is a
  normal opaque harness, NOT parked. **completionMode = opaque** (confirmed empirically): crush prints
  human progress / "Done" under --quiet, no result envelope, and does NOT auto-commit — it edits the
  working tree (created file shows as `?? <file>`). Outcome from exit + git diff (exit0+changes→completed,
  exit0+no-diff→no-op, nonzero→error); change-detection is `git status --porcelain` like opencode/goose/
  pi. New src/harness/crush.ts (registered): `crush --data-dir <dd> --cwd <clone> run --quiet -m
  ollama/<model> <prompt>`.
  **Gotchas found + fixed during scratch testing:** (1) `--yolo` (auto-accept permissions) is a ROOT-only,
  non-persistent flag — `crush run` rejects it ("Unknown flag: --yolo"). Headless permission
  auto-approval is instead config-driven via `permissions.allowed_tools`, which we set to crush's full
  built-in tool set (view/ls/grep/glob/edit/multiedit/write/bash/fetch/download/sourcegraph/agent), else
  the agent blocks on a permission prompt and makes no edit. (2) `CRUSH_GLOBAL_CONFIG` is a DIRECTORY
  containing crush.json, not a file path (crush appends `/crush.json`).
  **Provider/model + ISOLATION:** crush is config-driven. We point CRUSH_GLOBAL_CONFIG + CRUSH_GLOBAL_DATA
  + --data-dir at a per-run temp dir and materialise a crush.json there declaring an `ollama` provider
  (type=openai-compat, base_url=<ANTHROPIC_BASE_URL>/v1/, api_key="ollama", one model entry); cpe's
  ANTHROPIC_BASE_URL maps to base_url. --data-dir is REQUIRED for isolation: by default crush writes a
  `.crush/` dir (crush.db + logs) into the project cwd, which would pollute the captured clone diff —
  relocating it keeps the diff clean (verified: scratch dir held only the created file + .git). Also set
  CRUSH_DISABLE_PROVIDER_AUTO_UPDATE=1 (no startup provider-list fetch); ANTHROPIC_* stripped; temp dir
  removed after. Verified the user's ~/.config/crush was never created. **Tokens** read from crush's own
  SQLite store (<data-dir>/crush.db `sessions` table: prompt_tokens/completion_tokens/cost) via bun:sqlite,
  summed across sessions; cost omitted (0 for a local model). NOTE: crush's completion_tokens count came
  back low (6) — it appears to track only the final assistant text turn, not tool-call turns; we report
  what crush stores.
  **Validation (synthetic, single fast model per the scope decision):** end-to-end on gemma4-cpe:31b via
  the bench path with a bounded create-file task → run_outcome=completed, results/crush__gemma4-cpe-31b/
  {meta.json,diff,transcript} written, diff (UPDATING.md | 6 ++++++) matches crush's change, tokens read
  from crush.db (13924 in / 6 out), harnesstests/crush__gemma4-cpe-31b pushed to origin, real repo +
  ~/.config/crush both untouched (isolation held). 120 tests pass (7 new crush tests: registration/opaque,
  crushBaseUrl, deriveCrushOutcome, crushRunArgs, buildCrushConfig + allowed_tools, parseCrushUsage sum
  from a fixture sqlite + missing/zero-db cases), lint/build clean. Test artifacts (results, run dir,
  remote branch, scratch + temp dirs, driver) cleaned up by exact id/name afterward.

### Phase 14
- Status: complete
- Started: 2026-06-04 / Completed: 2026-06-04
- Notes: codex-cli (OpenAI) adapter, `codex-cli 0.137.0`. **completionMode = opaque** (confirmed
  empirically): `codex exec` prints human / `--json` JSONL progress, no single result envelope, and does
  NOT auto-commit — it edits the working tree directly (a created file shows as `?? <file>`). Outcome from
  exit + git diff (exit0+changes→completed, exit0+no-diff→no-op, nonzero→error); change-detection is
  `git status --porcelain` like opencode/goose/pi/crush. New src/harness/codex.ts (registered): `codex
  exec --json --cd <clone> --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -m <model>
  <prompt>`. The `--dangerously-bypass-…` flag is the documented automation path for an externally
  sandboxed env (the bench already runs in a throwaway clone) and sidesteps WSL landlock while ensuring
  edits land in the clone for capture. **stdin=null** so codex uses the arg prompt and doesn't block
  reading piped stdin.
  **LOCAL-MODEL wiring — the phase's key risk — NO proxy needed:** codex 0.137.0 **removed
  `wire_api = "chat"`** (custom providers must now use `wire_api = "responses"`, the OpenAI Responses
  API). Verified our Ollama (192.168.1.3:11434) serves the Responses API natively — a POST to
  `/v1/responses` returns a proper `resp_…` object — so we declare a custom `model_provider` with
  `wire_api = "responses"` and `base_url = <ANTHROPIC_BASE_URL>/v1` and point codex straight at Ollama
  (the Phase-03 proxy is unnecessary). cpe's ANTHROPIC_BASE_URL maps to the provider base_url; Ollama
  needs no API key (verified working with no auth), but if cpe's provider env carries a token we add an
  `env_key` so authed OpenAI-compatible endpoints work too.
  **ISOLATION (airtight, verified):** codex is config-driven via `$CODEX_HOME/config.toml`. We point
  CODEX_HOME at a per-run temp dir and materialise config.toml there; `--cd <clone>` pins the working
  root. Controlled probe confirmed CODEX_HOME relocates **all** codex state — config, sessions, auth, and
  its global goals/memories/logs/state sqlite stores + skills/ all land under the temp CODEX_HOME and the
  real ~/.codex mtime was UNCHANGED. (Caveat for future work: a BARE `codex` invocation with no CODEX_HOME
  — e.g. `codex --version` — DOES init ~/.codex; the pre-flight version/help checks created the user's
  ~/.codex, but every actual run is fully isolated.) ANTHROPIC_* stripped from the spawn env; temp dir
  removed after the run. codex writes nothing into the cwd except the task's own edits (verified: clone
  held only `?? <file>` + .git), so the captured diff stays clean. **Tokens** parsed best-effort from the
  `--json` stream's terminal `turn.completed` event(s) (usage:{input_tokens, cached_input_tokens,
  output_tokens, reasoning_output_tokens}), summed across turns (reasoning folds into output,
  cached_input→cache_read); cost omitted (0 for a local model).
  **Validation (synthetic, single fast model per the scope decision):** end-to-end on gemma4-cpe:31b via
  the bench path with a bounded create-file task → run_outcome=completed, results/codex__gemma4-cpe-31b/
  {meta.json,diff,transcript} written, diff (UPDATING.md | 17 ++…) matches codex's change (a homelab
  update guide with backups / pulling images / rolling back sections), tokens parsed from turn.completed
  (16179 in / 463 out), harnesstests/codex__gemma4-cpe-31b pushed to origin, real repo + real ~/.codex
  both untouched (isolation held). 128 tests pass (8 new codex tests: registration/opaque, codexBaseUrl,
  deriveCodexOutcome, codexExecArgs, buildCodexConfig + env_key gating, parseCodexUsage sum-across-turns +
  empty), lint/build clean. Test artifacts (results, run dir, remote branch, scratch + temp dirs, driver)
  cleaned up by exact id/name afterward. NOTE during scratch testing: in `--json` mode the model once
  spiralled into repeated command executions and hit the 240s scratch timeout on a trivial task — model
  variance, not an adapter bug (the validation run completed cleanly); the bench RunGuard owns timeouts.

### Phase 15
- One adapter (swe-agent), a commit on `feature/harness-bench`. See ADAPTER_BACKLOG.md.
