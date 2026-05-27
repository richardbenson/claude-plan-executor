# Phase 1 — Provider types & resolver

## Summary

Define the `ProviderEntry` data model, extend `AppConfig` and `RepoConfig` to carry provider configuration, and implement the provider resolution + health-check logic in a new `src/runner/provider.ts` module. No session-spawning behaviour changes in this phase — everything is pure data and logic that Phase 2 will wire up.

## Context

All Claude invocations today are bare `['claude', ...]` spawns with no env-var injection. The goal of this phase is to build the foundation: types that describe a provider, and a resolver that picks the right one (or returns `null` to mean "use bare Anthropic").

A provider entry carries:
- `name` — unique identifier used to reference it in `provider_for_planning` / `provider_for_phases`
- `model` — value for `--model` arg (optional)
- `anthropic_base_url` — value for `ANTHROPIC_BASE_URL` env var (optional)
- `anthropic_api_key` — value for `ANTHROPIC_API_KEY` env var (optional)
- `anthropic_auth_token` — value for `ANTHROPIC_AUTH_TOKEN` env var (optional)
- `health_check_url` — full URL or path appended to `anthropic_base_url`; a GET to this URL must return 2xx for the provider to be considered available (optional; if absent, provider is assumed available)

The resolver takes the ordered provider list, a role (`'planning' | 'phase'`), and an optional name override. It iterates in order, health-checks each, and returns the first available one. Returns `null` if none pass (bare Anthropic fallback).

## Files Expected to Change

| File | Change |
|---|---|
| `src/types/meta.ts` | Add `ProviderEntry` interface; add `providers`, `provider_for_planning`, `provider_for_phases` to `AppConfig` |
| `src/config/repo-config.ts` | Add `providers`, `provider_for_planning`, `provider_for_phases` to `RepoConfig` interface |
| `src/runner/provider.ts` | **New file** — `resolveProvider`, `checkProvider`, `buildProviderEnv`, `buildProviderArgs` |
