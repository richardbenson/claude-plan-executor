# Harness × model synthetic matrix — LiteLLM gateway shakedown (2026-06-10)

Archived results from the first matrix routed through the **LiteLLM gateway**
(`https://litellm.lab.richardbenson.co.uk`) — the live end-to-end validation of the
per-run-key token-tracking integration (commit `0918a2a`, spec:
[litellm-integration-spec.md](../../litellm-integration-spec.md)). Unlike the
[2026-06-07 homelab matrix](../2026-06-07-homelab-matrix/README.md) this used a tiny
**synthetic baseline** so every harness/model could plausibly finish: a `greet.py`
whose `greet()` ignores its name argument, with the task "fix the bug, write a
one-sentence `DONE.md`, commit".

## Run parameters

- **Harnesses (9):** aider, claude-code, codex, crush, goose, mini-swe-agent, opencode, openhands, pi (plandex excluded — server/auth still parked)
- **Models (2):** `gemma4:12b-it-qat` (base) vs `gemma4-cpe:12b` (modified build) — base-vs-cpe comparison
- **Provider:** `homelab-litellm` (type `litellm`) → `ollama_chat/` → desktop Ollama; per-run ephemeral keys, spend-log token collection
- **Caps:** `max_runtime_seconds=5400` (key duration 2× = 3 h), `pause_seconds=30`, inactivity off
- **All 18 runs executed** (≈ 21 min wall total).

## Headline: the LiteLLM integration works

Every run recorded `"token_source": "litellm"` with wire-accurate split
input/output tokens summed from `/spend/logs?api_key=<run key>` — including the
codex error runs (correctly 0/0: the gateway rejected the requests before any
model call). claude-code routed via `/v1/messages`, everything else via
`/v1/chat/completions`, all through one gateway. goose's `CPE_GATEWAY=openai-compat`
switch (its first live gateway run) worked.

## Outcomes — CAUTION: the stored `outcome` labels are wrong

The `meta.json` `outcome` fields in this archive predate the fix in `eaed161`:
outcome was derived from `git status --porcelain` only, so agents that **committed**
their work (the prompt asked them to) left a clean tree and were mislabelled
`no-op`. The capture `diff` (taken against the clone's base ref) is the ground
truth. Re-graded from the diffs:

| Harness | base `gemma4:12b-it-qat` | cpe `gemma4-cpe:12b` |
|---|---|---|
| aider | ✅ fixed + DONE.md (41s) | ✅ fixed + DONE.md (21s) |
| claude-code | ✅ fixed + DONE.md (159s) | ✅ fixed + DONE.md (111s) |
| codex | ❌ gateway 400 (3s) | ❌ gateway 400 (1s) |
| crush | ⛔ did nothing (21s) | ⛔ did nothing (15s) |
| goose | ⛔ did nothing (26s) | ✅ fixed + DONE.md (24s) |
| mini-swe-agent | ✅ fixed + DONE.md (86s) | ✅ fixed + DONE.md (79s) |
| opencode | ✅ fixed + DONE.md (58s) | ✅ fixed + DONE.md (38s) |
| openhands | ⛔ did nothing (36s) | ✅ fixed + DONE.md (59s) |
| pi | ✅ fixed + DONE.md (34s) | ✅ fixed + DONE.md (18s) |

**Real score: 12/18 succeeded (5/9 base, 7/9 cpe).** The cpe build never
regressed vs base, won goose and openhands outright, and was faster on nearly
every harness.

## Findings / follow-ups

1. **Outcome mislabelling — FIXED** (`eaed161`): all opaque adapters now use the
   shared `src/harness/git-changes.ts` rule (HEAD moved since entry OR dirty
   tree), the rule aider always had. Future runs label committed work correctly.
2. **codex blocked by the gateway, not the model:** LiteLLM rejects codex's
   `parallel_tool_calls`/`web_search_options` params for `ollama_chat`
   (`litellm.UnsupportedParamsError`, HTTP 400, both runs ~2 s). Homelab fix:
   `litellm_settings: drop_params: true` in the LiteLLM config, then re-run.
3. **crush did nothing on both models** (1 request, 356 in / 40 out, exit 0): the
   model replied with text instead of tool calls and crush stopped. Worth a
   Langfuse trace dive (filter model + 2026-06-10 ~09:45–10:15 UTC).
4. **claude-code's cost figures are fabricated** ($0.77/$0.88 self-reported
   Anthropic pricing against a free local gateway) and its ~130–152k input tokens
   are real but dominated by its own system prompt re-sent per turn.
5. Token totals: cpe-12b generally consumed more input tokens than base where both
   succeeded (e.g. mini-swe-agent 80k vs 39k) — more turns/iteration; worth
   watching on bigger tasks.

## Layout

One directory per combo (`<harness>__<model-slug>/`), each containing:

- `meta.json` — run metadata incl. `tokens` (split) + `token_source: "litellm"`
  (and the stale pre-`eaed161` `outcome` — see above)
- `diff` — the captured change vs the clone base ref (ground truth)
- `transcript` — full harness output/log
