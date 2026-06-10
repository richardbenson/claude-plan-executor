# Phase 02 — Updater core module (src/update/)

**Branch:** feature/self-update
**Dependencies:** none (conceptually follows 01: releases must carry SHA256SUMS for the installer to verify against)

## Summary

Create the self-contained update engine: resolve the latest released version,
compare it to the running version, download + verify + atomically install a
new binary, and persist check-state for throttling. No CLI or TUI wiring yet —
that is Phases 03 and 04. Everything here is unit-testable without network.

## Context

- The running version is `CPE_VERSION` from `src/version.ts` — baked in at
  compile time via Bun `--define`, `'dev'` for local builds.
- Releases live at GitHub repo `richardbenson/claude-plan-executor` with
  assets `cpe-{linux|darwin}-{x64|arm64}` and (after Phase 01) `SHA256SUMS`.
  Tags are `v*` (e.g. `v0.2.0`); prerelease tags contain a `-`
  (see the `PRERELEASE` detection in release.yml).
- The latest tag is resolvable without the GitHub API: a request to
  `https://github.com/<slug>/releases/latest` with `redirect: 'manual'`
  returns a `Location` header ending in `/tag/<tag>`.
- Binary swap: Bun-compiled binaries cannot be overwritten in place while
  running (`ETXTBSY` on Linux); the safe pattern is download to a temp file
  **in the same directory** as `process.execPath` (same filesystem →
  `rename()` is atomic), verify, chmod 755, then rename over the target.
- State-file conventions live in `src/storage/` — see `meta.ts` for the
  optional `base?: string` parameter pattern that makes the module testable
  against a temp directory, and `config.ts` for the try/catch-with-default
  read pattern.
- Tests use `bun test` (`describe`/`it`/`expect` from `bun:test`); see
  `src/storage/meta.test.ts` and `src/runner/` tests for temp-dir patterns.

## Module layout

- `src/update/check.ts` — `REPO_SLUG`, `fetchLatestTag()`, `compareVersions()`, `isNewer()`
- `src/update/install.ts` — `assetName()`, `downloadAndInstall(tag)`
- `src/update/state.ts` — read/write `update-check.json`, `shouldCheck()`
- `src/update/check.test.ts`, `src/update/install.test.ts`, `src/update/state.test.ts`

## Files expected to change

- `src/update/check.ts` (new)
- `src/update/install.ts` (new)
- `src/update/state.ts` (new)
- `src/update/check.test.ts` (new)
- `src/update/install.test.ts` (new)
- `src/update/state.test.ts` (new)
