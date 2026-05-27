# Provider Selection

## Original Requirements

Add support for running Claude sessions with alternative models and providers (e.g. local Ollama, custom API proxies) by injecting `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `--model` into every Claude spawn.

Key requirements:
- Each provider entry carries: `name`, optional `model`, `anthropic_base_url`, `anthropic_api_key`, `anthropic_auth_token`, and `health_check_url`.
- Providers are evaluated in priority order; a GET to `health_check_url` (5 s timeout, must be 2xx) gates availability. Providers without a health check URL are assumed available.
- If no provider passes its health check, cpe falls back silently to bare Anthropic (no extra env vars or `--model`).
- Two roles: `provider_for_planning` and `provider_for_phases`. Each names a preferred provider; if that provider fails its check, the resolver falls back through the list in order.
- Global provider config lives in `~/.config/cpe/config.json`; a repo's `cpe.config.json` can fully override it with its own `providers`, `provider_for_planning`, `provider_for_phases` fields.
- `start.ts` merges repo-level provider config into `effectiveConfig` so all runners consume providers from `appConfig` alone.
- Provider selection applies to **all** Claude spawns: interactive planning, headless phases, single-prompt, bootstrap detect, finalise, and rate-limit resume.
- CLI surface: `cpe provider list`, `cpe provider add`, `cpe provider remove <name>`, `cpe provider test [name]`.

## What Was Built

All three phases were completed on 2026-05-27 with one commit per phase, exactly as planned. No phases were skipped or changed in scope.

### Phase 1 — Provider types & resolver (`feat: phase 01 — provider types and resolver`)

- Added `ProviderEntry` interface to `src/types/meta.ts` and extended `AppConfig` with `providers?`, `provider_for_planning?`, `provider_for_phases?`.
- Extended `RepoConfig` in `src/config/repo-config.ts` with the same three optional fields.
- Created `src/runner/provider.ts` exporting:
  - `ResolvedProvider` interface (`name`, `env: Record<string, string>`, `modelArgs: string[]`)
  - `checkProvider(provider)` — performs an HTTP GET with a 5 s `AbortSignal.timeout`; providers without `health_check_url` return `true` immediately
  - `buildProviderEnv(provider)` — returns only the env-var keys that are set
  - `buildProviderArgs(provider)` — returns `['--model', model]` or `[]`
  - `resolveProvider(providers, role, nameOverride?)` — iterates candidates, health-checks each, returns first `ResolvedProvider` or `null`

### Phase 2 — Wire provider into all sessions (`feat: phase 02 — wire provider into all sessions`)

Provider resolution was threaded into all six spawn sites across five files:

- **`src/runner/session.ts`** — added `provider?: ResolvedProvider | null` to `SessionOpts`; inlines `provider.env` and `provider.modelArgs` into the spawn.
- **`src/runner/phase-loop.ts`** — resolves provider in `runPhase` before `runSession`; also injects env/args into the inline `resumeOrRestart` spawn used after rate-limit recovery.
- **`src/runner/single-prompt.ts`** — resolves provider before `runSession`.
- **`src/runner/finalise.ts`** — accepts an optional `appConfig` parameter and resolves provider before its `Bun.spawn`.
- **`src/config/repo-config.ts`** — `detectBootstrap` and `ensureRepoConfig` accept an optional `provider` parameter and inject it into the bootstrap detection spawn.
- **`src/commands/plan.ts`** — resolves provider from merged repo+global config, passes it to `ensureRepoConfig`, and injects it into the interactive planning spawn.
- **`src/commands/start.ts`** — merges repo-level `providers`/`provider_for_planning`/`provider_for_phases` into `effectiveConfig`; passes `effectiveConfig` to `finaliseRun`.

The zero-provider code path is unchanged: when `providers` is absent, `resolveProvider([], ...)` returns `null`, `provider?.env ?? {}` is `{}`, and `env` stays `undefined` so spawns inherit the parent environment as before.

### Phase 3 — `cpe provider` CLI subcommand (`feat: phase 03 — cpe provider CLI`)

- Created `src/commands/provider.ts` with four exported async functions:
  - `providerListCommand` — tabular view of providers with Name, Model, Base URL, Health URL, and Roles columns (P/F/P+F/—); prints planning/phase defaults below the table.
  - `providerAddCommand` — interactive wizard using synchronous `readLine()` (same pattern as repo-config); re-prompts on duplicate names; optionally sets role defaults.
  - `providerRemoveCommand(name)` — removes provider from config and clears any `provider_for_planning`/`provider_for_phases` references to it; exits 1 if not found.
  - `providerTestCommand(name?)` — runs `checkProvider` for one or all providers; prints ✓/✗ with URL or `(no check — assumed available)`.
- Registered all four subcommands in `src/cli.ts` under a `provider` parent command using the existing `wrap()` error-handler pattern.

## Lessons Learned

- **Pre-built `ResolvedProvider` simplifies injection.** Because `resolveProvider` returns `{ env, modelArgs }` already assembled, every spawn site uses the same two-line injection pattern (`provider?.env ?? {}` and `provider?.modelArgs ?? []`) without re-reading raw `ProviderEntry` fields. This made Phase 2 mechanical and low-risk.
- **`env: undefined` is the right Bun idiom.** Passing `env: undefined` to `Bun.spawn` correctly inherits the parent environment. The pattern `Object.keys(providerEnv).length > 0 ? { ...process.env, ...providerEnv } : undefined` was used consistently across all spawn sites to guarantee the zero-config code path stays identical.
- **Repo-level override merges cleanly in `start.ts`.** Centralising the merge in `runQueueProcessor` (rather than in each runner) meant that all downstream runners could be wired up without knowing about `RepoConfig` — they only read `appConfig`.
- **The `role` parameter is a forward-compatibility hook.** It is accepted by `resolveProvider` but does not change the algorithm. The caller is responsible for passing the right `nameOverride` (`provider_for_planning` vs `provider_for_phases`). If role-specific filtering is ever needed, it can be added without changing call sites.
- **Health checks without a base URL need care.** A relative `health_check_url` with no `anthropic_base_url` returns `false` (cannot construct a URL) rather than throwing. This silent failure is intentional — the provider is treated as unavailable and the resolver moves on.
- **Interactive wizard reuses the existing `readLine()` pattern.** Using synchronous fd-0 reads (same as `repo-config.ts`) kept the add wizard consistent with existing CLI prompts and avoided adding an async readline dependency.
