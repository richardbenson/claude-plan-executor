# Phase 2 — Queue/plan integration + --no-sandbox

## Summary

Wire the sandbox injection (built in Phase 1) into the `cpe queue` and `cpe plan` commands. Add a
`--no-sandbox` flag to both. Update `RunMeta` storage to record whether the run was sandboxed.

After this phase, every run created by `cpe queue` or `cpe plan` will have `.claude/settings.local.json`
injected into its worktree with the sandbox configuration, unless `--no-sandbox` is passed or
sandbox is disabled in config.

## Context

The injection point is `queuePlan()` in `src/commands/queue.ts`. This function is the shared path
called by both `queueCommand` (the `cpe queue` subcommand) and `planCommand` (via `queuePlan`
imported from `queue.ts`). Injecting here means both flows are covered with a single change.

The injection should happen **after** `createWorktree()` (so the directory exists) and **before**
`writeMeta()` and `enqueue()` (so the status is recorded accurately). Specifically, insert it after
`runBootstrap()` succeeds and before the phases loop that calls `writeMeta`.

The `--no-sandbox` flag must be threaded from the CLI option all the way into `queuePlan()`:
- `src/cli.ts` adds `.option('--no-sandbox', ...)` to the `queue` and `plan` commands
- `queueCommand` and `planCommand` receive `{ noSandbox: boolean }` via their `options` argument
- `queuePlan()` gains a `noSandbox: boolean` parameter and passes it to `buildSandboxSettings`

After injection, call `updateMeta(runId, { sandboxed: true })` (or `false` if sandbox was
disabled) so the TUI (Phase 3) can read the flag.

## Files expected to change

| File | Change |
|------|--------|
| `src/commands/queue.ts` | Thread `noSandbox` through `queueCommand` → `queuePlan`; inject sandbox settings; record `sandboxed` on RunMeta |
| `src/commands/plan.ts` | Accept `--no-sandbox` option; pass it to `queuePlan` |
| `src/cli.ts` | Add `--no-sandbox` boolean option to `queue` and `plan` subcommands |
