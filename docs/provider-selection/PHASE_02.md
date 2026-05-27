# Phase 2 — Wire provider into all sessions

## Summary

Thread provider resolution into every place that spawns a `claude` process. After this phase, every session (headless phases, single-prompt, resume, finalise, bootstrap detect, and interactive planning) will inject the resolved provider's env vars and `--model` arg.

## Context

Phase 1 built the types and resolver. This phase wires them up. There are six spawn sites across five files:

| File | Spawn site | Role |
|---|---|---|
| `src/runner/session.ts` | `runSession()` | phases + single-prompt |
| `src/runner/phase-loop.ts` | `resumeOrRestart()` inline spawn | phase resume after rate-limit |
| `src/runner/finalise.ts` | `finaliseRun()` | finalise (summarise + PR) |
| `src/config/repo-config.ts` | `detectBootstrap()` | one-off bootstrap detection |
| `src/commands/plan.ts` | interactive `claude` spawn | planning session |

Additionally, `src/commands/start.ts` (the queue processor) is where `effectiveConfig` is built per-run. This is where repo-level provider overrides should be merged into the global config, so all runners can read providers from `appConfig` alone.

## Provider resolution pattern

For headless sessions (phase-loop, single-prompt, finalise), the resolution happens in the caller before each spawn:

```typescript
const provider = await resolveProvider(
  appConfig.providers ?? [],
  'phase',
  appConfig.provider_for_phases,
);
```

For the planning session in `plan.ts` (which also reads `repoConfig`):

```typescript
const effectiveProv = repoConfig?.providers ?? config.providers ?? [];
const effectiveName = repoConfig?.provider_for_planning ?? config.provider_for_planning;
const provider = await resolveProvider(effectiveProv, 'planning', effectiveName);
```

For `detectBootstrap` in `repo-config.ts`, a `provider?: ResolvedProvider | null` optional arg is threaded in.

## Env injection pattern

When `Bun.spawn` is called with a resolved provider that is non-null:

```typescript
const providerEnv = provider ? buildProviderEnv(provider) : {};
const env = Object.keys(providerEnv).length > 0
  ? { ...process.env, ...providerEnv }
  : undefined; // undefined = inherit parent env
```

Pass `env` to `Bun.spawn`. When provider is null (or has no env vars), `env` stays `undefined` so the spawn inherits the parent process environment unchanged — existing behaviour is preserved.

## Files Expected to Change

| File | Change |
|---|---|
| `src/runner/session.ts` | Add optional `provider?: ResolvedProvider \| null` to `SessionOpts`; inject env + model args |
| `src/runner/phase-loop.ts` | Resolve provider before `runSession` call in `runPhase`; also inject env/model in inline `resumeOrRestart` spawn |
| `src/runner/single-prompt.ts` | Resolve provider before `runSession` call in `runSinglePrompt` |
| `src/runner/finalise.ts` | Resolve provider and inject env/model in `finaliseRun` spawn |
| `src/config/repo-config.ts` | Add optional `provider?: ResolvedProvider \| null` arg to `detectBootstrap`; inject env/model |
| `src/commands/plan.ts` | Resolve provider and inject env/model in interactive planning spawn; pass to `detectBootstrap` |
| `src/commands/start.ts` | Merge repo-level `providers`, `provider_for_planning`, `provider_for_phases` into `effectiveConfig` |
