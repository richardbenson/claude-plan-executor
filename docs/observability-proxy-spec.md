# Observability Proxy — Specification

**Status:** SHELVED. Superseded by [litellm-integration-spec.md](litellm-integration-spec.md)
for the token-accuracy and diagnosis goals (the user runs a homelab LiteLLM + Langfuse
gateway, validated 2026-06-09). This own-proxy design is kept only as a reference /
possible-future for the one niche LiteLLM doesn't serve well: live per-turn TUI
rendering and wire-level activity-guard liveness. Not an active plan.

## 1. Motivation

Everything cpe currently knows about a run is scraped *after the fact* from each
harness's idiosyncratic stdout/JSONL — pi dumps 33 MB, crush needs `--debug` to
expose token usage, claude-code emits a structured envelope, openhands toggles
`is_error`. Token counts are inconsistent (see [the archived homelab matrix](logs/2026-06-07-homelab-matrix/README.md)),
the activity guard infers liveness by tailing heterogeneous output, and the TUI
can only render whatever it manages to parse per harness.

All 10 harnesses already receive their model endpoint from cpe via env
(`ANTHROPIC_BASE_URL`, and `OPENAI_API_BASE` for some). That is the one place they
are identical: the wire to the model. A proxy sitting there sees **every request
and response, in order, for every harness, in the same shape** — and turns 10
divergent output streams into one uniform, structured event stream.

This started as a need for accurate token tracking, but the same component is the
backbone for reliable logging (storage), liveness detection, and a consistent TUI.

## 2. Goals

- Accurate, uniform, harness-agnostic token counts, **split input vs output**.
- A single normalized event stream that serves storage, the activity guard, and
  the TUI from one artifact.
- Reliable liveness detection (a real "model was called N seconds ago" signal).
- A foundation for automatic failure-mode detection (empty responses, tool calls
  returned as text, stream drops) — as a later consumer, not core.

## 3. Non-goals (explicitly out of scope)

- **Cost.** No cost computation, pricing table, or synthetic-cost overlay anywhere.
  Cost is a separate concern and the harnesses' own numbers are unreliable; the
  proxy deals only in tokens that actually crossed the wire.
- **Mutation / normalization of traffic.** v1 is a pure observer (see R2).
- **Concurrent runs.** bench is sequential; the design is concurrency-*ready*
  (per-run listeners) but does not add a concurrent execution mode.
- The failure-detector itself (the lints) is a downstream consumer, likely a later
  phase; this spec only guarantees the event data it would need.

## 4. Decisions log

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Mutation policy | **Pure observer, zero mutation** | Keep all logic out of the delivery lane (R0). Consequence: OpenAI-compat streams without `include_usage` report no wire usage → per-adapter token parsing stays as fallback. |
| D2 | Process model | **Separate, long-lived child process** | Isolate the proxy's crash domain from cpe. A proxy crash fails the affected run, not cpe. |
| D3 | Storage | **Augment** | Keep each harness's raw transcript for deep debugging; add a uniform normalized log as the primary, comparable record. |
| D4 | Attribution | **Per-run listener (port-per-run)** | A long-lived proxy serving many runs avoids tagging races by binding a dedicated localhost port per run; attribution is implicit by port. |
| D5 | Upstream schemes | **http + https in v1** | Cover local models (http) and hosted providers (https) from the start. |
| D6 | Log granularity | **Metadata + metrics + capped content previews** | Self-contained for TUI/debugging without cross-referencing the raw transcript; bounded so it can't balloon. |
| D7 | Token tiers | **in/out core; cache/reasoning opportunistic** | in/out is the real requirement; extra tiers recorded only if the wire provides them (near-free), nothing depends on them. |

## 5. Architecture

```
                cpe (session)
                  │  spawn at session start, SIGTERM at end
                  ▼
   ┌──────────────────────────────────────────┐
   │  observability-proxy  (long-lived child)   │
   │                                            │
   │  control API  (127.0.0.1, /__cpe/ prefix)  │◄── open_run / close_run  (cpe)
   │                                            │
   │  per-run listener :PORT_A  ─┐              │
   │  per-run listener :PORT_B  ─┤ delivery lane │
   │                             │  (byte relay) │──────────────► upstream (http/https)
   │       harness ──────────────┘              │◄──────────────  (provider/Ollama)
   │                             │ tee (copy)    │
   │                             ▼               │
   │                    observation lane         │
   │                  (best-effort parsers)      │
   │                             │               │
   └─────────────────────────────┼──────────────┘
                                  ▼
                    <run>/events.ndjson   ◄── tailed by: token sum,
                    (storage + IPC + activity + TUI feed)   activity guard,
                                                            TUI, failure-detector
```

The normalized event log is the single artifact shared by every cpe-side consumer
— it is simultaneously the storage record, the IPC channel from the child process,
the activity-guard source, and the TUI feed. There is no bespoke IPC protocol.

## 6. Requirements

### R0 — Delivery is independent of observation *(the spine)*

- **Two lanes, no shared failure domain.** A *delivery lane* (transparent
  client⇄upstream byte relay) and an *observation lane* (a tee'd copy). This
  separation lives **inside the proxy**.
- **Forward before parse, always.** Request bytes go upstream and response bytes
  go back to the client *without waiting on any parse*. Parsing runs on the copy,
  concurrently or after — never inline.
- **Observation is best-effort and droppable.** Any parser exception, malformed or
  partial chunk, unknown endpoint/format, or a *slow* consumer must not delay,
  alter, truncate, or drop one delivered byte. On overload the proxy drops
  **observability data** (bounded buffer), never payload.
- **Unknown traffic is relayed verbatim** and simply not observed (model probes,
  `/api/tags`, embeddings, unexpected formats/methods).
- **Observer throws are swallowed** into the proxy's own diagnostics, never the run.
- **Corollary:** a parse failure is neither a delivery failure nor a run failure.
  A turn we cannot parse still reaches the harness; we record it as `parsed:false`
  and lose only that turn's metrics. Run success never depends on the observability
  layer working.

### R1 — Transparent reverse proxy

- Serve **http on 127.0.0.1** (per-run listener). Forward the request's
  path + query + headers + body to the run's configured upstream, and stream the
  response back **byte-faithful**: status code, response headers, SSE framing,
  content compression, and chunked/`Content-Length` transfer all preserved.
- Rewrite the `Host` header to the upstream host; handle hop-by-hop headers
  (`Connection`, `Keep-Alive`, `TE`, `Transfer-Encoding`) per RFC; preserve
  `Authorization`, `Content-Type`, `Accept`, and all other headers untouched.
- Relay **compressed bodies verbatim**; the observer decompresses its *own* copy.
- Forwarding is at the HTTP-semantic layer (terminate client request → make an
  outbound request → stream response), not raw TCP tunnelling, because bodies must
  be observable.

### R2 — Zero mutation (pure observer)

- The proxy never alters harness↔upstream payloads, headers (beyond reverse-proxy
  hygiene in R1), or query — including no injection of `stream_options.include_usage`.
- **Consequence:** OpenAI-compatible streaming requests that don't already request
  usage will not expose token counts on the wire. Per-adapter token parsing
  (including the crush `--debug` path) is **retained as the fallback** for those
  turns. Token source priority: wire usage (proxy) → per-adapter parse.

### R3 — Process model & crash domain

- One **long-lived child process** spawned by cpe at session start.
- If the proxy dies mid-stream, the affected harness's requests fail, so **that run
  fails — but cpe stays up**, detects the child's exit, and records a distinct
  `proxy-died` failure (not a silent harness no-op).

### R4 — Attribution: per-run listener + control API

- A control API on the reserved **`/__cpe/`** path prefix (localhost only; never
  forwarded — harnesses only hit `/v1/...` and `/api/...`):
  - `open_run { run_id, upstream, events_path } → { port }` — binds a fresh
    127.0.0.1 port dedicated to that run, wired to its upstream and events file.
  - `close_run { run_id }` — drains in-flight requests, flushes the events file,
    closes the port.
- cpe injects the returned port into the harness env for that run. **Attribution is
  by listener**: one port ↔ one run, so there is no event tagging and no
  run-boundary race (a late response from run N stays on run N's port/file). The
  upstream is set per run via `open_run`, so different runs may target different
  providers within one session.

### R5 — Upstream schemes

- Support **both http and https** upstreams in v1. Outbound https uses normal TLS
  with certificate verification.
- **Open risk (verify before locking):** the harness→proxy hop is http on
  localhost. Some hosted-provider SDKs may refuse a non-`https` base URL. If a
  harness/SDK rejects an http proxy URL, R5 additionally needs **localhost TLS**
  (a self-signed cert the harness trusts), which is extra work. claude-against-Ollama
  is known to tolerate http; the Anthropic SDK pointed at `api.anthropic.com`
  through an http proxy URL must be checked.

### R6 — Normalized event log (the keystone)

- One **NDJSON** file per run at the `events_path` given to `open_run`. It is the
  storage record, the IPC channel, the activity source, and the TUI feed.
- Every line: `{ ts, run_id, seq, kind, ... }`. `seq` increments per request and
  pairs a `request` with its `response`.

```jsonc
// kind: "request" — emitted when a request arrives (covers ALL traffic)
{ "ts": "...", "run_id": "...", "seq": 7, "kind": "request",
  "format": "openai-chat",            // anthropic | openai-chat | openai-responses | ollama | unknown
  "method": "POST", "path": "/v1/chat/completions",
  "model": "gemma4-cpe:31b", "stream": true, "n_messages": 14,
  "prompt_preview": "…last user message, truncated…" }

// kind: "response" — emitted when the response completes
{ "ts": "...", "run_id": "...", "seq": 7, "kind": "response",
  "status": 200, "latency_ms": 8123, "format": "openai-chat", "parsed": true,
  "input_tokens": 10268, "output_tokens": 140,         // CORE, always split
  "cache_read_tokens": 0, "cache_write_tokens": 0,     // opportunistic (omit if absent)
  "reasoning_tokens": 0,                               // opportunistic
  "finish_reason": "tool_calls",
  "tool_calls": ["edit_file"], "text_len": 320, "empty": false,
  "text_preview": "…assistant text, truncated…" }

// kind: "proxy_error" — delivery/upstream problems
{ "ts": "...", "run_id": "...", "seq": 8, "kind": "proxy_error",
  "detail": "upstream_unreachable", "status": 502 }
```

- An unparseable response still emits a `response` line with `parsed:false` (status
  + latency known); the request line is always emitted, so the log captures the
  timing of every request even for `format:"unknown"`.

### R7 — Granularity: metadata + capped content previews

- Store metadata + metrics (tokens, latency, status, finish_reason, tool-call
  names, text length, flags) **plus capped content previews** (`prompt_preview`,
  `text_preview`, truncated tool-call args).
- The observer uses **bounded buffers** and stops accumulating at the preview cap;
  it never holds whole bodies. Caps are configurable (e.g. ~2 KB per preview).
- Previews are stored **locally only**; for hosted providers they may contain
  sensitive prompt content (the full content remains in the raw transcript too,
  per D3).

### R8 — Per-format observers (best-effort)

Each parser maps its provider's fields to the canonical token names; failures are
safe (R0). Coverage:

| Format | Endpoint | input | output | cache / reasoning |
|---|---|---|---|---|
| anthropic | `/v1/messages` | `usage.input_tokens` | `message_delta.usage.output_tokens` | `cache_read_input_tokens`, `cache_creation_input_tokens` |
| openai-chat | `/v1/chat/completions` | `usage.prompt_tokens` | `usage.completion_tokens` | `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens` |
| openai-responses | `/v1/responses` | `usage.input_tokens` | `usage.output_tokens` | `input_tokens_details.cached_tokens`, `output_tokens_details.reasoning_tokens` |
| ollama | `/api/chat`, `/api/generate` | `prompt_eval_count` | `eval_count` | — (no caching) |
| unknown | any | — | — | — (`parsed:false`, still logged) |

Streaming: usage typically arrives in the final chunk/event — the observer
accumulates per response and emits the `response` line at stream end.

### R9 — Consumers (read the event log)

- **Token accounting:** sum `input_tokens` / `output_tokens` per run (kept split);
  proxy wire usage primary, per-adapter parse fallback (R2).
- **Activity guard:** last line's `ts` = liveness (covers all traffic, including
  `format:"unknown"`). Augments/supersedes the current stdout tail in
  [run-guard.ts](src/runner/run-guard.ts).
- **TUI:** live render of split in/out token totals, turn count (`seq`), last
  `tool_calls`, last status/latency.
- **Failure-detector (later):** lints over the log — `empty:true`, non-2xx,
  `proxy_error`, or tool-call-shaped `text_preview` with `finish_reason:"stop"`
  (the openhands "tool call as text" bug).

### R10 — Lifecycle

- cpe spawns the proxy at session start and waits for readiness (the proxy reports
  ready + control port on stdout or a ready-file); fail fast if not ready.
- Per run: `open_run` → inject the returned port into the harness env (replacing the
  host:port in `ANTHROPIC_BASE_URL` / `OPENAI_API_BASE`, preserving any `/v1`
  suffix) → run the harness → `close_run`.
- At session end: SIGTERM with a drain timeout, then SIGKILL.

### R11 — Error transparency

- Upstream 4xx/5xx are relayed verbatim to the client and logged as a `response`
  with the real status. Upstream unreachable → return **502** to the client and
  emit a `proxy_error`. The proxy never synthesizes a success.

## 7. Verification (intended)

- **Passthrough integrity:** a fake upstream returns a known SSE stream; assert the
  client receives a byte-identical stream **even when the observer parser is forced
  to throw** (R0).
- **Fail-open:** inject parser exceptions, malformed/partial chunks, and unknown
  content-types → delivery unaffected; offending turns recorded `parsed:false`.
- **Backpressure:** a deliberately slow observer → the client stream stays timely;
  observability data is dropped, payload is not.
- **Per-format parsers:** unit tests against captured fixtures (we already have real
  transcripts and a real crush `--debug` HTTP log to draw from).
- **Attribution:** two sequential `open_run`/`close_run` cycles write to separate
  event files; a response that lands after `close_run` of run N still lands in run
  N's file (per-listener attribution).
- **Crash domain:** kill the proxy mid-run → the run is marked `proxy-died` and cpe
  survives to continue/report.

## 8. Open items

- **R5 localhost-TLS risk** — verify whether any harness/SDK refuses an http proxy
  URL before committing to https-upstream-only-without-localhost-TLS.
- Exact per-harness env-URL rewrite (which var, preserving path suffixes) to be
  enumerated during planning.
- Preview cap sizes and the observer's bounded-queue drop policy to be fixed during
  planning.
