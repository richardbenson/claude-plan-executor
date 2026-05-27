# Provider Selection

Add support for running Claude sessions with alternative models and providers (e.g. local Ollama, custom API proxies) by injecting `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `--model` into every Claude spawn.

## Docs

- [PROGRESS.md](./PROGRESS.md) — phase status table
- [PHASE_01.md](./PHASE_01.md) / [PHASE_01.prompt.md](./PHASE_01.prompt.md) — Provider types & resolver
- [PHASE_02.md](./PHASE_02.md) / [PHASE_02.prompt.md](./PHASE_02.prompt.md) — Wire provider into all sessions
- [PHASE_03.md](./PHASE_03.md) / [PHASE_03.prompt.md](./PHASE_03.prompt.md) — `cpe provider` CLI subcommand

## Requirements

- Each provider entry carries: `name`, optional `model`, optional `anthropic_base_url`, optional `anthropic_api_key`, optional `anthropic_auth_token`, optional `health_check_url` (full URL or path relative to `anthropic_base_url`).
- Providers are listed in priority order. Before using a provider, cpe GETs its `health_check_url` (5 s timeout). If the response is not 2xx, that provider is skipped.
- If no provider passes its health check, cpe silently falls back to bare Anthropic (no extra env vars or `--model`).
- Two roles: `provider_for_planning` and `provider_for_phases`. Each names a preferred provider. If that provider fails its health check, cpe falls back through the list in order.
- The provider list lives in `~/.config/cpe/config.json` (global). A repo's `cpe.config.json` can fully override it (including defining its own entries) via the same `providers`, `provider_for_planning`, `provider_for_phases` fields.
- `start.ts` merges repo-level provider config into `effectiveConfig` so runners never need to read `RepoConfig` directly.
- Provider selection applies to **all** Claude spawns: interactive planning, headless phases, single-prompt, bootstrap detect, finalise, and rate-limit resume.
- The default last-resort is always bare Anthropic — no args, no env vars, no config needed.
- `cpe provider list` — tabular view of configured providers.
- `cpe provider add` — interactive wizard (name, model, base URL, API key, auth token, health check URL).
- `cpe provider remove <name>` — removes provider by name, errors if not found.
- `cpe provider test [name]` — runs health check for one or all providers and prints pass/fail.

## Definition of Done

- [ ] `ProviderEntry` type is defined and exported from `src/types/meta.ts`.
- [ ] `AppConfig` and `RepoConfig` both accept `providers`, `provider_for_planning`, `provider_for_phases`.
- [ ] `resolveProvider(providers, role, nameOverride)` returns a `ResolvedProvider | null`; null triggers bare Anthropic fallback.
- [ ] Health check is performed with a 5 s timeout; providers without `health_check_url` are assumed available.
- [ ] Every `Bun.spawn(['claude', ...])` in the codebase injects env vars and `--model` when a provider is resolved.
- [ ] `cpe provider list/add/remove/test` subcommands are reachable and work against `~/.config/cpe/config.json`.
- [ ] Existing behaviour is unchanged when no `providers` key is present in config.
- [ ] `bun run build` passes with no type errors.
- [ ] `bun test` passes.
