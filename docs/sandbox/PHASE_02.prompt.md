Read docs/sandbox/PHASE_02.md for full context before starting.

You are implementing Phase 2 of the CPE sandboxing plan. Phase 1 added the `SandboxConfig` type,
`DEFAULT_SANDBOX`, and the `src/runner/sandbox.ts` module. This phase wires those into the queue
and plan commands and adds the `--no-sandbox` CLI flag.

---

## Idempotency

Before editing a file, check whether the change is already present. If `queuePlan` already accepts
a `noSandbox` parameter, skip that edit. If the `--no-sandbox` option is already in `cli.ts`, skip
it. Make the phase safe to resume after an interruption.

## PROGRESS.md update

At the start of this phase, update `docs/sandbox/PROGRESS.md`:
- Set phase 2 status to `in-progress`
- Fill in today's date (YYYY-MM-DD) as the started date

When all acceptance criteria are met, set status to `complete` and fill in the completed date.

---

## 1. `src/cli.ts`

Add `.option('--no-sandbox', 'Disable sandbox for this run')` to both the `queue` and `plan`
command definitions. Commander parses `--no-sandbox` as `{ sandbox: false }` in the options object
(note: Commander converts `--no-X` to `X: false`). To avoid the naming collision, use a different
flag name: `--disable-sandbox`.

```typescript
program
  .command('queue [folder]')
  .description('Add a plan to the queue')
  .option('--disable-sandbox', 'Skip sandbox injection for this run')
  .action(wrap(queueCommand));

program
  .command('plan [details...]')
  .description('Create a new plan interactively')
  .option('--disable-sandbox', 'Skip sandbox injection for this run')
  .action(wrap(planCommand));
```

The option will appear on the `options` object as `{ disableSandbox: boolean }`.

---

## 2. `src/commands/queue.ts`

### Update `queuePlan` signature

Add `noSandbox: boolean` as the last parameter:

```typescript
export async function queuePlan(
  repoPath: string,
  folder: string,
  runId: string,
  worktreePath: string,
  config: AppConfig,
  repoConfig: RepoConfig,
  noSandbox: boolean = false,
): Promise<void>
```

### Inject sandbox settings inside `queuePlan`

Import the sandbox functions at the top of the file:

```typescript
import { buildSandboxSettings, injectSandboxSettings } from '../runner/sandbox.js';
```

After the `runBootstrap` success block (but before `writeMeta`), add:

```typescript
const sandboxSettings = buildSandboxSettings(config, repoConfig, noSandbox);
const sandboxed = sandboxSettings !== null;
if (sandboxSettings) {
  injectSandboxSettings(worktreePath, sandboxSettings);
}
```

### Record `sandboxed` on RunMeta

In the `writeMeta` call, add `sandboxed` to the object:

```typescript
writeMeta(runId, {
  id: runId,
  // ... existing fields ...
  sandboxed,
  phases,
});
```

### Update `queueCommand`

Read `disableSandbox` from Commander's options and pass it to `queuePlan`:

```typescript
export async function queueCommand(folder?: string, options?: { disableSandbox?: boolean }): Promise<void> {
  // ... existing code ...
  await queuePlan(repoPath, folder, runId, worktreePath, config, repoConfig, options?.disableSandbox ?? false);
}
```

Commander passes options as the second argument to action callbacks when a `[folder]` positional
argument is declared. Confirm this matches the existing function signature before editing.

---

## 3. `src/commands/plan.ts`

The `planCommand` function already calls `queuePlan`. Read the existing signature and add the
`disableSandbox` option:

```typescript
export async function planCommand(details: string[], options?: { disableSandbox?: boolean }): Promise<void> {
  // ... existing code ...
  // When calling queuePlan, pass the noSandbox flag:
  await queuePlan(repoPath, folder, runId, worktreePath, config, repoConfig, options?.disableSandbox ?? false);
}
```

---

## Edge cases

- Commander's option parsing: `--disable-sandbox` becomes `disableSandbox: true` on the options
  object. If the flag is absent, `disableSandbox` will be `undefined`, so use `?? false`.
- `writeMeta` currently takes a `RunMeta` object. `RunMeta` now has `sandboxed?: boolean` from
  Phase 1. Passing it is safe because the field is optional.
- If `buildSandboxSettings` returns `null` (disabled or bwrap missing), `injectSandboxSettings`
  is not called — the worktree has no sandbox config and Claude Code runs without sandboxing. This
  is the correct fallback behaviour.

---

## Acceptance criteria

- `cpe queue` injects `.claude/settings.local.json` with `sandbox.enabled: true` into the new
  worktree when no flags are passed.
- `cpe queue --disable-sandbox` skips injection and the worktree has no `.claude/settings.local.json`
  (or any existing one is untouched).
- `cpe plan` has the same behaviour as `cpe queue` for the sandbox flag.
- `RunMeta.sandboxed` is `true` for sandboxed runs and `false` (or `undefined`) for non-sandboxed.
- `bun run build` succeeds.
- Existing tests pass (`bun test`).

---

## References

- `src/runner/sandbox.ts` — `buildSandboxSettings`, `injectSandboxSettings` (built in Phase 1)
- `src/commands/queue.ts` — `queuePlan` (the shared injection point), `queueCommand`
- `src/commands/plan.ts` — `planCommand`, which imports and calls `queuePlan`
- `src/cli.ts` — Commander command definitions
- `src/types/meta.ts` — `RunMeta.sandboxed` (added in Phase 1)
- `src/storage/meta.ts` — `writeMeta`, `updateMeta` (understand their signatures before editing)

---

## One commit per phase

After all acceptance criteria are met, make exactly one commit:

```
feat: phase 02 — queue/plan sandbox injection and --disable-sandbox flag
```

Check `git log --oneline -3` first — if a commit for this phase already exists, skip.

---

## Structured output

Your final message must be a JSON object:

```json
{
  "completed": true,
  "committed": true,
  "commit_message": "feat: phase 02 — queue/plan sandbox injection and --disable-sandbox flag",
  "summary": "one or two sentence summary of what was done",
  "notes_for_next_phase": "anything phase 3 needs to know"
}
```
