Read `docs/provider-selection/PHASE_01.md` for full context before starting.

**PROGRESS.md update**: At the start of this phase, update `docs/provider-selection/PROGRESS.md`: set the status for Phase 1 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**Idempotency**: Before each significant action (creating a file, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after interruption.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with message `feat: phase 01 — provider types and resolver`. If `git log --oneline -3` already shows this commit, skip the commit step.

**Structured output**: Your final message must be a JSON object matching the phase result schema you have been given.

---

## Task

Implement the provider data model and resolver. **No changes to session-spawning behaviour in this phase.** This phase is pure types + logic.

### 1. `src/types/meta.ts`

Add the following interface **before** `AppConfig`:

```typescript
export interface ProviderEntry {
  name: string;
  model?: string;
  anthropic_base_url?: string;
  anthropic_api_key?: string;
  anthropic_auth_token?: string;
  health_check_url?: string;
}
```

Extend `AppConfig` with three new optional fields:

```typescript
providers?: ProviderEntry[];
provider_for_planning?: string;   // name of preferred provider for planning sessions
provider_for_phases?: string;     // name of preferred provider for phase/single-prompt sessions
```

### 2. `src/config/repo-config.ts`

Extend the existing `RepoConfig` interface with the same three optional fields:

```typescript
providers?: ProviderEntry[];
provider_for_planning?: string;
provider_for_phases?: string;
```

Import `ProviderEntry` from `'../types/meta.js'`. Do not change any runtime logic in this file.

### 3. `src/runner/provider.ts` (new file)

Create this module. It must export:

#### `ResolvedProvider` interface

```typescript
export interface ResolvedProvider {
  name: string;
  env: Record<string, string>;   // env vars to merge into spawn env
  modelArgs: string[];           // e.g. ['--model', 'llama3'] or []
}
```

#### `checkProvider(provider: ProviderEntry): Promise<boolean>`

- If `provider.health_check_url` is absent or empty, return `true` immediately (no check needed).
- Build the full URL:
  - If `health_check_url` starts with `http://` or `https://`, use it as-is.
  - Otherwise, concatenate `provider.anthropic_base_url` (trimmed of trailing slash) + `health_check_url`.
  - If there is no `anthropic_base_url` and `health_check_url` is a relative path (not a full URL), return `false` (cannot construct a URL).
- GET the URL with a 5-second timeout using `AbortSignal.timeout(5000)`.
- Return `true` if the response status is 2xx; `false` on any error or non-2xx status.

#### `buildProviderEnv(provider: ProviderEntry): Record<string, string>`

Returns an object containing only the keys that are set:
- `ANTHROPIC_BASE_URL` if `provider.anthropic_base_url` is set
- `ANTHROPIC_API_KEY` if `provider.anthropic_api_key` is set
- `ANTHROPIC_AUTH_TOKEN` if `provider.anthropic_auth_token` is set

#### `buildProviderArgs(provider: ProviderEntry): string[]`

Returns `['--model', provider.model]` if `provider.model` is set, otherwise `[]`.

#### `resolveProvider(providers: ProviderEntry[], role: 'planning' | 'phase', nameOverride?: string): Promise<ResolvedProvider | null>`

Resolution algorithm:

1. Build the candidate list:
   - If `nameOverride` is set, find the provider with that name and put it first in the candidate list. Append the remaining providers in their original order after it.
   - If `nameOverride` is not set, use the full `providers` list in order.
2. For each candidate in order:
   - Call `checkProvider(candidate)`.
   - If it returns `true`, return a `ResolvedProvider` built from `candidate`.
3. If no candidate passes, return `null`.

The `role` parameter is accepted for future extensibility but does not change the algorithm in this phase. The caller is responsible for passing the correct `nameOverride` based on `provider_for_planning` vs `provider_for_phases`.

### Code patterns to follow

- All imports use the `.js` extension suffix (e.g. `from '../types/meta.js'`).
- `async/await` throughout — no raw Promise chains.
- No `console.log` in library code; this module is silent.
- TypeScript strict mode is in effect — no implicit `any`.

### Edge cases

- `providers` array is `undefined` or empty → `resolveProvider` returns `null` immediately.
- `nameOverride` names a provider that does not exist in the list → skip silently, use the remaining list in order.
- `fetch` throws (network error, ECONNREFUSED) → `checkProvider` returns `false`.
- Health check URL construction fails (relative path, no base URL) → `checkProvider` returns `false`.

### Acceptance criteria

- [ ] `ProviderEntry` is exported from `src/types/meta.ts`.
- [ ] `AppConfig` has `providers?`, `provider_for_planning?`, `provider_for_phases?` fields.
- [ ] `RepoConfig` has the same three fields.
- [ ] `src/runner/provider.ts` exports `ResolvedProvider`, `checkProvider`, `buildProviderEnv`, `buildProviderArgs`, `resolveProvider`.
- [ ] `resolveProvider([], 'phase')` returns `null`.
- [ ] `resolveProvider([{ name: 'x' }], 'phase')` returns a `ResolvedProvider` with `name: 'x'`, `env: {}`, `modelArgs: []` (no health check URL means pass).
- [ ] `bun run build` passes with no type errors.
- [ ] `bun test` passes.

### References

- Current `AppConfig` definition: `src/types/meta.ts` lines 75–81
- Current `RepoConfig` definition: `src/config/repo-config.ts` lines 7–11
- Bun's `fetch` supports `AbortSignal.timeout` natively
