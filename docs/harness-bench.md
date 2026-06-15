# Harness Bench

**Completed:** 2026-06-05

---

## Original Requirements

Evolve cpe so every run carries a selectable **`{ provider, model, harness }`** triple, turning the
executor into pluggable infrastructure. A benchmark — running many harness×model combinations against
one task and capturing the results — then falls out of that parameterization as a thin layer on top.

Two pressures drove the work: Anthropic making `claude -p` usage much more expensive (which defeats
cpe's original economics), and local models becoming good enough (the homelab eval picked
`gemma4-cpe:31b` as a capable local coder). The immediate escape was to point cpe's existing provider
env (`ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`) at a local Ollama; the durable
win was letting cpe drive **other harnesses** that may get more out of a local model than claude-code.

**Locked decisions / constraints:**
- Built in the cpe repo (Bun/TypeScript); `default harness = claude-code` so existing behaviour is
  unchanged (a hard regression gate).
- **Isolation = a full git clone per run** (agent-git-safe), cloned from the CWD repo at its current
  branch — that CWD repo/branch is the baseline every run starts from; nothing hardcoded.
- The prompt is a runtime input, not hardcoded.
- Results: push `harnesstests/<harness>__<model>` branches **and** save
  `results/<harness>__<model>/{diff,transcript,meta.json}` + a summary table. Quality scoring stays
  **manual**.
- Safety: strictly sequential, an **activity-based timeout** (kill only after a window of no *new*
  output), a **manual bail**, and a configurable inter-run pause.

**Out of scope:** automated quality scoring; a headless no-TTY mode (deferred to a later plan); and
actually deploying an orchestrator/server (only evaluated in the plandex phase).

---

## Work Done

The plan split into a **core platform** (Phases 01–06), a **canonical adapter template** (Phase 07,
opencode), and a **one-adapter-per-phase** set (08–15). All landed as one commit per phase on
`feature/harness-bench`.

### Phase 01 — Run parameterization + Harness contract & registry
Added the `Harness` contract (`src/harness/types.ts`: `name`, `completionMode`, `run(ctx)`), the
registry, and a claude-code adapter. Persisted `{harness, model, provider}` on `RunMeta` via
`--harness/--model/--provider`. No runtime dispatch change yet.

### Phase 02 — Executor dispatch refactor
`single-prompt.ts` and `phase-loop.ts` stopped hardcoding claude and now resolve the adapter via
`registry.get(meta.harness ?? … ?? 'claude-code')` and dispatch through `adapter.run()`. The
claude-code adapter forwards byte-for-byte identical args to `runSession`, so default runs are
unchanged (regression gate passed). `finalise.ts` gates summarisation to structured adapters (opaque →
skip).

### Phase 03 — Local-model provider (no proxy needed)
The phase's premise (a translation proxy is required) turned out to be **obsolete**: modern Ollama
natively serves the Anthropic `/v1/messages` API including tool use, so cpe points `ANTHROPIC_BASE_URL`
straight at Ollama. Delivered the `desktop-ollama` provider preset. LiteLLM survives only as an
optional appendix for non-Anthropic-native backends.

### Phase 04 — Clone isolation + capture + timeout + pause
New `src/git/clone.ts` (full clone per run), `src/runner/proc-tree.ts` (setsid process-group +
`killTree`), `src/runner/run-guard.ts` (activity timeout with repeat-suppression + bail registry),
`src/runner/capture.ts` (diff/transcript/meta → `results/`, optional `harnesstests/*` push). Bench
runs take a distinct path; default worktree runs are untouched. Verified isolation holds (a clone run
edited only the clone) and process-tree kill leaves zero orphans.

### Phase 05 — Matrix / bench command + summary table
`cpe bench "<prompt>" --harness a,b --model x,y` enqueues the harness×model cross-product as
clone-isolated single-prompt runs (skips combos with existing results unless `--force`). `cpe bench
summary` tabulates `results/*/meta.json`, tolerating partial/unreadable rows.

### Phase 06 — Bounded live TUI + manual bail
New `src/runner/output-tail.ts` (generic line tail that is *both* the opaque live-output source and the
activity signal the timeout consumes). New bench TUI (`Bench.tsx`) with a matrix, a NOW line, and a
**bounded** live pane so one chatty harness can't blow up the layout. Manual bail (`b`) →
`guard.bail()` → process-tree kill → still captures. The live render needs a real TTY (the manual
acceptance step); no headless mode (out of scope).

### Phase 07 — opencode adapter (canonical template)
First non-claude adapter, established the **opaque** pattern: outcome derived from exit code + git diff
(exit0+diff→completed, exit0+no-diff→no-op, nonzero→error). Two bugs fixed that shaped every later
adapter: (1) the prompt was being wrapped in the claude-specific template for *all* harnesses — now
gated on `completionMode` (opaque gets the raw prompt); (2) an **isolation breach** — opencode followed
the clone's `origin` back to the real repo, fixed by passing `--dir <clone>` explicitly. Also: `no-op`
maps to status `complete`, not `failed`.

### Phase 08 — aider adapter
Opaque; aider **auto-commits**, so change-detection is "HEAD advanced or dirty tree" and capture uses
its commits. Local model via LiteLLM (`openai/<model>` + `OPENAI_API_BASE`). Edit format exposed via
`CPE_AIDER_EDIT_FORMAT` (default `whole`). Key fix: aider's `.gitignore` housekeeping was polluting
diffs and *falsely* reporting completed — solved with `.git/info/exclude` + `--no-gitignore`.

### Phase 09 — goose (Block) adapter
Opaque; goose edits the working tree (no auto-commit), file editing works via its built-in developer
tools (no MCP config needed). Isolation: point **all four** XDG base dirs at a per-run temp dir; model
via `GOOSE_PROVIDER=ollama`/`GOOSE_MODEL`/`OLLAMA_HOST`. Tokens parsed from goose's per-request logs.

### Phase 10 — openhands (All-Hands) adapter
Opaque. The expected Docker sandbox turned out **unnecessary** — the SDK v1 CLI uses a local runtime
that edits the spawn cwd directly. LLM via `--override-with-envs` (`LLM_MODEL=ollama/<model>`, etc.).
Isolation by pointing `HOME` at a temp dir (openhands keys its `~/.openhands` state off HOME); tokens
from the persisted `base_state.json`.

### Phase 11 — plandex adapter + orchestrator write-up
Opaque adapter implemented and registered, but **live validation deferred (server parked)**. Key
finding: plandex is client/server and the **server is the engine** — model providers, the agent loop,
and accounting all live server-side and require an authenticated server, so its model wiring can't use
cpe's per-run provider abstraction. The bonus `orchestrator-notes.md` concluded: keep plandex as just
another adapter; do **not** adopt its server as cpe's orchestration substrate — evolve cpe's own bench
pipeline (queue processor → server, TUI → thin client over the `ActivityBus`) instead.

### Phase 12 — pi (pi.dev) adapter
Opaque; the easiest extra as predicted. `pi -p --provider ollama --model <model> --mode json
--no-session -t <tools>`. The explicit tool allowlist was required (an empty `-t` produced no edits).
Config-driven provider via a temp `PI_CODING_AGENT_DIR/models.json`. Tokens deduped by `responseId`
from the JSON stream.

### Phase 13 — crush (Charmbracelet) adapter
The decisive step-1 check (does a headless mode exist?) passed: `crush run` exists, so it's a normal
opaque adapter, not parked. Gotchas: `--yolo` is root-only (rejected by `run`) — headless
auto-approval is config-driven via `permissions.allowed_tools`; and `CRUSH_GLOBAL_CONFIG` is a
*directory*. Isolation via `--data-dir` + `CRUSH_GLOBAL_CONFIG`/`DATA`; tokens read from crush's own
`crush.db` (bun:sqlite).

### Phase 14 — codex-cli (OpenAI) adapter
Opaque; `codex exec --json`. The key local-model finding: codex 0.137.0 **removed
`wire_api = "chat"`** — custom providers must use `wire_api = "responses"` (the OpenAI Responses API),
which our Ollama serves natively, so **no proxy was needed**. Isolation is airtight via a temp
`CODEX_HOME` (verified: relocates all state, real `~/.codex` untouched). `stdin=null` is essential or
codex blocks reading piped stdin. Tokens from the `turn.completed` usage event.

### Phase 15 — mini-swe-agent adapter (supersedes swe-agent)
**Scope change (user decision):** the original Princeton swe-agent has been superseded by
**mini-swe-agent**, so this phase built that (registered `mini-swe-agent`). Opaque; LiteLLM/Ollama.
Gotchas: force `--agent-class default` (the interactive default raises EOFError on closed stdin); any
`-c` drops the builtin config so re-add `-c mini.yaml`; add `step_limit`/`wall_time_limit_seconds`
backstops (a model that never submits loops forever); `MSWEA_COST_TRACKING=ignore_errors` for the
local-model cost-map gap. Isolation via `MSWEA_GLOBAL_CONFIG_DIR`. The `default` agent emits no
inter-turn stdout, so a slow run *looks* stuck but isn't. This completed adapter phases 08–15.

---

## Lessons Learned

- **Determine `completionMode` empirically, per harness.** Every non-claude harness in the matrix
  turned out **opaque** (no parseable result envelope) — outcome is derived from exit code + git diff.
  The one structured adapter is claude-code. Don't assume; the Phase-07 template's "directly test it
  first" step exists for this reason.
- **Clone isolation is necessary but not sufficient — watch what each tool keys off.** opencode
  followed the clone's git `origin` back to the *real* repo until pinned with `--dir`. The standing
  rule: always pass the clone path explicitly, and verify (via the tool's own logs / a probe) that
  edits land in the clone and nothing else does.
- **Keep each harness's global state out of the captured diff and off the user's machine.** Every tool
  has a global config/state home, and each exposes a different knob to relocate it: goose → all four
  XDG dirs; openhands → `HOME`; crush → `CRUSH_GLOBAL_CONFIG`/`DATA` + `--data-dir`; pi →
  `PI_CODING_AGENT_DIR`; codex → `CODEX_HOME`; mini → `MSWEA_GLOBAL_CONFIG_DIR`. Point it at a per-run
  temp dir and delete it after. Note the codex caveat: a *bare* `codex --version` (no `CODEX_HOME`)
  still inits `~/.codex` — only invocations with the env set are isolated.
- **Strip `ANTHROPIC_*` from the spawn env for every non-claude harness** so it can't inherit cpe's own
  credentials; give it only the provider/base-URL env it actually needs.
- **Local-model wiring is per-harness and full of small traps:** modern Ollama serves the Anthropic API
  natively (no proxy for claude-code); codex needs the OpenAI **Responses** API (`wire_api="responses"`,
  also served natively); aider/openhands/mini go through **LiteLLM** (`openai/` or `ollama/` model
  strings + `OPENAI_API_BASE`/`OLLAMA_API_BASE`); and LiteLLM raises "Cost must be > 0.0" for
  unregistered local models (mini needs `MSWEA_COST_TRACKING=ignore_errors`).
- **Headless tools love to block on stdin or a confirmation prompt.** Recurring fixes: `stdin=null`
  (codex, all spawns), explicit auto-approve (`--dangerously-*`, `permissions.allowed_tools`,
  `-y/--yolo`), non-interactive agent/exit modes (mini's `--agent-class default --exit-immediately`),
  and a step/wall-time **backstop** for agents that loop without ever submitting.
- **Quiet ≠ hung.** Some agents (mini's DefaultAgent) print nothing between turns, and slow local-model
  prefill makes a run look frozen for minutes. With the activity timeout disabled in this config, that's
  fine — but it's worth knowing before reaching for a kill.
- **Validation scope was deliberately staged:** each adapter phase got a *single fast-model wiring
  check* (one bounded create-file task on `gemma4-cpe:31b`), not the full matrix. The real
  harness×model comparison is a separate run now that all adapters exist. Slow/dense models
  (`devstral-small-2-cpe:24b`) are pathologically slow on this endpoint; the fast MoE `gemma4-cpe`
  models are the workhorses.
- **Test-artifact hygiene:** always clean up by **specific run id / branch name** (results, run dir,
  clone, remote `harnesstests/*` branch, scratch + temp dirs, the headless driver). A too-broad cleanup
  `rm` once wiped all cpe run metadata — never loop `rm` over shared state dirs.
- **plandex is the architectural outlier** (server-is-the-engine, can't use cpe's provider
  abstraction). Its live validation is parked until a server is stood up; for cpe's eventual
  orchestrator, evolve cpe's own pipeline rather than adopting plandex's server.
- **Status update (2026-06-10):** the full matrix run happened — three of them, archived with
  findings under `docs/logs/` (`2026-06-07-homelab-matrix`, `2026-06-10-litellm-synthetic`,
  `2026-06-10-vague-prompt`). Opaque harnesses now work in **normal (non-bench)** runs via the
  hybrid `PhaseReport` contract (`src/runner/report.ts`). Accurate per-run tokens come from the
  LiteLLM gateway integration (`docs/litellm-integration-spec.md`). Still parked: plandex live
  validation (needs a server).
