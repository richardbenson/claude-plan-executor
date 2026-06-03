# Running claude-code on a local model (Ollama)

Goal: run `claude-code` (and therefore cpe) on a **local** model —
`gemma4-cpe:31b` on Ollama — at **zero Anthropic API cost**.

## TL;DR — no proxy needed

Modern Ollama (verified on **0.30.2**) **natively serves the Anthropic Messages
API** at `/v1/messages`, including faithful **tool use**. Claude Code talks the
Anthropic API; you just point it straight at Ollama. No translation proxy is
required — setting the env vars is enough:

```bash
ANTHROPIC_BASE_URL=http://192.168.1.3:11434 \
ANTHROPIC_AUTH_TOKEN=ollama \
claude -p "…" --model gemma4-cpe:31b
```

cpe already injects exactly these via `buildProviderEnv` (`src/runner/provider.ts`)
from a `ProviderEntry`, so all you do is add a provider.

> Note: an earlier version of this phase assumed a translation proxy was
> required (true for older Ollama, before it gained native Anthropic support).
> It isn't for current Ollama. The proxy survives only as an optional fallback —
> see the appendix.

## Use it from cpe

Add a provider (an *endpoint*) pointing straight at Ollama with `cpe provider
add`. A provider serves many models; pick one per-run with `--model`, else the
`default_model`. Example answers for a local Ollama box (substitute your own
host — nothing here is hardcoded in the tool):

```
cpe provider add
  Name:                              local-ollama
  Models (comma-separated):          gemma4-cpe:31b, gemma4-cpe:26b
  Default model:                     gemma4-cpe:31b
  ANTHROPIC_BASE_URL:                http://<ollama-host>:11434
  ANTHROPIC_AUTH_TOKEN:              ollama        # Ollama ignores it; any value
  Health check URL:                  /api/tags     # cheap GET, 5s probe

cpe provider test local-ollama       # -> ✓ available
```

The `health_check_url` is probed by `resolveProvider` with a 5s timeout — if
Ollama is down the provider is skipped/surfaced, not hung.

This matches how the repo's other Ollama providers are already configured. Then
run cpe against it — set it as the phase default or pass per-run:

```bash
cpe prompt --provider desktop-ollama "…"
```

The eventual k3s endpoint is `http://ollama.ollama.svc.homelab.cluster:11434`
(set `CPE_OLLAMA_BASE_URL` to it when running there).

## Validation (reproducible from scratch)

All run against `gemma4-cpe:31b` (Ollama capability list includes `tools`),
**directly, no proxy**. No traffic reaches `api.anthropic.com`.

1. **Native Anthropic tool call** — raw Ollama returns an Anthropic `tool_use`
   block:
   ```bash
   curl -s http://192.168.1.3:11434/v1/messages \
     -H 'Content-Type: application/json' -H 'anthropic-version: 2023-06-01' \
     -d '{"model":"gemma4-cpe:31b","max_tokens":256,
          "messages":[{"role":"user","content":"Weather in Paris? Use the tool."}],
          "tools":[{"name":"get_weather","description":"Get weather",
            "input_schema":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}]}'
   # -> stop_reason: "tool_use", content has tool_use get_weather {"city":"Paris"}
   ```

2. **Real `claude -p` editing a file**, pointed straight at Ollama:
   ```bash
   mkdir -p /tmp/cpe-local && cd /tmp/cpe-local && git init -q
   ANTHROPIC_BASE_URL=http://192.168.1.3:11434 ANTHROPIC_AUTH_TOKEN=ollama \
     claude -p "Create noproxy.txt containing exactly: NO-PROXY-OK. Then stop." \
     --model gemma4-cpe:31b --dangerously-skip-permissions
   cat noproxy.txt   # -> NO-PROXY-OK
   ```

3. **Full cpe single-prompt run** using a local Ollama provider
   (`provider_for_phases` pointed at it): the local model made edit/bash tool
   calls, created and committed a file, emitted valid structured output, and the
   run reached status `complete` (PR step correctly skipped — throwaway repo had
   no remote), with zero Anthropic traffic.

### Notes

- **Cost field:** the envelope's `total_cost_usd` is a *synthetic* estimate, not
  an Anthropic charge — real Anthropic API spend is zero (a real call would fail
  on the dummy key). Treat that number as informational only.
- Tool translation: no mangling observed for `gemma4-cpe:31b`; `input_schema` ↔
  tool params and `tool_use` round-trip correctly. Malformed tool JSON from a
  future model would be a model-quality issue, not an endpoint one.

---

## Appendix — optional LiteLLM proxy (only for non-Anthropic-native backends)

You only need a translation proxy if the backend does **not** natively speak the
Anthropic Messages API — e.g. **older Ollama** (pre-native-Anthropic), or routing
to **OpenAI / other OpenAI-compatible providers**, or if you want LiteLLM
features (multi-backend routing, request logging, cost tracking).

In that case, [`docker-compose.yml`](docker-compose.yml) +
[`litellm-config.yaml`](litellm-config.yaml) stand up LiteLLM exposing an
Anthropic `/v1/messages` endpoint that forwards to an OpenAI-compatible backend:

```bash
docker compose -f docs/harness-bench/docker-compose.yml up -d
curl -s http://localhost:4000/health/liveliness     # -> "I'm alive!"
```

Then point a provider at the proxy instead of the backend:
`anthropic_base_url=http://localhost:4000`, `health_check_url=/health/liveliness`,
`anthropic_auth_token=<LITELLM_MASTER_KEY>`. Env knobs: `OLLAMA_OPENAI_BASE_URL`
(the backend's `/v1`), `OLLAMA_API_KEY`, `LITELLM_MASTER_KEY`. This was verified
to translate Anthropic tool calls faithfully too — it's just unnecessary for
current Ollama.
