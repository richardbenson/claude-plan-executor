# LiteLLM Integration — Specification

**Status:** IMPLEMENTED (2026-06-10) — `src/runner/litellm.ts`, litellm-aware
`resolveProvider`, dispatch settlement in single-prompt/bench/phase paths, goose
gateway mode. §4.3/§5 updated to as-built. Supersedes
[observability-proxy-spec.md](observability-proxy-spec.md) for the token-accuracy and
diagnosis goals; that own-proxy design is shelved (kept only for the live-per-turn
TUI / activity-liveness niche LiteLLM's DB-flush latency doesn't serve).

## 1. Context

The user runs a **LiteLLM proxy** (`https://litellm.lab.richardbenson.co.uk`) +
**Langfuse** (`https://langfuse.lab.richardbenson.co.uk`) on the homelab as a single
gateway for all AI tools, fronting both Ollama servers. cpe integrates with it
rather than building its own proxy. See the decision record in memory
(`project_litellm-gateway-decision`).

### 1.1 Validated behaviour (the evidence this spec is built on)

Confirmed live on 2026-06-09:

- **One gateway, both wire formats.** OpenAI `/v1/chat/completions` and Anthropic
  `/v1/messages` both route to Ollama and return split `usage` inline. So every
  harness routes through one endpoint — OpenAI-format for most, `/v1/messages` for
  claude-code.
- **Native tool calls survive the gateway.** The homelab registers Ollama via
  `ollama_chat/` (→ `…:11434/api/chat`). A raw tools call returned
  `finish_reason: tool_calls` + a populated `message.tool_calls`; a real **crush**
  run through the gateway created a file via a native tool call. The old `ollama/`
  text-mangling bug does **not** apply.
- **`/spend/logs` is the token source.** Per request it records split
  `prompt_tokens` / `completion_tokens` / `total_tokens`, `request_id`
  (= the `chatcmpl-…` response id), the `api_key` (sha256 hash), provider, and a
  `metadata.usage_object` (reasoning/cache tiers). Flush ≈ 1–2 min.
- **Per-run attribution is trivial.** `POST /key/generate` (with `duration`,
  `models`, `metadata`) → inject as the harness API key → `GET /spend/logs?api_key=
  <PLAINTEXT key>` returns exactly that run's rows. A 3-turn crush run summed
  correctly across all turns. No hashing, no time-window guessing.
- **Cost is $0 for local models** → attribute by **tokens, not spend**.

## 2. Goals

- Route any harness through the LiteLLM gateway with one provider config.
- Get **accurate, uniform, split in/out token counts per run** from `/spend/logs`,
  replacing the brittle per-adapter parsing where the gateway is in use.
- Keep it **optional and pluggable**: per-adapter parsing stays the default/fallback;
  the LiteLLM backend is used only when a gateway is configured.
- (Nice-to-have) record enough to deep-link a run to its Langfuse trace.

## 3. Non-goals

- No cost computation anywhere (decided).
- No live per-turn TUI streaming / wire-level activity guard (that was the own-proxy;
  shelved). The activity guard keeps its current stdout/jsonl behaviour for now.
- No change to how harnesses *do* their work — only how they're pointed at a model
  and how tokens are gathered afterwards.

## 4. Design

### 4.1 Config

A provider of type `litellm` in `~/.config/cpe/config.json` (global, untracked):

```jsonc
{
  "providers": [
    {
      "name": "homelab-litellm",
      "type": "litellm",
      "anthropic_base_url": "https://litellm.lab.richardbenson.co.uk",  // the gateway root (reuses the existing field)
      "admin_key_env": "CPE_LITELLM_KEY",   // default; admin key read from env, never stored in file
      "models": ["gemma4-cpe:31b", "qwen3-coder-cpe:30b"],
      "default_model": "gemma4-cpe:31b"
    }
  ]
}
```

- The **admin key** (needs `/key/generate`, `/key/delete`, `/spend/logs`) is read
  from an env var by default (`admin_key_env`), so it never lands in the config
  file. An inline `admin_key` is allowed but discouraged.
- `base_url` is the gateway root; OpenAI routes hang off `/v1`, Anthropic off
  `/v1/messages`.

### 4.2 Per-run key lifecycle

For each run (bench combo, phase, or single-prompt), the runner:

1. **Mint** an ephemeral key: `POST /key/generate` with
   `{ duration, models: [<model>] }`. `duration` = **2 × `max_runtime_seconds`** (can't
   expire mid-run, and a crash can't orphan a valid key for long since it still
   auto-expires).
2. **Inject** into the harness env (see 4.3).
3. **Run** the harness unchanged.
4. **Collect tokens** (see 4.4).
5. **Revoke** the key: `POST /key/delete { keys: [<key>] }` (best-effort; it also
   auto-expires).

If `/key/generate` fails, fall back to using a non-ephemeral configured key (or the
admin key) for routing and attribute by time-window — degraded but functional.

### 4.3 Env injection per harness

(As built.) Inspection of the adapters showed every one already derives its
endpoint from `ANTHROPIC_BASE_URL` (appending `/v1` itself for OpenAI-compat
configs) and its key from `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` — so the
gateway slots into the **existing provider-env shape**, no new var families:

| Var | Value |
|---|---|
| `ANTHROPIC_BASE_URL` | gateway root (adapters append `/v1`; claude-code uses `/v1/messages`) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | the ephemeral run key |
| `CPE_GATEWAY=openai-compat` | hint for adapters whose default protocol is Ollama-native |

The one outlier was **goose**, whose default provider speaks the Ollama-native
`/api/*` API (which LiteLLM does not serve): on `CPE_GATEWAY=openai-compat` the
goose adapter switches to goose's `openai` provider
(`OPENAI_HOST=<gateway>`, `OPENAI_API_KEY=<run key>`). The model arg is the
LiteLLM alias (e.g. `qwen3-coder-cpe:30b`), passed through each adapter's
existing model wiring.

### 4.4 Token-stats source (pluggable)

A `TokenSource` abstraction with two backends:

- **litellm** (when a `litellm` provider is active): after the run completes, poll
  `GET /spend/logs?api_key=<run key>` over the flush window (bounded at **~3 min**)
  and **sum** `prompt_tokens` / `completion_tokens` across all rows. Rows flush in
  batches, so the first non-empty read can be **partial** (observed 2026-06-10: a
  short crush run's title-generation row flushed a poll ahead of its agent rows,
  recording 375 tokens instead of 10.9k) — totals are only trusted once **two
  consecutive polls agree**; on budget exhaustion the best snapshot seen is used.
  This **fully replaces** the per-adapter tokens (it's the more accurate option).
  Only the summed in/out totals are stored — per-turn detail is left to Langfuse
  (§4.5).
- **per-adapter** (fallback only): today's `HarnessResult.tokens` (incl. the crush
  `--debug` fix). Used when no LiteLLM provider is configured, or when spend-logs
  stays empty past the ~3 min retry budget.

Priority: **litellm spend-logs → per-adapter → none.** The result/meta records which
source was used.

### 4.5 Langfuse deep-linking (DEFERRED — what it would give)

LiteLLM forwards every call to Langfuse as a *generation* inside a *trace* (groupable
into *sessions*, labelled with tags/metadata). A "deep-link" means cpe stores an
identifier so that from a cpe run (TUI/report) you jump straight to that run's Langfuse
view, which shows, **turn by turn**: the exact prompt sent, the full model output
(including reasoning/`thinking` blocks), tool calls + arguments, latency, tokens, and
errors — rendered properly. That is the real "why did this no-op / flail / take 90 min"
debugger, and it's why per-turn storage isn't needed in cpe (decision 7, §6).

**Deferred to a later phase**, because a *precise* link needs a run's calls grouped in
Langfuse under a known `session_id`/`trace_id`, and (like tagging, §4.6) we can only set
that via the per-run key's metadata *if* LiteLLM forwards it to Langfuse as a session —
which needs Langfuse API keys to verify. Until then a deep-link can only be a
time+model filtered search, not an exact trace. The token goal doesn't depend on it.

### 4.6 Attribution & tagging (investigated — why per-run key)

Investigated whether a per-run **tag/run_id** could replace the per-run key. Findings
(verified live against the gateway):

- A key's `metadata.tags` / `metadata.run_id` do **NOT** surface in spend-log rows
  (confirmed `null` across rows) — not a usable query handle.
- `request_tags` IS populated and even auto-captures the `User-Agent` (e.g.
  `Charm-Crush` vs `curl`), plus any **key-level `tags`** (the admin key already
  carries `["desktop","cpe"]`, which is how they appear). So key-level tags propagate.
- Per-*request* tagging (the `x-litellm-tags` header / body metadata) works, but
  setting it requires **injecting into the harness's own request** — which we don't
  control for opaque harnesses and won't do (no traffic mutation).

**Conclusion:** the only reliable per-run signal that needs no harness cooperation and
no traffic mutation is a **per-run key**. A per-run *tag* would still have to be carried
*on* a per-run key, so it adds nothing over filtering `/spend/logs?api_key=<key>`, which
is simpler. (Tags remain useful for *cross-run* grouping, e.g. the existing `cpe` tag.)

### 4.7 Failure & edge handling

- **Gateway unreachable at run start** → fail the run fast with a clear
  `litellm-unreachable` reason (don't silently fall back to a different endpoint).
- **`/key/generate` fails** → degraded fallback (4.2).
- **Spend-logs empty past retry budget** → fall back to per-adapter tokens; mark the
  token source accordingly (not a run failure).
- **Key revoke fails** → log + ignore (auto-expires).
- The admin key is never written to a tracked file and never logged.

### 4.8 Gateway prerequisites (found the hard way, 2026-06-10)

Two LiteLLM-side settings are required for the full harness set; both were
discovered by running real matrices (see `docs/logs/2026-06-10-vague-prompt/`):

1. **`litellm_settings: drop_params: true`** — codex sends `parallel_tool_calls`
   and `web_search_options` on every request; `ollama_chat` rejects them with an
   instant 400 (`UnsupportedParamsError`) unless the gateway drops unsupported
   params.
2. **Streaming `finish_reason` fix for `ollama_chat`** — Ollama sends tool_calls
   and `done: true` in separate chunks, and LiteLLM (≤ 1.88.1, still open in
   1.89.0-rc.1) reports the final streamed chunk as `finish_reason: "stop"` even
   when tool calls were emitted. Strict OpenAI clients (crush) end the turn
   without executing the tool — a silent no-op. Non-streaming is unaffected.
   The deployed gateway carries a local patch of the open upstream fix
   ([BerriAI/litellm#20585](https://github.com/BerriAI/litellm/pull/20585),
   `litellm/llms/ollama/chat/transformation.py`); **drop the override once that
   PR ships in a release** (re-verify on every LiteLLM upgrade with a streamed
   tools call: the final chunk must say `finish_reason: "tool_calls"`).

**Non-prerequisite (investigated, closed):** LiteLLM "prompt caching" is a
passthrough of cloud-provider cache accounting; Ollama isn't supported, so there
is nothing to enable and `cache_read_input_tokens` stays 0 for Ollama-backed
models. Ollama's own KV/prefix cache already delivers the latency benefit
silently (verified ~27× faster prompt eval on a repeated prefix) with no usage
accounting — so spend-log tokens are the honest cross-harness comparison metric
but overstate local compute for harnesses with large constant prefixes
(claude-code re-sends ~21.5k tokens of tool definitions per turn).

## 5. Code changes (as built)

- **config** ([types/meta.ts](src/types/meta.ts)): `ProviderEntry.type: 'litellm'`
  + `admin_key_env`/`admin_key`; `tokens`/`token_source` on `RunMeta` (single-prompt
  totals) and `PhaseEntry` (per-phase totals).
- **new [litellm.ts](src/runner/litellm.ts)**: `litellmGateway()` (config → handle,
  loud errors), `generateRunKey()`, `revokeRunKey()`, `sumSpendRows()`,
  `fetchSpendTotals()`, `collectSpendTotals()` (flush polling), and
  `settleLitellmRun()` — the one call dispatch sites make (collect + revoke).
  All fail-safe: collection failure is never a run failure.
- **[provider.ts](src/runner/provider.ts)**: `resolveProvider(..., opts)` mints the
  per-run key when `litellmKeySeconds` is passed (auxiliary calls omit it → admin-key
  routing, no collection); `ResolvedProvider.litellm` carries the handle; default
  health check `/health/readiness`; explicit-selection unreachable → throws.
- **dispatch**: [single-prompt.ts](src/runner/single-prompt.ts) (structured, opaque,
  bench) + [phase-loop.ts](src/runner/phase-loop.ts) (structured, opaque) settle on
  their completion paths; bench settles on ANY outcome (a timed-out run still
  consumed tokens). Failure/retry paths leave keys to auto-expire (decision 2).
- **[capture.ts](src/runner/capture.ts)**: bench `meta.json` records the override
  tokens + `token_source`.
- **[goose.ts](src/harness/goose.ts)**: `gooseProviderEnv()` — OpenAI provider mode
  on `CPE_GATEWAY` (LiteLLM doesn't serve the Ollama-native API).
- **tests** (15 new): [litellm.test.ts](src/runner/litellm.test.ts) against a fake
  gateway (Bun.serve) with response shapes copied from the live validation;
  provider-resolution (mint/degrade/aux/unreachable/no-model); goose env mapping.

## 6. Resolved decisions

1. **Admin key storage** — env var **`CPE_LITELLM_KEY`** (never in a tracked file).
2. **Key duration & revoke** — `duration = 2 × max_runtime_seconds`; **revoke** at
   run end best-effort; auto-expiry catches crashes.
3. **Spend-logs authority** — when available, spend-logs **fully replace** per-adapter
   tokens (the more accurate option); per-adapter is fallback only.
4. **Retry budget** — poll spend-logs up to **~3 min** then fall back. Acceptable.
5. **Routing scope** — route through the gateway only when a `litellm` provider is
   **explicitly selected**. (On this machine the other providers will be removed
   anyway, so it'll be the de-facto default there.)
6. **Langfuse linking** — **deferred** (see §4.5 for what it would give and why).
7. **Per-turn storage** — **summed totals only**; per-turn detail lives in Langfuse.
8. **Attribution** — **per-run key** (tagging investigated and rejected, §4.6).

## 7. Verification (intended)

- Unit: litellm client against mocked responses (key gen/delete, spend-logs
  shapes incl. empty + multi-row); token-source priority & fallback; env mapping.
- Integration (against the live homelab gateway): a small single-prompt run on an
  opaque harness → key minted, file changed via native tool call, `/spend/logs`
  returns split tokens for the key, key revoked. (Mirrors the manual validation
  already done with crush + qwen3-coder-cpe:30b.)
- Regression: with no `litellm` provider configured, behaviour is byte-for-byte
  today's (per-adapter tokens, direct provider env).
