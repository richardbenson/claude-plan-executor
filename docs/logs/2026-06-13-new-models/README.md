# New-model bake-off (2026-06-13)

Small focused matrix to evaluate three models freshly added to the LiteLLM
gateway, on the new llama-server (`ls/`) backend. Floor test only — the
synthetic `greet.py` one-line bug with the **direct** prompt (prompt-quality
pinned so the grid isolates model behaviour).

## Setup

- **Baseline / prompt:** synthetic `greet.py` (greet() ignores its name arg);
  "fix it, write DONE.md, commit". Direct prompt.
- **Provider:** homelab-litellm → `ls/` llama-server host.
- **New models under test:** `granite4.1:8b` (IBM Granite, coding), `gemma4:26b`
  (dense, fills the 12b↔31b gap), `qwen3-coder-next:80b` (new MoE heavyweight).
  All three cleared the streaming tool-calling gate before queuing.
- **Grid:** opencode × {granite4.1:8b, gemma4:26b, qwen3-coder:30b *(anchor)*,
  qwen3-coder-next:80b}; claude-code × {granite4.1:8b, qwen3-coder-next:80b}
  as a heavy-tool-schema control.

## Result: 6/6 correct

Every run produced a correct fix (all interpolate `name`) **and** a DONE.md.
On a task this size capability isn't the discriminator — speed, efficiency and
harness behaviour are.

| Harness | Model | Time | In tok | Out tok | Note |
|---|---|---|---|---|---|
| opencode | **granite4.1:8b** | **1m01s** | 47k | 290 | fastest + leanest in the grid — new fast-iteration workhorse |
| opencode | qwen3-coder:30b | 1m45s | 57k | 539 | reliable incumbent anchor |
| opencode | qwen3-coder-next:80b | 1m58s | 89k | 633 | correct but no faster/better than the 30B here |
| opencode | gemma4:26b | 11m20s | 46k | **34,260** | runaway output (~50× others) for a one-line fix |
| claude-code | granite4.1:8b | 4m09s | 150k | 439 | same model, +100k input = the ~21k/turn tool-schema tax |
| claude-code | qwen3-coder-next:80b | 12m17s | 261k | 808 | slowest run; heavy schema × big model |

claude-code's reported `$0.77`/`$1.33` costs are fabricated (Anthropic pricing
against a free local gateway) — ignore. Its input-token inflation vs opencode on
the same model is the real, expected signal.

## Findings → roster decisions

- **ADD `granite4.1:8b` to the standard rotation.** An 8B that matches the 30B/80B
  on correctness while being the fastest and leanest run. Best new fast-iteration
  candidate we've benched.
- **KEEP `qwen3-coder:30b` as the quality anchor.** `qwen3-coder-next:80b` produced
  the same outcome slightly slower with more tokens — **the 80B doesn't justify its
  cost at this task size.** Revisit only on genuinely harder work.
- **DROP `gemma4:26b` from opencode workhorse runs** — 34k output tokens / 11 min
  for a one-liner is runaway generation (reasoning/repetition). Pathological here.
- claude-code stays a *control*, not a competitor: it never fails, it's just
  structurally heavier (re-sent tool schema), so it anchors rather than races.

## Caveat / next step

This is a **floor test** — a one-line fix all six clear. The real separation
between granite / 30B / 80B needs a harder task; the self-update feature from the
[plan-vs-vague experiment](../2026-06-10-plan-vs-vague/) is the natural next
bake-off to rank them on real work rather than confirm they pass the bar.

## Layout

One dir per combo (`<harness>__<model-slug>/`): `meta.json` (split litellm
tokens), `diff` (ground truth), `transcript`.
