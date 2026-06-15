# Harness × model matrix — homelab repo (2026-06-07, paused)

Archived logs from the first "real" `cpe bench` matrix against the **homelab** repo
(`gitea.lab.richardbenson.co.uk/richard/homelab`). The run was **paused early** (the
desktop Ollama host was hitting memory/OOM errors, being fixed separately), so it is
**not a clean result set** — it's kept for reference while diagnosing reliability.

## Run parameters

- **Harnesses (9):** claude-code, opencode, aider, goose, openhands, pi, crush, codex, mini-swe-agent
- **Models (3):** `gemma4-cpe:12b`, `gemma4-cpe:26b`, `gemma4-cpe:31b`
- **Provider:** desktop-ollama (`http://192.168.1.3:11434`), local, zero API cost
- **Prompt:** the homelab "update-mechanism" question (manage updates for the opencode/openchamber VM; favour latest-not-pinned with last-known-good logging; fully automated)
- **Caps at run time:** `max_runtime_seconds=5400` (90 m), `pause_seconds=30`, inactivity off
- **Progress at pause:** ~24/27 ran; `codex:31b` was mid-run; all 3 `mini-swe-agent` combos were still queued.

## Outcomes

| Harness | 12b | 26b | 31b |
|---|---|---|---|
| aider | ✅ 276s (3f/155) | ✅ 405s (4f/148) | ✅ 2097s (2f/103) |
| claude-code | ❌ error 35s (32k-token cap) | ✅ 1223s (3f/100) | ⏱ timeout 5400s (0 edits) |
| codex | ✅ 297s (4f/150) | ✅ 419s (2f/110) | — executing at pause |
| crush | ⚪ no-op 36s | ✅ 409s (3f/168) | 🛑 bailed 3920s (partial) |
| goose | ✅ 297s (5f/137) | ⚪ no-op 124s (checklist) | ⚪ no-op 1029s (stream error) |
| opencode | ⚪ no-op 46s | ✅ 465s (2f/49) | ✅ 3378s (4f/149) |
| openhands | ✅ 497s (2f/26) | ✅ 514s (3f/172) | ⚪ no-op 5365s (error thrash) |
| pi | ✅ 112s (2f/49) | ✅ 619s (2f/22) | ✅ 4859s (1f/23) |
| mini-swe-agent | — queued | — queued | — queued |

✅ completed · ⚪ no-op · ❌ error · ⏱ timeout · 🛑 manually bailed · — not captured

## Why the no-changes runs failed (triage)

**A. Infrastructure (desktop memory/OOM) — not a cpe problem; should clear once memory is fixed**
- `goose:31b` — `Stream decode error: error decoding response body` (Ollama dropped mid-stream)
- `crush:12b` — 36s, empty log (model never loaded)
- `openhands:31b` — 89 min of `is_error` toggling, then "finished" with nothing

**B. cpe-fixable — addressed after this run (see Fixes)**
- `claude-code:12b` error — `response exceeded the 32000 output token maximum`
- `goose:26b` no-op — replied with a **markdown to-do checklist** instead of editing files

**C. Model limitation (gemma4-cpe:12b is borderline) — expectations, not a fix**
- `opencode:12b` — a couple of `glob` calls (19 output tokens), no edits
- `claude-code:31b` timeout — stuck in claude's *Read-before-Write* edit protocol (kept writing files it hadn't read); the 90 m cap caught it

## Fixes made in response (commit `062664f`)

1. **claude-code adapter** sets `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000` (env-overridable) so a verbose local model doesn't hard-error at 32k.
2. **`AUTONOMY_PREAMBLE` hardened** (applies to all run forms): must implement by editing files now; explicitly forbids replying with a plan/checklist/description; text-only output counts as failure.

Still open / not changed: claude's Read-before-Write friction on weaker models; 12b being too small for some harnesses; and the desktop memory issue (infra).

## Notes / caveats

- **Token columns are unreliable for comparison.** Local Ollama has no prompt caching, so every turn re-sends full context → inflated input counts (e.g. opencode:26b 1.1M, claude-code:26b 848k). crush under-reports output (it logs only the final text turn). Treat tokens as rough, not exact.
- Any `cost` figures are **synthetic** (Anthropic pricing applied to a local model) — real spend was zero.
- Branch pushes: this run pushed `harnesstests/<combo>` branches to the homelab gitea; those were handled separately.

## Archive layout

```
<harness>__<model>/
  meta.json      capture meta: outcome, duration_ms, diffstat, tokens, outcome_reason
  diff           the git diff the harness produced (the actual deliverable)
  transcript     raw harness stdout/JSONL  (transcript.gz if >1MB — pi's are ~11-33MB raw)
_runs-without-results/<combo>__<runid>/
  meta.json + *.log   runs that never reached capture (codex:31b executing, mini:* queued at pause)
```
Gunzip a transcript with `gunzip -k <combo>/transcript.gz`.
