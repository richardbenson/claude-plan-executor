# Phase 03 — CLI surface: `cpe update`, config flag, nudge

**Branch:** feature/self-update
**Dependencies:** Phase 02 (uses src/update/check.ts, install.ts, state.ts)

## Summary

Wire the Phase 02 engine into the CLI: an explicit `cpe update [--check]`
command, the `update_auto` config flag, and the throttled post-command nudge
that short-lived commands print when a newer release exists. Short-lived
commands never install.

## Context

- Commands live in `src/commands/<name>.ts` and are registered in
  `src/cli.ts` via `program.command(...).action(wrap(fn))` — `wrap` prints
  the error message and exits 1, so command functions just throw.
- The entry point `src/index.ts` is four lines: `setupCli(); program.parse();`.
  The nudge must run **after** the invoked command completes, which requires
  awaiting `program.parseAsync()` instead. The nudge must be skipped for
  `start` (never returns until quit), for `update` itself (redundant), for
  dev builds, when `update_auto` is `false`, and when the 24 h throttle has
  not elapsed (`shouldCheck` from Phase 02). It must never break a command:
  every failure path is swallowed.
- `AppConfig` and `DEFAULT_CONFIG` are in `src/types/meta.ts`; config is read
  via `readConfig()` from `src/storage/config.ts`. Absent `update_auto`
  means enabled (check `!== false`, don't add it to `DEFAULT_CONFIG` — the
  optional-with-default-true convention matches `sandbox.enabled` handling
  elsewhere; document the default in the doc comment).
- `CPE_VERSION` comes from `src/version.ts`.

## Behaviour spec

- `cpe update --check`: print current version, latest tag, and either
  "update available — run cpe update" or "already up to date". Exit 0 both ways.
- `cpe update`: on dev build, print that self-update is disabled for dev
  builds (suggest `scripts/install-local.sh`) and return. If newer: call
  `downloadAndInstall`, then print `updated <current> → <latest>` plus a
  reminder to restart any running `cpe start` session. If current: say so.
  Both paths refresh the update-check state file so the nudge throttle
  resets.
- Nudge (all other commands): when a check fires and finds a newer tag,
  print exactly one stderr line:
  `update available: <tag> — run cpe update`. Always record the check in
  the state file, found or not.

## Files expected to change

- `src/commands/update.ts` (new)
- `src/update/nudge.ts` (new)
- `src/update/nudge.test.ts` (new)
- `src/cli.ts` — register the `update` command
- `src/index.ts` — `parseAsync` + post-command nudge call
- `src/types/meta.ts` — `update_auto?: boolean` on `AppConfig`
- `README.md` — document `cpe update`, the nudge, and the `update_auto` flag
