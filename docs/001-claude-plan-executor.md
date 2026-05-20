# Claude Plan Executor (`cpe`) — Implementation Summary

**Completed:** 2026-05-20

---

## Original Requirements

`cpe` is a CLI/TUI tool that automates the planbot → next-phase → summarise-plan workflow, queuing
work across multiple repos and running overnight with automatic rate-limit handling. The core loop:
plan a feature, queue it, execute phases sequentially in dedicated git worktrees, finalise with a
summarise step, push the branch, and open a PR — all driven headlessly with a live TUI for monitoring.

Key constraints: Linux/WSL primary, TypeScript/Bun runtime, single compiled binary (`bun build
--compile`), Ink for TUI, all prompts embedded in the binary so no external skill dependencies.
Rate-limit resilience was first-class — the tool must detect 429 responses, capture the session ID
for potential resume, parse the human-readable reset time, and sleep until the window reopens.

Non-goals: parallel execution, background daemon mode, cross-platform support beyond Ubuntu/WSL,
or replacing planbot's interactive planning intelligence.

---

## Work Done

### Phase 1 — Project Skeleton + Tooling

Bootstrapped the repo from scratch: `package.json`, `tsconfig.json` with `"jsx": "react-jsx"` and
`"moduleResolution": "bundler"` for Bun/Ink compatibility, flat-config ESLint (v9), `bunfig.toml`,
and the `bun build --compile` pipeline. One stub test, a working `./cpe --help`, and `./cpe --version`
were the acceptance bar.

### Phase 2 — Embedded Prompts

Authored and bundled the four embedded prompt/schema assets: `planbot.md` (adapted from the planbot
skill with single-branch, commit-per-phase, structured-output, and idempotency modifications),
`summarise.md`, `bootstrap-detect.md`, and `phase-result-schema.json`. A typed `src/prompts/index.ts`
loader makes them importable without path strings.

### Phase 3 — Types, State Taxonomy, Storage Layer

Defined the full shared type surface: `RunStatus` / `PhaseStatus` as string-literal unions (not
enums, for JSON round-trip safety), a `STATE_TABLE` mapping every status to glyph + Tokyo Night hex
color + label, and the `RunMeta` / `PhaseEntry` / `QueueEntry` / `AppConfig` interfaces. Three JSON
storage modules cover `~/.config/cpe/config.json`, `~/.local/state/cpe/queue.json`, and per-run
`meta.json`. Unit tests verify FIFO queue ordering and read/write round-trip using a temp directory.

### Phase 4 — Worktree Management + Per-Repo Config

Implemented git worktree lifecycle (create, rename, move, remove, list, reconcile) by shelling
out to `git`. Added `src/git/repo.ts` for primary repo detection, remote parsing (GitHub / Gitea /
other), HEAD capture. Introduced `cpe.config.json` per-repo bootstrap config with an interactive
first-time prompt (detect with Claude / stub / skip), an LLM-based bootstrap detector using
`claude -p --output-format=json --json-schema`, and the `cpe bootstrap` subcommand.

### Phase 5 — CLI Parsing + Non-TUI Commands

Wired all subcommands through `commander` in `src/cli.ts`. Implemented `cpe queue` (validates plan
folder, creates worktree, runs bootstrap, enumerates phases, writes meta.json, enqueues), `cpe list`
(tabular queue view), `cpe status` (one-liner for scripting), `cpe remove` (refuse if active run),
`cpe clean` (per-worktree confirmation for completed runs), and `cpe pause` / `cpe resume` (flag
on queue.json). `plan` and `start` were stubs at this stage.

### Phase 6 — Session Runner + Rate-Limit Handling

Built the `claude -p` invocation layer: `ClaudeEnvelope` TypeScript interface, `EnvelopeOutcome`
discriminated union, and `classifyEnvelope()` covering success / rate-limit / transient-error /
auth-error / phase-failure. `runSession()` validates that `--output-format=json` and `--json-schema`
are both present (throws otherwise), spawns the process, streams stderr to a log, captures stdout as
the JSON envelope. `parseResetTime()` parses human-readable reset strings ("4pm (Europe/London)") to
a future UTC Date using `Intl.DateTimeFormat` — no third-party date library. Unit tests cover all
five envelope outcomes and four reset-time parsing scenarios.

### Phase 7 — Live Observability + Event Bus

Implemented a typed pub/sub event bus (not Node EventEmitter) with a 200-event ring buffer.
`ActivityEvent` is a discriminated union of eight kinds: `phase`, `edit`, `bash`, `commit`, `ok`,
`pause`, `error`, `limit`. The `jsonl-tail.ts` module watches the pre-known session UUID jsonl path
under `~/.claude/projects/`, falls back to a glob if the computed path doesn't appear within 3
seconds, and converts tool-call entries to ActivityEvents in real time. The glob fallback handles
the encoding ambiguity for worktree paths (slashes-to-dashes encoding is implementation-specific).

### Phase 8 — Phase Execution Loop + VCS + Finalisation

Implemented `runPhase()` as the full per-phase lifecycle: limit check → state update → HEAD capture
→ pre-allocate session UUID → start jsonl tail → spawn session → classify envelope → cross-check
HEAD → mark complete. The HEAD cross-check catches Claude misreporting `committed: true` when HEAD
didn't change. Rate-limit recovery distinguishes restart (no prior work) from resume (`--resume
<session_id>` with a continuation prompt). Added VCS detection and `createGitHubPr` (via `gh`) /
`createGiteaPr` (via `tea` then REST fallback). `finaliseRun()` runs the headless summarise step,
commits, pushes, opens the PR, and marks the run `pr-created`.

### Phase 9 — `cpe plan` Flow + Queue Processor

Implemented `cpe plan`: interactive Claude session seeded with `planbot.md` in a fresh worktree,
post-exit scan for new `docs/*/PROGRESS.md`, branch rename + worktree move, offer to queue. The
queue processor (`cpe start`) is a continuous loop: dequeue → run all phases → finalise → repeat,
with rate-limit sleep-and-retry. Worktree reconciliation runs on first loop iteration. Extracted
`queuePlan()` as a shared helper callable from both `plan.ts` and the queue command path.

### Phase 10 — TUI Shell + Shared Primitives

Built the Ink application shell and all shared primitives: Tokyo Night color tokens in `theme.ts`,
`getStateStyle()` helper, `<StateChip>`, `<Spinner>` (ink-spinner `dots` preset), `<Sparkline>`
(eighth-block glyphs `▁▂▃▄▅▆▇█`), and `<Header>` with left/right layout and mode color coding.
`App.tsx` handles `useStdoutDimensions()`, mode toggle (`v`), quit confirmation, and event bus
subscription. Updated `start.ts` to render the Ink app alongside the async queue processor.

### Phase 11 — TUI Watch Mode

Implemented Watch mode with `<WatchHero>` (phase progress bar, stats right column, `<Sparkline>`
for cost/hour), `<ActivityFeed>` (newest-first, `<Static>` for historical entries, live in-progress
row), `<WatchBottomStrip>` (up-next / limit countdown / today stats in three equal columns), and
`<WatchPaused>` (user-pause variant in yellow; limit-pause variant in magenta with figlet large
countdown). Data polling via `useQueueState()` hook polling meta.json every 2 seconds. Responsive
layout: collapses bottom strip at 80×24, adds stat-card row at 160×50.

### Phase 12 — TUI Manage Mode + Phase Drilldown

Built Manage mode as a triptych: `<QueuePane>` (3-row entries with `┃` left-edge marker on
selection), `<PhasesPane>` (one row per phase with StateChip + cost), `<ExecutingPane>` (live tool
calls, spinner, token/cost for current phase). Full keybind surface: Tab focus cycle, ⌥↑↓ reorder,
p pause/resume, r remove, R retry, S skip, K kill with confirmation modal, e editor, l log,
`:` command palette. `<CommandPalette>` uses `ink-text-input` for live filtering over the full
keybind surface. `<KillConfirmModal>` sends SIGTERM then SIGKILL after 5s and stores the PID in
meta.json for cross-restart signal delivery. `<Drilldown>` is a full-screen phase inspector with
6 sections (metadata, summary, commit, notes, activity buffer, log tail).

---

## Lessons Learned

- **String-literal unions over enums for JSON round-trips.** TypeScript enums do not survive
  `JSON.stringify` / `JSON.parse` without a custom reviver. Using `type RunStatus = 'queued' | 'executing' | ...`
  makes storage trivial and narrows correctly at every use site.

- **Pre-allocate session UUIDs before spawning Claude.** The jsonl path under `~/.claude/projects/`
  is derived from the session UUID. Writing the UUID to meta.json before spawning lets the tail
  watcher start and the path be known — otherwise there is a race between the Claude process creating
  the file and the watcher looking for it. The glob fallback in `jsonl-tail.ts` exists because the
  slash-to-dash encoding for worktree paths under `~/.local/state/cpe/` is not guaranteed to be
  stable.

- **HEAD cross-check catches Claude misreporting `committed: true`.** Without comparing HEAD before
  and after the session, a phase that claims `committed: true` but made no commit would silently
  advance the queue. Treating this discrepancy as a phase failure triggers the retry machinery.

- **`bun build --compile` bundles static asset imports.** Prompt files under `src/prompts/` are
  inlined at compile time if imported with `with { type: 'text' }` or read via `Bun.file()` at a
  path relative to `import.meta.dir`. The loader in `src/prompts/index.ts` uses this so the binary
  needs no external files at runtime.

- **Ink's `<Static>` is the right primitive for append-only feeds, but requires key stability.**
  The ActivityFeed's historical entries must be in a stable array with stable keys — Ink re-renders
  static content only when the array grows. Mutating existing entries or changing array indices
  causes duplicate rendering artifacts.

- **Queue processor and Ink render loop coexist naturally.** Ink calls `render()` and takes over
  stdin/stdout; the async queue processor runs alongside as a normal `await`ed promise. The two do
  not interfere as long as the processor emits to the event bus rather than writing to stdout
  directly — which is why the Phase 09 `console.log` lines were removed when Phase 10 landed.

- **Kill flow requires PID in meta.json.** The TUI and the process that spawned Claude may not share
  memory (e.g. after a crash-recovery restart). Persisting the child PID to meta.json during
  execution enables `SIGTERM` → `SIGKILL` escalation to work correctly even after the TUI restarts
  and re-attaches to a running session.

- **`ensureRepoConfig` should always be called at queue time, not start time.** Bootstrap commands
  need to run in the worktree before any phase executes. Running them at `cpe queue` keeps the
  interactive prompt flow out of the TUI's rendering loop, which cannot safely mix readline-style
  prompts with Ink's terminal control.
