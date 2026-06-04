# Orchestrator notes — does plandex's client/server model help cpe?

**Bonus deliverable for Phase 11.** Evaluation only — no orchestrator is built here.

The eventual goal beyond harness-bench is to **run harnesses on a server (or a
fleet of servers) driven by an orchestrator**, rather than as local subprocesses
of the `cpe` CLI. plandex is the one harness in the matrix that is *natively*
client/server, so it's the natural case study for "should cpe adopt (or reuse)
that model?"

## What plandex's architecture actually is

Established empirically while building the Phase 11 adapter (plandex 2.2.1 CLI;
docs site was down, so this is from the binary's `help`/`--help` and offline
probes):

- The `plandex` CLI is a **thin client**. It does not call any LLM itself.
- A **plandex server** holds everything that matters: model providers + endpoints
  (incl. any custom Ollama/OpenAI-compatible models), the planning/coding agent
  loop, plan state, conversation history, the pending-changes ("tentative diff")
  sandbox, and token/cost accounting.
- The client reaches the server via `PLANDEX_API_HOST` and **requires
  authentication** — with no server/account, even `plandex new` blocks on an
  interactive Cloud-auth prompt and errors out (verified). There is no
  "serverless" local mode without standing up the server.
- Changes are computed server-side into a tentative diff and only hit the working
  tree on `plandex apply` (client-driven).

So plandex is not "a CLI with an optional server" — the **server is the engine**
and the client is a remote control.

## Mapping onto cpe's needs

cpe's current execution model (Phases 01–10): each harness is a **local
subprocess** of the queue processor, run in a per-run **git clone**, with
isolation, an **activity-based timeout + bail**, and **capture** (diff/transcript/
meta + optional `harnesstests/*` push). The harness contract is deliberately
tiny: `name`, `completionMode`, `run(ctx)`.

Two distinct questions:

### Q1. Could plandex's server *be* cpe's orchestration substrate?

**No — not as-is.** Reasons:

1. **It orchestrates the wrong layer.** plandex's server orchestrates *one tool's
   own agent loop* (plandex's planner/coder/roles). cpe needs to orchestrate
   *many heterogeneous harnesses* (claude-code, opencode, aider, goose, openhands,
   …), each with its own CLI, runtime, and completion semantics. plandex's server
   has no concept of "run aider in a clone and capture its diff."
2. **Provider model mismatch.** Every other adapter takes cpe's provider env
   (`ANTHROPIC_BASE_URL` → the local Ollama endpoint) and wires it per-run. With
   plandex the model/endpoint is **server-side config**, selected on the server,
   not passed by the client. cpe's per-run `--model` / provider abstraction does
   not flow through. Adopting plandex's server would mean moving model config out
   of cpe and into a plandex-shaped place — a regression for the other 8 harnesses.
3. **Auth + lifecycle weight.** It needs a running, authenticated server process
   (DB-backed plan state, accounts). cpe's value is a zero-ceremony local CLI;
   making a plandex server a hard dependency of the whole tool is a big inversion.

### Q2. Is the *pattern* (client/server split) worth imitating for cpe's own orchestrator?

**Partly yes — but plandex is the wrong reference implementation.** The useful
idea cpe will want when it goes multi-host is a **thin client → execution server**
split where the server owns:

- a **run queue** + scheduler (cpe already has the queue; today it's processed
  in-process),
- **isolated execution** (clone + process-tree + activity timeout — cpe already
  has this in `src/runner/*` and `src/git/clone.ts`),
- **capture/results** as the durable artifact boundary (already `capture.ts`),
- a thin client that submits a prompt + harness×model matrix and streams events
  back (cpe already has the `ActivityBus` event stream + bench TUI).

That is essentially **"cpe's existing bench pipeline, but with the queue processor
hoisted into a long-running server and the TUI talking to it over a socket."**
cpe is closer to that shape *today* than plandex is, because cpe already models
the harness-agnostic concerns (isolation, capture, timeout, events) that plandex
deliberately doesn't expose.

What to borrow from plandex specifically:
- **The tentative-diff/apply boundary** is a nice safety idea, but cpe already
  gets the equivalent for free via the per-run clone (nothing touches the real
  repo; the diff *is* the result).
- **A stable client/server API** (plandex's `PLANDEX_API_HOST`) is a reminder to
  define a clean RPC/event contract early — cpe's `ActivityEvent` union is a good
  seed for the event half.

## Recommendation

- **Keep plandex as just another adapter**, not as cpe's orchestration layer.
- **Treat plandex as low-priority / "park unless it proves itself."** It is the
  only harness whose model wiring can't use cpe's provider abstraction (it's
  server-side), and it needs a running authenticated server — high cost for one
  data point. The Phase 11 adapter is implemented and registered so it *can* be
  evaluated later, but its live bench run is **deferred until a server is stood
  up**, and only if early signal says plandex is worth it.
- **For the eventual orchestrator, evolve cpe's own pipeline** (queue processor →
  long-running server; TUI/CLI → thin client over the `ActivityBus` contract).
  cpe already owns the harness-agnostic substrate (clone isolation, process-tree
  control, activity timeout, capture, events) that a multi-host orchestrator
  needs and that plandex's server does not provide.

## Status of the plandex adapter (Phase 11)

- `src/harness/plandex.ts` implemented (opaque; `plandex new` → `plandex tell
  --apply --skip-commit --no-exec --stop` in the clone; outcome from exit + git
  diff) and registered; unit-tested; build/lint/tests green.
- **Live end-to-end validation DEFERRED** — requires a reachable, authenticated
  plandex server with the local Ollama model configured (parked by decision).
  When a server is available, validate exactly as the other adapters: `cpe bench
  "<task>" --harness plandex --model <model>` and confirm the captured diff
  matches what plandex applied.
