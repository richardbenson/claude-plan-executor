# Phase 03 - Anthropic->Ollama proxy + local-model provider preset

## Summary
Stand up an Anthropic-format proxy in front of Ollama and add a provider preset so `claude-code` can
run `gemma4-cpe:31b` locally at zero Anthropic API cost. This is the **immediate cost escape** and it
also lets Phases 04-06 be validated using claude-on-local for free.

## Context
- cpe already injects `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` via
  `buildProviderEnv` in `src/runner/provider.ts`; a `ProviderEntry` (`src/types/meta.ts`) holds
  `name`, `model`, `anthropic_base_url`, `anthropic_api_key`, `anthropic_auth_token`,
  `health_check_url`. `resolveProvider` runs a `health_check_url` probe.
- Ollama exposes an OpenAI-compatible API at `http://192.168.1.3:11434/v1` (desktop) and
  `http://ollama.ollama.svc.homelab.cluster:11434/v1` (k3s). The desktop runs `gemma4-cpe:31b`.
- Claude Code speaks the Anthropic Messages API, so a translation proxy (Anthropic <-> OpenAI/Ollama)
  is required. Evaluate LiteLLM (Anthropic passthrough/`anthropic` route) vs a minimal dedicated
  shim; pick one and document why.

## Approach
- Provide a documented, reproducible proxy setup (compose file or run command) that exposes an
  Anthropic-format endpoint forwarding to Ollama's `gemma4-cpe:31b`. Verify tool-call translation
  works (Claude Code relies on tool use heavily).
- Add a `ProviderEntry` preset (e.g. `desktop-ollama-anthropic`) with `anthropic_base_url` -> proxy,
  `model` -> `gemma4-cpe:31b`, and a `health_check_url`. Make it addable via the existing
  `provider add` flow (`src/commands/provider.ts`) - a documented preset or a small helper.
- Validate: a default claude-code run using that provider executes a real prompt against the local
  model with no Anthropic API calls.

## Files expected to change
- `docs/harness-bench/proxy.md` (new) - proxy setup, the chosen tool, the compose/run command, and
  the validation steps.
- `src/commands/provider.ts` - optionally add a `--preset` shortcut or document the exact add inputs.
- `src/config/repo-config.ts` and/or `src/types/meta.ts` - only if a preset needs a small config hook.
- A sample/compose artifact for the proxy under `docs/harness-bench/` (kept out of the runtime path).

## Note
This phase is config/enablement, not a new harness adapter. It is intentionally early to satisfy the
`claude -p` cost deadline and to make later validation free.
