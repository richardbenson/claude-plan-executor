Read `docs/provider-selection/PHASE_02.md` for full context before starting.

**PROGRESS.md update**: At the start of this phase, update `docs/provider-selection/PROGRESS.md`: set the status for Phase 2 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**Idempotency**: Before each significant action (creating a file, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after interruption.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with message `feat: phase 02 — wire provider into all sessions`. If `git log --oneline -3` already shows this commit, skip the commit step.

**Structured output**: Your final message must be a JSON object matching the phase result schema you have been given.

---

## Task

Wire the provider resolver (built in Phase 1) into every Claude spawn site. This phase must not change any observable behaviour when no `providers` key is present in config — the default code path must remain identical.

### 1. `src/runner/session.ts`

Import `ResolvedProvider` from `'./provider.js'` and `buildProviderEnv`, `buildProviderArgs` from `'./provider.js'`.

Add `provider?: ResolvedProvider | null` to the `SessionOpts` interface.

In `runSession`, build env and model args before constructing `args`:

```typescript
const providerEnv = opts.provider ? buildProviderEnv({ ...opts.provider }) : {};
const env = Object.keys(providerEnv).length > 0
  ? { ...process.env, ...providerEnv }
  : undefined;

const args = [
  'claude',
  '-p',
  '--session-id', opts.sessionId,
  '--output-format', 'json',
  '--json-schema', opts.schema,
  '--input-format', 'text',
  ...(opts.provider ? buildProviderArgs({ ...opts.provider }) : []),
];
```

Pass `env` to `Bun.spawn`:

```typescript
const proc = Bun.spawn(args, {
  cwd: opts.worktreePath,
  stdin: Bun.file(opts.promptFile),
  stdout: 'pipe',
  stderr: 'pipe',
  ...(env ? { env } : {}),
});
```

Note: `ResolvedProvider` has `env` and `modelArgs` fields, not the raw `ProviderEntry` fields. You need a small adapter to pass to `buildProviderEnv`/`buildProviderArgs` — or, simpler, inline the logic directly in `runSession`:

```typescript
const providerEnvVars: Record<string, string> = opts.provider?.env ?? {};
const env = Object.keys(providerEnvVars).length > 0
  ? { ...process.env, ...providerEnvVars }
  : undefined;

const args = [
  'claude', '-p',
  '--session-id', opts.sessionId,
  '--output-format', 'json',
  '--json-schema', opts.schema,
  '--input-format', 'text',
  ...(opts.provider?.modelArgs ?? []),
];
```

Use whichever approach is cleaner. The inline approach is preferred since `ResolvedProvider` already has `env` and `modelArgs` pre-built.

### 2. `src/runner/phase-loop.ts`

**In `runPhase`:**

Import `resolveProvider` from `'./provider.js'`.

Before calling `runSession(...)`, resolve the provider:

```typescript
const provider = await resolveProvider(
  appConfig.providers ?? [],
  'phase',
  appConfig.provider_for_phases,
);
```

Pass `provider` into the `runSession` call:

```typescript
const sessionPromise = runSession({
  worktreePath: meta.worktree_path,
  promptFile: effectivePromptFile,
  sessionId: uuid,
  logPath,
  schema: PHASE_RESULT_SCHEMA,
  dangerouslySkipPermissions: appConfig.dangerously_skip_permissions,
  provider,
});
```

**In `resumeOrRestart`:**

The inline `Bun.spawn` near line 277 also needs provider injection. Resolve the provider the same way, then inject `env` and model args:

```typescript
const provider = await resolveProvider(
  appConfig.providers ?? [],
  'phase',
  appConfig.provider_for_phases,
);
const providerEnv = provider?.env ?? {};
const spawnEnv = Object.keys(providerEnv).length > 0
  ? { ...process.env, ...providerEnv }
  : undefined;

const resumeArgs = [
  'claude',
  '--resume', entry.session_id!,
  '-p',
  '--output-format', 'json',
  '--json-schema', schema,
  ...(provider?.modelArgs ?? []),
];

const proc = Bun.spawn(resumeArgs, {
  cwd: meta.worktree_path,
  stdin: Bun.file(tmpFile),
  stdout: 'pipe',
  stderr: 'pipe',
  ...(spawnEnv ? { env: spawnEnv } : {}),
});
```

### 3. `src/runner/single-prompt.ts`

Import `resolveProvider` from `'./provider.js'`.

Before calling `runSession(...)` in `runSinglePrompt`, resolve the provider:

```typescript
const provider = await resolveProvider(
  appConfig.providers ?? [],
  'phase',
  appConfig.provider_for_phases,
);
```

Pass `provider` into the `runSession` call.

### 4. `src/runner/finalise.ts`

Import `resolveProvider` from `'./provider.js'` and `AppConfig` from `'../types/meta.js'`.

Change the signature of `finaliseRun` to accept an optional `appConfig`:

```typescript
export async function finaliseRun(runId: string, bus: ActivityBus, appConfig?: AppConfig): Promise<FinaliseResult>
```

Before the `Bun.spawn` call, resolve the provider:

```typescript
const provider = appConfig
  ? await resolveProvider(appConfig.providers ?? [], 'phase', appConfig.provider_for_phases)
  : null;
const providerEnv = provider?.env ?? {};
const spawnEnv = Object.keys(providerEnv).length > 0
  ? { ...process.env, ...providerEnv }
  : undefined;
const modelArgs = provider?.modelArgs ?? [];
```

Update the spawn:

```typescript
const proc = Bun.spawn(['claude', '-p', '--dangerously-skip-permissions', ...modelArgs], {
  cwd: worktreePath,
  stdin: fs.openSync(tmpFile, 'r'),
  stdout: logFd,
  stderr: logFd,
  ...(spawnEnv ? { env: spawnEnv } : {}),
});
```

Update the call in `src/commands/start.ts` to pass `effectiveConfig`:

```typescript
await finaliseRun(runId, bus, effectiveConfig);
```

### 5. `src/config/repo-config.ts`

Import `ResolvedProvider` from `'../runner/provider.js'`.

Add an optional `provider` parameter to `detectBootstrap`:

```typescript
export async function detectBootstrap(
  repoPath: string,
  provider?: ResolvedProvider | null,
): Promise<BootstrapDetectResult>
```

Before the `Bun.spawn` call in `detectBootstrap`, inject provider:

```typescript
const providerEnv = provider?.env ?? {};
const spawnEnv = Object.keys(providerEnv).length > 0
  ? { ...process.env, ...providerEnv }
  : undefined;
const modelArgs = provider?.modelArgs ?? [];

const proc = Bun.spawn(
  ['claude', '-p', '--output-format=json', '--json-schema', BOOTSTRAP_DETECT_SCHEMA, ...modelArgs],
  {
    cwd: repoPath,
    stdin: new TextEncoder().encode(BOOTSTRAP_DETECT_PROMPT),
    stdout: 'pipe',
    stderr: 'pipe',
    ...(spawnEnv ? { env: spawnEnv } : {}),
  },
);
```

In `ensureRepoConfig`, when calling `detectBootstrap`, pass the provider through. Update `ensureRepoConfig` signature to accept an optional provider:

```typescript
export async function ensureRepoConfig(
  repoPath: string,
  _giteaHost?: string,
  provider?: ResolvedProvider | null,
): Promise<RepoConfig>
```

And pass it to the `detectBootstrap(repoPath, provider)` call inside.

### 6. `src/commands/plan.ts`

Import `resolveProvider` from `'../runner/provider.js'`.

After reading `config` and `repoConfig`, resolve the planning provider:

```typescript
const effectiveProviders = repoConfig?.providers ?? config.providers ?? [];
const effectiveProviderName = repoConfig?.provider_for_planning ?? config.provider_for_planning;
const provider = await resolveProvider(effectiveProviders, 'planning', effectiveProviderName);
```

Pass `provider` to `ensureRepoConfig` (update the call to include `provider` as third arg).

For the interactive planning spawn (around line 143), inject provider:

```typescript
const providerEnv = provider?.env ?? {};
const spawnEnv = Object.keys(providerEnv).length > 0
  ? { ...process.env, ...providerEnv }
  : undefined;
const modelArgs = provider?.modelArgs ?? [];

const proc = Bun.spawn(['claude', ...modelArgs], {
  cwd: worktreePath,
  stdin: Bun.file(tmpFile),
  stdout: 'inherit',
  stderr: 'inherit',
  ...(spawnEnv ? { env: spawnEnv } : {}),
});
```

### 7. `src/commands/start.ts`

In `runQueueProcessor`, where `effectiveConfig` is built (around line 75), merge repo-level provider config:

```typescript
const effectiveConfig: AppConfig = {
  ...config,
  ...(repoConfig?.dangerously_skip_permissions && !config.dangerously_skip_permissions
    ? { dangerously_skip_permissions: true }
    : {}),
  ...(repoConfig?.providers !== undefined
    ? {
        providers: repoConfig.providers,
        provider_for_planning: repoConfig.provider_for_planning ?? config.provider_for_planning,
        provider_for_phases: repoConfig.provider_for_phases ?? config.provider_for_phases,
      }
    : {}),
};
```

Also update the `finaliseRun` call to pass `effectiveConfig` (see step 4 above).

### Code patterns to follow

- All imports use `.js` suffix.
- `env: undefined` is the correct way to inherit parent env in Bun — do not spread `process.env` unless provider vars are actually being added.
- No new `console.log` calls in library code.
- Do not change any retry logic, error handling, or session ID logic — this phase is purely env/arg injection.

### Edge cases

- `appConfig.providers` is `undefined` → `resolveProvider([], ...)` returns `null` immediately → no env injection, no model args. Existing behaviour preserved.
- Provider resolves to `null` → `provider?.env ?? {}` is `{}` → `Object.keys({}).length === 0` → `env` stays `undefined` → spawn inherits parent env. Existing behaviour preserved.
- `provider?.modelArgs` is `[]` → spread `...[])` is a no-op. Existing args unchanged.

### Acceptance criteria

- [ ] `SessionOpts` has `provider?: ResolvedProvider | null`.
- [ ] `runSession` injects `env` and model args when `provider` is non-null and non-empty.
- [ ] `runPhase` resolves provider and passes it to `runSession`.
- [ ] `resumeOrRestart` inline spawn injects provider env/args.
- [ ] `runSinglePrompt` resolves provider and passes it to `runSession`.
- [ ] `finaliseRun` accepts optional `appConfig` and injects provider.
- [ ] `detectBootstrap` accepts optional `provider` and injects it.
- [ ] `ensureRepoConfig` accepts optional `provider` and forwards it to `detectBootstrap`.
- [ ] `planCommand` resolves provider from merged config and injects into interactive spawn.
- [ ] `runQueueProcessor` merges repo-level provider fields into `effectiveConfig`.
- [ ] `runQueueProcessor` passes `effectiveConfig` to `finaliseRun`.
- [ ] When `providers` is absent from all configs, zero behaviour change — no env injection, no model args.
- [ ] `bun run build` passes with no type errors.
- [ ] `bun test` passes.

### References

- `src/runner/session.ts` — current spawn at line 46
- `src/runner/phase-loop.ts` — `runPhase` runSession call at line 108; inline spawn in `resumeOrRestart` at line 277
- `src/runner/finalise.ts` — spawn at line 41
- `src/config/repo-config.ts` — `detectBootstrap` at line 110; `ensureRepoConfig` at line 157
- `src/commands/plan.ts` — interactive spawn at line 143; `ensureRepoConfig` call at line 84
- `src/commands/start.ts` — `effectiveConfig` construction at line 75; `finaliseRun` call at line 152
