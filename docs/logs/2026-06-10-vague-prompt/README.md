# Vague-prompt matrix ×2 — diagnosis + fixes arc (2026-06-10)

Two back-to-back runs of **9 harnesses × `gemma4-cpe:12b`** through the LiteLLM
gateway with a deliberately ambiguous prompt, with a debugging round between
them. Together with the [direct-prompt baseline](../2026-06-10-litellm-synthetic/README.md)
from the same day, this is a self-contained record of: prompt-quality
sensitivity, two gateway-level bugs, two cpe bugs, and the fixes for all four.

## Prompt (the "bad" one — nothing named, no explicit commit ask)

> Hey, people keep telling me the greeting comes out wrong when they run this.
> Could you take a look and sort it out? Would be good to have some record of
> what changed too.

Same synthetic baseline as the direct run: `greet.py` whose `greet()` ignores
its name argument.

## Layout

- `<harness>__gemma4-cpe-12b/` — the **post-fix run** (final state): `meta.json`
  (honest outcomes + full litellm tokens), `diff`, `transcript`.
- `_pre-fix-run-logs/<harness>/` — the **pre-fix run**'s `meta.json` + `bench.log`
  (its `results/` captures were overwritten by the `--force` re-run; outcomes for
  it below are from the analysis done at the time).

## Outcomes

| Harness | pre-fix | post-fix | note |
|---|---|---|---|
| aider | ✅ (7.8k out — 6k-token reasoning spiral on its list-files turn) | ✅ (5.2k out, decisive) | preamble fix validated |
| claude-code | ✅ | ✅ | |
| codex | ❌ hallucinated a React codebase, `rg` broken, 10.5 min | ❌ grounded (rg works, found greet) but 23.2k reasoning tokens, 6 commands, no edits | env fixed; failure now purely model-level |
| crush | ❌ silent exit after 1 tool call | ✅ **first-ever completion** (68s, multi-turn) | gateway streaming patch |
| goose | ✅ | ✅ | |
| mini-swe-agent | ✅ | ✅ | |
| opencode | ✅ | ❌ grep "greeting" → 0 matches → 22-token surrender | 12b flakiness, not a bug |
| openhands | ✅ | ✅ | |
| pi | ✅ | ✅ | |

7/9 both times — same score as the direct prompt, so prompt vagueness mostly
costs **tokens and turns**, not success, at this model size.

## The four bugs this pair of runs found (all fixed)

1. **LiteLLM streaming `finish_reason` (gateway):** on streamed `ollama_chat`
   responses, tool_calls arrive mid-stream but the final chunk said
   `finish_reason: "stop"`. crush honors finish_reason strictly → ended the turn
   without executing its (perfectly good) tool call and exited silently; every
   other harness executes tool_calls regardless, masking the bug. Root-caused
   via Langfuse traces (the response carried the tool call; the body's last
   chunk said `stop`) + a local `--debug` reproduction; non-streaming was always
   correct. **Fix:** local patch of open PR BerriAI/litellm#20585 on the
   homelab's v1.88.1 (drop when the PR ships in a release).
2. **Spend-log collection race (cpe, `a0b0270`):** rows flush in batches; the
   first non-empty poll can be partial. crush's title-generation row landed a
   poll before its agent rows → 10.9k tokens recorded as 375. Now totals must
   agree across two consecutive polls. Post-fix crush records 135.9k/2.7k.
3. **codex CODEX_HOME under /tmp (cpe, `22f756c`):** codex refuses to install
   its helper binaries (incl. its bundled `rg`) under /tmp →
   `command not found: rg` while `/usr/bin/rg` existed → its first discovery
   search failed, feeding the pre-fix hallucination spiral. Moved to `~/.cache`.
4. **Autonomy preamble vs harness protocols (cpe, `f5eeed2`):** "do not stop
   partway" contradicted aider's name-files-then-stop repo-map protocol; a 12b
   model burned 6k reasoning tokens reconciling. One sentence ("following your
   tool's own workflow… does not count as stopping") cut that turn ~40%.

Also relevant: `drop_params: true` went live on the gateway between the
direct-prompt run and these (codex's `parallel_tool_calls`/`web_search_options`
were instant 400s before).

## Diagnosis tooling note

Langfuse API access (basic auth with the pk/sk keypair) was the decisive tool:
`/api/public/traces` + `/observations` return full request/response bodies —
including the `tools` array the harness sent and per-request usage — which is
how both the crush root cause and the token under-count were proven without
any traffic interception in cpe.
