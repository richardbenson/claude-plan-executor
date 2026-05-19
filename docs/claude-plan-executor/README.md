# Claude Plan Executor (`cpe`) — Implementation Plan

## Overview

`cpe` is a CLI/TUI tool that automates the planbot → next-phase → summarise-plan workflow,
queueing work across repos and running overnight with automatic rate-limit handling.

## Links

- [PROGRESS.md](PROGRESS.md) — phase tracking
- [Spec](../000-claude-plan-executor-spec.md) — authoritative requirements
- [DESIGN.md](../DESIGN.md) — TUI source of truth (read before any TUI phase)
- [tui-design.html](../tui-design.html) — visual reference (open in a browser)

---

## Functional Requirements

- **Plan creation**: `cpe plan [details]` launches an interactive Claude session seeded with the
  embedded planbot prompt in a fresh git worktree; on completion, offers to queue the plan.
- **Queueing**: `cpe queue [folder]` adds a manually-authored plan to the queue; validates that
  `PROGRESS.md` and at least one `PHASE_*.prompt.md` exist.
- **Execution**: `cpe start` launches the TUI and drives sequential phase execution; each phase is
  a fresh `claude -p --session-id <uuid> --output-format=json --json-schema <schema>` session
  running in the run's dedicated git worktree.
- **Rate-limit handling**: detects 429 via envelope `is_error + api_error_status: 429`, captures
  `session_id` for potential resume, parses reset time from `result` field, sleeps until window
  reopens, then fresh-restarts or resumes per §7.3.2 of the spec.
- **Live observability**: tails the pre-known jsonl path for real-time tool-call events; pushes
  ActivityEvents to an in-memory event bus the TUI subscribes to.
- **Finalisation**: after all phases complete, runs the embedded summarise prompt (headless
  `claude -p`), pushes the feature branch, and opens a PR (`gh pr create` for GitHub, `tea pr
  create` for Gitea).
- **TUI Watch mode** (default on `cpe start`): hero showing current phase + live activity feed +
  up-next / limit window / today stats. Toggle to Manage with `v`.
- **TUI Manage mode**: triptych (queue / phases / executing) with full keybind surface for
  reordering, retrying, skipping, and killing sessions. Toggle to Watch with `v`.
- **Phase drilldown**: full-screen view of a phase's metadata, summary, commit, notes, and log
  tail. Opened from Manage mode with `↵` on a phase row.
- **Per-repo bootstrap**: `cpe.config.json` at the primary repo root with a `bootstrap` array of
  shell commands; first-time prompt offers LLM-detect / stub / skip. `cpe bootstrap` subcommand
  manages the config.
- **Worktree management**: all execution in `~/.local/state/cpe/worktrees/<run-id>/`; `cpe clean`
  removes completed worktrees with per-worktree confirmation.
- **Resilience**: crash-recovery on restart (re-attach to `executing` run/phase), graceful exit
  with confirmation modal when a session is active, HEAD cross-check for commit verification,
  worktree reconciliation against `git worktree list` on startup.

## Non-Goals (initial scope)

- Parallel/concurrent phase execution
- Background daemon mode
- Cross-platform beyond Ubuntu/WSL (Linux primary)
- Replacing planbot's interactive planning intelligence

---

## Technical Approach

| Concern | Choice |
|---|---|
| Language | TypeScript (strict mode, `noUncheckedIndexedAccess`) |
| Runtime | Bun |
| Distribution | `bun build --compile` → single binary named `cpe` |
| TUI | Ink (React-for-terminal, v5+), `ink-spinner` |
| CLI parsing | `commander` |
| Run IDs | `ulid` |
| Git | shell-out to `git` |
| VCS APIs | `gh` CLI (GitHub), `tea` CLI / REST (Gitea) |
| Storage | JSON files — `~/.config/cpe/config.json`, `~/.local/state/cpe/queue.json`, `~/.local/state/cpe/runs/<id>/meta.json` |
| Tests | `bun test` for pure-logic units (reset-time parser, envelope classifier, state taxonomy, meta.json read/write) |

## Repository Layout

```
src/
  index.ts              # binary entry point
  cli.ts                # command router (commander setup + subcommand registration)
  prompts/              # embedded prompts + schema (bundled at build time)
    planbot.md
    summarise.md
    bootstrap-detect.md
    phase-result-schema.json
    index.ts            # typed loader for embedded prompts
  commands/             # one file per CLI command
    bootstrap.ts
    clean.ts
    list.ts
    plan.ts
    queue.ts
    remove.ts
    start.ts
    status.ts
  config/
    repo-config.ts      # cpe.config.json read/write + first-time prompt
  events/
    bus.ts              # typed internal event emitter
    types.ts            # ActivityEvent union type
  git/
    repo.ts             # primary repo detection, remote parsing, VCS host
    worktree.ts         # create, rename/move, remove, list, reconcile
  runner/
    envelope.ts         # TypeScript types + parser for claude -p JSON envelope
    finalise.ts         # summarise step + push + PR
    jsonl-tail.ts       # fs.watch + line-buffered jsonl → ActivityEvents
    limit.ts            # 429 detection, run pause, session_id capture
    phase-loop.ts       # full per-phase lifecycle (§7.3)
    reset-time.ts       # parse "4pm (Europe/London)" → Date
    session.ts          # spawn claude -p with pre-allocated --session-id
  storage/
    config.ts           # ~/.config/cpe/config.json read/write
    meta.ts             # ~/.local/state/cpe/runs/<id>/meta.json read/write
    queue.ts            # ~/.local/state/cpe/queue.json read/write
  tui/
    App.tsx             # root Ink component, mode toggle, dimension detection
    Drilldown.tsx       # full-screen phase drilldown (§6 of DESIGN.md)
    Manage.tsx          # Manage mode root (triptych layout)
    Watch.tsx           # Watch mode root
    components/
      ActivityFeed.tsx
      CommandBar.tsx
      CommandPalette.tsx
      ExecutingPane.tsx
      Header.tsx
      KillConfirmModal.tsx
      PhasesPane.tsx
      QueuePane.tsx
      Sparkline.tsx
      Spinner.tsx
      StateChip.tsx
      WatchBottomStrip.tsx
      WatchHero.tsx
      WatchPaused.tsx
  types/
    meta.ts             # TypeScript interfaces for meta.json, queue.json, config.json
    state.ts            # RunStatus/PhaseStatus enums + glyph/color table
```

## Coding Conventions (established in Phase 01, followed by all phases)

- Named exports only — no default exports
- Single quotes for strings
- Semicolons at end of statements
- File naming: kebab-case (`reset-time.ts`, not `resetTime.ts`)
- Directory naming: lowercase (`src/runner/`, `src/tui/`)
- Error handling: throw typed `Error` subclasses — do not silently swallow errors
- No `any` types — use `unknown` and narrow
- JSX files: `.tsx` extension; all other TypeScript: `.ts`

## Branching Strategy

- Feature branch: `feature/claude-plan-executor`
- Phase branches: `feature/claude-plan-executor-phase-N` (branch off feature branch)
- Phase PRs → `feature/claude-plan-executor`
- Feature PR → `main`

---

## Definition of Done

- [ ] `bun build --compile --outfile cpe src/index.ts` produces a working binary
- [ ] `cpe plan "add tests for the login service"` launches an interactive Claude session in a
      fresh worktree and offers to queue the resulting plan
- [ ] `cpe start` processes at least one plan end-to-end (phases + summarise + PR)
- [ ] Rate-limit events pause the queue and auto-resume after the reset window
- [ ] TUI Watch mode renders correctly at 80×24 and 120×40; activity feed updates live
- [ ] TUI Manage mode: queue reorder, pause, remove, retry, skip, kill all function
- [ ] Phase drilldown opens with `↵` from the Manage phases pane
- [ ] `cpe clean` removes worktrees for completed runs with per-worktree confirmation
- [ ] `bun test` passes for all unit tests
- [ ] `tsc --noEmit` passes with zero errors on the full `src/` tree
