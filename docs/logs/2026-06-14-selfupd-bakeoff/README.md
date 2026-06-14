# Self-update bake-off (2026-06-14) — granite vs qwen-coder-next × opencode vs claude-code

The harder bake-off promised after the [floor test](../2026-06-13-new-models/):
run the **real multi-phase self-update plan** (same plan as the
[plan-vs-vague experiment](../2026-06-10-plan-vs-vague/)) across 2 models × 2
harnesses to rank them on actual work. **This round was largely invalidated by a
gateway context-window misconfiguration** — kept for the diagnostic value and
because it is the strongest evidence yet for evidence-gated phase completion.
A re-run on extended context windows follows.

## Setup

- **Plan:** the 4-phase frontier-generated self-update plan (SHA256SUMS → core
  module → CLI surface → TUI loop). One clone per combo (plan runs mutate
  PROGRESS.md + the feature branch).
- **Baseline:** feature/harness-bench + the plan docs on `main`.
- **Models:** `ls/granite4.1:8b`, `ls/qwen3-coder-next:80b`.
- **Harnesses:** opencode (opaque hybrid path), claude-code (structured envelope).
- **Provider:** homelab-litellm → `ls/` llama-server.

## Outcomes — 0 of 4 produced working code

| Run | Reported | Reality |
|---|---|---|
| granite-opencode | **4/4 complete** | **Build FAILS**; added `src/update/__init__.py` (a Python file in a Bun/TS repo); **deleted ~1,250 lines** from existing TUI (`Manage.tsx -531`, `Watch.tsx -272`, `Bench.tsx -249`, `cli.ts -196`); phase 04 produced no real commit |
| granite-claude | 2/4 failed | P01/P02 real + committed; P03 = **backend stall → "Request timed out"** (66-min gap) — spurious infra, salvageable |
| qwen-opencode | 1/4 failed | P01 real; P02 = **context overflow** (34,780 > 32,768) → opencode emitted a malformed giant tool-call and exited 1 |
| qwen-claude | 0/4 failed | P01 = **context overflow** (33,555 > 32,768) — claude-code's ~21k tool schema alone exceeded the window before any work |

## Root causes (none WSL)

1. **`qwen3-coder-next:80b` had a 32,768-token context window on llama-server** —
   far below what agentic harnesses need (claude-code's schema is ~21k before any
   files). Sole cause of both qwen failures; the model never got a fair run.
   **Fixed post-round: context windows sensibly extended on all models.**
2. **granite-claude P03**: backend hang → request timeout (the recurring
   llama-server stall pattern). Spurious; P01/P02 committed work is real.
3. **granite-opencode**: the verification-discipline gap, again — reported 4/4
   "complete" while leaving a non-building, partially-destroyed tree. granite at
   8B under a 4-phase plan was destructive (gutted TUI files) and hallucinated
   Python conventions.

## cpe bugs surfaced (fixed this session)

- A context-overflow `400` was classified as **"auth error: 400"**.
- A request timeout was classified as **"unknown api error: null"**.
  Both made the post-mortem misleading; the envelope classifier now recognises
  context-overflow and timeout distinctly.

## Standing finding, reinforced

This round is the **strongest case yet** for evidence-gated phase completion:
two runs couldn't physically fit the context, and the one run that reported full
success shipped broken, destructive code under a green status. Phase completion
must gate on `build`/`test` evidence, not the agent's self-report.

## Re-run

Superseded by the extended-context re-run (same 4 combos) — see the next dated
log folder. This folder is the pre-fix baseline.

## Layout

One dir per combo: `meta.json`, run logs (tail-capped), `branch.diff`,
`commits.txt`. qwen-claude has an empty diff (failed before any edit).
