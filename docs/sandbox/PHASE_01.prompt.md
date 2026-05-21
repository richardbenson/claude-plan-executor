Read docs/sandbox/PHASE_01.md for full context before starting.

You are implementing Phase 1 of the CPE sandboxing plan. This phase adds the `SandboxConfig` type,
extends the existing config types, and builds the core sandbox module. No CLI or TUI changes yet.

---

## Idempotency

Before each significant action (creating a file, editing a type), check whether it already exists
or has already been applied. If `src/runner/sandbox.ts` already exists and exports
`isBubblewrapAvailable`, skip creating it. If `SandboxConfig` is already in `src/types/meta.ts`,
skip that edit. Make the phase safe to resume after an interruption.

## PROGRESS.md update

At the start of this phase, update `docs/sandbox/PROGRESS.md`:
- Set phase 1 status to `in-progress`
- Fill in today's date (YYYY-MM-DD) as the started date

When all acceptance criteria are met, set status to `complete` and fill in the completed date.

---

## 1. `src/types/meta.ts`

Add a `SandboxConfig` interface at the top of the file (after imports, before `TokenUsage`):

```typescript
export interface SandboxConfig {
  enabled: boolean;
  allowedDomains?: string[];
  allowWrite?: string[];
}
```

Extend `AppConfig`:

```typescript
export interface AppConfig {
  max_retries: number;
  gitea_host?: string;
  target_branch?: string;
  sandbox?: SandboxConfig;  // add this field
}
```

Add `sandboxed?: boolean` to `RunMeta`:

```typescript
export interface RunMeta {
  // ... existing fields ...
  sandboxed?: boolean;  // add after bootstrapped
}
```

---

## 2. `src/storage/config.ts`

Add a `DEFAULT_SANDBOX` constant and include it in `DEFAULT_CONFIG`:

```typescript
import { type AppConfig, DEFAULT_CONFIG, type SandboxConfig } from '../types/meta.js';

export const DEFAULT_SANDBOX: SandboxConfig = {
  enabled: true,
  allowedDomains: ['api.anthropic.com', 'github.com', 'registry.npmjs.org', 'pypi.org'],
};
```

Update `DEFAULT_CONFIG` (in `src/types/meta.ts`, since that's where it lives) to include the sandbox default:

```typescript
export const DEFAULT_CONFIG: AppConfig = {
  max_retries: 1,
  sandbox: {
    enabled: true,
    allowedDomains: ['api.anthropic.com', 'github.com', 'registry.npmjs.org', 'pypi.org'],
  },
};
```

Note: `DEFAULT_CONFIG` is defined in `src/types/meta.ts`, not `src/storage/config.ts`. Edit it
there. In `src/storage/config.ts`, export a `DEFAULT_SANDBOX` constant that mirrors the same
values, so `sandbox.ts` can import it without a circular dependency.

---

## 3. `src/config/repo-config.ts`

Import `SandboxConfig` from types and add it to `RepoConfig`:

```typescript
import type { SandboxConfig } from '../types/meta.js';

export interface RepoConfig {
  bootstrap: string[];
  sandbox?: SandboxConfig;
}
```

Update the `STUB_CONTENT` constant to include a commented-out sandbox example so users know the
field exists:

```typescript
const STUB_CONTENT = `{
  "bootstrap": [],
  "sandbox": {
    "allowedDomains": []
  }
}
`;
```

---

## 4. `src/runner/sandbox.ts` (new file)

Create this file. It must export three functions:

### `isBubblewrapAvailable(): boolean`

Synchronously checks whether `bwrap` is on PATH. Use `Bun.spawnSync(['which', 'bwrap'])` and
return `true` if exit code is 0. On non-Linux platforms (`process.platform !== 'linux'`), return
`true` without checking (macOS uses Seatbelt, no bwrap needed).

### `buildSandboxSettings(appConfig: AppConfig, repoConfig: RepoConfig | null, noSandbox: boolean): ClaudeSettingsSandbox | null`

Returns the sandbox block to inject, or `null` if sandbox should be disabled for this run.

Logic:
1. If `noSandbox` is `true`, return `null`.
2. Start from `DEFAULT_SANDBOX` (imported from `../storage/config.js`).
3. If `appConfig.sandbox` exists, apply: override `enabled` if present; merge `allowedDomains`
   arrays (deduplicated); merge `allowWrite` arrays (deduplicated).
4. If `repoConfig?.sandbox` exists, apply the same merge on top.
5. If the result has `enabled: false`, return `null`.
6. On Linux: call `isBubblewrapAvailable()`. If `false`, print a warning to stderr:
   `[cpe] WARNING: bubblewrap (bwrap) not found — running without sandbox. Install with: sudo apt-get install bubblewrap socat`
   Then return `null`.
7. Return the assembled `ClaudeSettingsSandbox` object.

### `injectSandboxSettings(worktreePath: string, sandbox: ClaudeSettingsSandbox): void`

Writes or merges sandbox settings into `<worktreePath>/.claude/settings.local.json`.

Logic:
1. Ensure `<worktreePath>/.claude/` exists (`fs.mkdirSync(..., { recursive: true })`).
2. Read the existing `settings.local.json` if it exists; parse as an object. If absent or invalid,
   start with `{}`.
3. Set `existing.sandbox = { ...existing.sandbox, ...sandbox }` (shallow merge — the sandbox block
   from CPE wins, but other top-level keys in the existing file are preserved).
4. Write back as JSON with 2-space indent + trailing newline.

### Internal type `ClaudeSettingsSandbox`

Define this locally in the file (not exported from types, it's an implementation detail):

```typescript
interface ClaudeSettingsSandbox {
  enabled: boolean;
  failIfUnavailable: boolean;
  autoAllowBashIfSandboxed: boolean;
  network?: {
    allowedDomains?: string[];
  };
  filesystem?: {
    allowWrite?: string[];
  };
}
```

The `buildSandboxSettings` return value must always include:
- `enabled: true`
- `failIfUnavailable: false`
- `autoAllowBashIfSandboxed: true`
- `network.allowedDomains`: the merged domain list (omit the `network` key if the list is empty)
- `filesystem.allowWrite`: the merged write list (omit the `filesystem` key if the list is empty)

---

## Edge cases

- `allowedDomains` deduplication: use `[...new Set([...a, ...b])]`.
- If `DEFAULT_SANDBOX.allowedDomains` is undefined in some code path, treat it as `[]`.
- The `settings.local.json` merge must not throw if the file contains non-object JSON — treat as
  `{}` and overwrite.

---

## Acceptance criteria

- `src/runner/sandbox.ts` exists and TypeScript-compiles without errors.
- `SandboxConfig` is exported from `src/types/meta.ts`.
- `AppConfig` has `sandbox?: SandboxConfig` and `DEFAULT_CONFIG` has `sandbox` with `enabled: true`.
- `RunMeta` has `sandboxed?: boolean`.
- `RepoConfig` has `sandbox?: SandboxConfig`.
- `bun run build` succeeds (no type errors, no missing imports).
- Existing tests pass (`bun test`).

---

## References

- `src/types/meta.ts` — existing types to extend
- `src/storage/config.ts` — where `DEFAULT_CONFIG` lives (actually in meta.ts); where to add `DEFAULT_SANDBOX`
- `src/config/repo-config.ts` — `RepoConfig` definition
- `src/runner/session.ts` — pattern for a runner module in this directory
- Claude Code sandboxing docs: the `settings.local.json` target is the project-local settings file,
  excluded from git. Key: `sandbox.autoAllowBashIfSandboxed` (default `true` in Claude Code, set
  explicitly for clarity). Key: `sandbox.failIfUnavailable` (default `false` — graceful fallback).

---

## One commit per phase

After all acceptance criteria are met, make exactly one commit:

```
feat: phase 01 — sandbox module and types
```

Check `git log --oneline -3` first — if a commit for this phase already exists, skip.

---

## Structured output

Your final message must be a JSON object:

```json
{
  "completed": true,
  "committed": true,
  "commit_message": "feat: phase 01 — sandbox module and types",
  "summary": "one or two sentence summary of what was done",
  "notes_for_next_phase": "anything phase 2 needs to know"
}
```
