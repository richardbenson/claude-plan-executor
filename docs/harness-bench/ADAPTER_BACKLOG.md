# Adapter backlog (one harness per phase)

Each adapter is its own phase, following the **template in PHASE_07.prompt.md** (pre-flight install
check -> read docs -> directly test for structured-vs-opaque completion -> implement against the
`Harness` contract -> validate via `cpe bench` on gemma4-cpe:31b -> update PROGRESS). Every adapter
phase now has its own `PHASE_XX.md` + `PHASE_XX.prompt.md` (08-15), generated from the Phase 07
template with the per-harness intel below baked in - run them with the `next-phase` skill. This file is
the per-harness reference that fed those phase files. All work stays on `feature/harness-bench` as
**one commit per phase** - no per-phase branch or PR.

The phase-08 model matrix should also include **gemma4-cpe:26b** (the fast MoE that failed opencode's
exact-`oldString` edit tool in the model eval) to test the core hypothesis: does a different edit
strategy rescue the fast MoE?

## Phase 08 - aider (the edit-strategy comparison)
- Docs: aider headless via `aider --message "<prompt>" --yes-always --model <provider>/<model>`
  (and `--message-file`). Local model via `--model ollama/<model>` or OpenAI-compatible config.
- Key variable: aider's **edit format** (`--edit-format whole|diff|udiff`). `whole` = rewrite-whole-file,
  which sidesteps the exact-`oldString` failure that broke the MoE under opencode. Expose edit-format
  as an adapter option and test it. This is the most interesting single comparison in the set.
- Expected completionMode: opaque (exit + diff); aider auto-commits, so capture its commits.
- Risk: aider auto-commits to the clone - reconcile that with capture/branch-push (use its commits).

## Phase 09 - goose (Block)
- Docs: `goose run -t "<prompt>"` (or `-i instructions.md`); Rust single binary; 15+ providers incl.
  Ollama. Provider/model configured via goose config (profiles) - materialise an Ollama profile.
- Expected completionMode: opaque. MCP-centric tool use - note which MCP extensions (if any) it needs.
- Risk: goose config/profile location is global; isolate per-run config.

## Phase 10 - openhands (All-Hands)
- Docs: headless `openhands -t "<prompt>" --headless` (CLI-only package `openhands-cli` if avoiding
  the web UI). LLM via config (`ollama/<model>`, base_url). Runs inside a sandboxed runtime.
- Expected completionMode: opaque, but it may emit a structured event log - check in step 2.
- Risk: heaviest setup (Docker/sandbox runtime); ensure the sandbox mounts/uses the clone as workspace
  and that changes land in the clone for capture. Budget extra time.

## Phase 11 - plandex (+ orchestrator write-up)
- Docs: client/server; `plandex` CLI talks to a plandex server. OpenAI-compatible/Ollama models.
- Expected completionMode: opaque (apply changes to the repo); has its own diff/apply sandbox.
- Bonus deliverable: a short write-up on how plandex's client/server split maps to the eventual
  "run harnesses on a server from an orchestrator" goal - does adopting plandex's server model (or
  imitating it) make the orchestrator easier? Record in `docs/harness-bench/orchestrator-notes.md`.
- Risk: requires running the plandex server; document setup and whether it can be the orchestration
  substrate or just another adapter.

## Phase 12 - pi (https://pi.dev/)
- Docs: https://pi.dev/ - lightweight, native Ollama; likely the easiest extra adapter. Confirm its
  non-interactive run command and how it selects model/base URL.
- Expected completionMode: opaque (exit + diff) - confirm in step 2.
- Risk: low; good warm-up for the second batch of adapters.

## Phase 13 - crush (Charmbracelet)
- Docs: Bubble Tea TUI agent; the key check in step 1 is whether a **headless/non-interactive** mode
  exists at all (it must, or the adapter can't drive it). Find how to pass prompt + model + base URL.
- Expected completionMode: opaque.
- Risk: it is TUI-first; if there is no scriptable run mode, record that and park the adapter.

## Phase 14 - codex-cli (OpenAI, Apache-2.0)
- Docs: verify local-model support - it may need a custom base URL like claude-code's proxy. Sandbox-
  focused; find the headless invocation and the model/base-URL wiring.
- Expected completionMode: opaque.
- Risk: local-model support may require the Anthropic/OpenAI-compatible proxy from Phase 03; reuse it.

## Phase 15 - swe-agent (Princeton)
- Docs: research/benchmark-grade; uses LiteLLM for local models; very scriptable but config-heavy.
- Expected completionMode: opaque.
- Risk: config-heavy setup; budget extra time. Best if a SWE-bench-style rig is wanted later, but
  worth including now since we are running the full matrix anyway.
