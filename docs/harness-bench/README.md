# Harness Bench

Evolve cpe so every run carries a selectable **`{ provider, model, harness }`** triple, turning
the executor into pluggable infrastructure. The benchmark (running many harness x model
combinations against one task and capturing the results) then falls out of the parameterization as
a thin layer on top.

## Background / motivation

cpe automates `planbot -> next-phase -> summarise-plan` by spawning `claude -p`. Two pressures drive
this work:

1. **Cost cliff:** Anthropic is making `claude -p` usage much more expensive imminently, which
   defeats cpe's original economics.
2. **Local models are now good enough:** the homelab model eval (see the `homelab` repo
   `docs/llm-models-eval.md`) selected **`gemma4-cpe:31b`** as a capable local coding model.

The immediate escape already exists in cpe's bones: `src/runner/provider.ts` injects
`ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`, so `claude -p` can be pointed at an
Anthropic->Ollama proxy and run a local model at zero API cost. The durable win is letting cpe run
**other harnesses** (opencode, aider, goose, openhands, plandex) that may get more out of a local
model than claude-code does - and making that choice a permanent, per-run feature.

## Locked decisions

- **Home/stack:** build in the cpe repo (Bun/TypeScript); the `homelab` repo is only the test target.
- **Run model:** `{ provider, model, harness }` are first-class per-run fields with global defaults
  and per-run CLI override. Default `harness = claude-code` so existing behaviour is unchanged.
- **Isolation:** a **full clone** per run (agent-git-safe - an agent running `git reset --hard`
  cannot touch the real repo). The clone source is **where cpe was started**: the repo in the CWD and
  its current branch, detected exactly as the plan tool does (`getPrimaryRepo()` + `getCurrentBranch()`
  in `src/git/repo.ts`). That CWD repo/branch is the **baseline every benchmark run starts from**;
  there is no hardcoded target repo or branch.
- **Prompt:** a **runtime input** set at run start (not hardcoded). The homelab "update-mechanism"
  prompt is the first example; the mechanism is generic for any cpe user.
- **Results:** push `harnesstests/<harness>__<model>` branches AND save `results/<harness>__<model>/`
  (diff, transcript, `meta.json`); a final summary table. **Quality scoring stays manual.**
- **Safety:** strictly sequential; **activity-based timeout** (a run is kept alive as long as the
  harness keeps streaming *new* output - not the same line repeated over and over; it is killed with a
  process-tree kill only after a window of no new activity) plus a **manual bail** so the user can stop
  a misbehaving run; configurable inter-run pause (default 180-240s) to let Ollama evict the previous
  model.

## Architecture

- **`Harness` adapter contract** (`src/harness/`): each adapter knows its headless invocation, model
  wiring, and **completion mode** - either `structured` (claude-style: parseable JSON envelope, like
  `src/runner/session.ts` + `src/runner/envelope.ts`) or `opaque` (exit code + git diff). The
  contract supports both single-prompt and phase-loop execution.
- **Dispatch refactor:** `src/runner/single-prompt.ts` and `src/runner/phase-loop.ts` stop hardcoding
  `claude` and dispatch through the contract. The existing claude path becomes the reference
  `claude-code` adapter (structured mode), reusing `runSession`, `provider.ts`, `jsonl-tail.ts`,
  `envelope.ts`, `finalise.ts`.
- **Clone isolation** (`src/git/clone.ts`) alongside the existing `src/git/worktree.ts`.
- **Capture + bench layer:** per-run diff/meta/transcript/tokens -> `results/`, branch push, and a
  matrix command that enqueues the harness x model cross-product as ordinary runs.
- **UI:** extend the Ink TUI (`src/tui/`) with a bounded live output pane + matrix progress, plus a
  **manual bail** keybind to stop the running combo. (A headless no-TTY mode is deliberately deferred
  to a later plan - see Scope.)

## Scope

**In:** run parameterization; adapter contract + dispatch refactor; claude-code reference adapter;
Anthropic->Ollama proxy + local-model provider preset; clone isolation; capture; matrix command;
bounded TUI + manual bail; adapters (opencode, aider, goose, openhands, plandex, pi, crush,
codex-cli, swe-agent), one per phase.

**Out (this plan):** automated quality scoring; the **headless no-TTY mode** (deferred to a later,
properly-designed plan - not worth building blind here); the orchestrator/server deployment itself
(only evaluated, not built, in the plandex phase).

## Phases

Core platform + bench: see [PROGRESS.md](PROGRESS.md). Phases 01-06 are the committed core; phase 07
(opencode) is the canonical adapter template; phases 08+ are the one-adapter-per-phase set (aider,
goose, openhands, plandex, then pi, crush, codex-cli, swe-agent) detailed in
[ADAPTER_BACKLOG.md](ADAPTER_BACKLOG.md). Since we run and validate everything locally, all phases land
as **commits on `feature/harness-bench`** (no per-phase branches or PRs) - see Branching.

## Definition of Done

- A cpe run can be launched with `--provider`, `--model`, and `--harness`; defaults preserve today's
  claude-code behaviour.
- **Regression gate:** with default settings, claude-code runs are byte-for-byte identical to
  pre-refactor, proven by the existing `src/runner/envelope.test.ts` and `src/runner/jsonl-tail.test.ts`
  (plus any other current tests) passing unchanged.
- `claude-code` can run `gemma4-cpe:31b` locally via the Anthropic->Ollama proxy at zero API cost.
- At least **opencode** runs end-to-end under the harness contract against a fresh clone of the
  baseline (the CWD repo at its current branch) on `gemma4-cpe:31b`, with captured results and a
  pushed `harnesstests/*` branch.
- A matrix command runs a harness x model cross-product sequentially with an activity-based timeout
  (and manual bail), inter-run pause, a bounded live UI, and a final summary table.
- `lint`, `build`, and the test suite pass at the end of every phase.

## Branching

All work happens locally where we also build and test, and no one else needs to review or approve, so
per-phase branches and PRs are wasted effort.

- Single working branch: `feature/harness-bench` (off cpe `main`). All phases are done here.
- **One commit per phase** on `feature/harness-bench` (no `feature/harness-bench-phase-XX` branches,
  no per-phase PRs). The commit message references the phase (e.g. `harness-bench phase 04: ...`).
- A feature PR into `main` is optional and only at the very end, if wanted.
- Note: this is the *development* branching for building cpe. It is unrelated to the
  `harnesstests/<harness>__<model>` branches that benchmark runs push inside their clones.
