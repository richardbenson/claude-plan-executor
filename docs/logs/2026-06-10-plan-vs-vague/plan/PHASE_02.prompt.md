Read docs/self-update/PHASE_02.md for context before starting, and docs/self-update/README.md for the overall feature requirements. You are working on branch feature/self-update — create it from main if it does not exist yet, or check it out if it does.

**PROGRESS.md update**: At the start of this phase, update `PROGRESS.md`: set the status for this phase to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format. The file is docs/self-update/PROGRESS.md — update both the summary table row and the Phase Details entry.

**Idempotency**: Before each significant action (creating a file, running a migration, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after a rate-limit interruption.

## Task

Create the updater core in a new `src/update/` directory: version resolution and comparison, verified atomic binary installation, and persisted check-state. No CLI or TUI wiring in this phase.

## Files to create

1. `src/update/check.ts`
   - `export const REPO_SLUG = 'richardbenson/claude-plan-executor';`
   - `fetchLatestTag(timeoutMs?: number): Promise<string>` — `fetch('https://github.com/' + REPO_SLUG + '/releases/latest', { redirect: 'manual', signal: AbortSignal.timeout(...) })`, read the `location` header, return the final path segment after `/tag/` (e.g. `v0.2.0`). Throw a descriptive Error if the header is missing or unparseable. Default timeout around 5000 ms.
   - `compareVersions(a: string, b: string): number` — strip a leading `v`, split on `-` into core and prerelease, compare dot-separated core segments numerically (missing segments are 0); a version with a prerelease suffix is LOWER than the same core without one; two prerelease suffixes compare lexically. Pure function, no I/O.
   - `isNewer(latestTag: string, currentVersion: string): boolean` — returns false whenever `currentVersion === 'dev'`; otherwise `compareVersions(latestTag, currentVersion) > 0`.

2. `src/update/install.ts`
   - `assetName(): string` — map `process.platform` (`linux` → `linux`, `darwin` → `darwin`) and `process.arch` (`x64` → `x64`, `arm64` → `arm64`) to `cpe-<os>-<arch>`; throw a clear "unsupported platform" Error for anything else.
   - `downloadAndInstall(tag: string, opts?: { execPath?: string; fetchImpl?: typeof fetch }): Promise<void>` — the injectable `execPath` (default `process.execPath`) and `fetchImpl` (default global `fetch`) exist so tests can run against temp files with a stubbed fetch. Flow: download `https://github.com/<slug>/releases/download/<tag>/SHA256SUMS` and the asset for `assetName()`; stream the asset to a temp file named like `.cpe-update-<pid>` in `path.dirname(execPath)` (same filesystem so the final rename is atomic); compute its SHA256 with `new Bun.CryptoHasher('sha256')`; find the SUMS line whose filename field equals the asset name and compare hashes; on success `fs.chmodSync(tmp, 0o755)` then `fs.renameSync(tmp, execPath)`. On ANY failure (missing SUMS file → message must say the release predates checksums; missing line; hash mismatch; download error) delete the temp file in a finally block and rethrow with a message that names the failing step.

3. `src/update/state.ts`
   - State shape `{ last_checked_at?: string; latest_seen?: string }` stored at `<base ?? ~/.local/state/cpe>/update-check.json`.
   - `readUpdateState(base?: string)`, `writeUpdateState(state, base?)`, and `shouldCheck(intervalHours: number, now?: Date, base?: string): boolean` (true when no state, unparseable state, or `last_checked_at` older than the interval).

4. `src/update/check.test.ts`, `src/update/install.test.ts`, `src/update/state.test.ts` — see acceptance criteria. No network access in any test: stub `fetchImpl`, build SUMS content locally, use `fs.mkdtempSync(path.join(os.tmpdir(), ...))` for state/install targets.

## Code patterns to follow

- Mirror `src/storage/meta.ts` for the optional `base?: string` parameter and `src/storage/config.ts` for try/catch-with-default reads and `fs.mkdirSync(..., { recursive: true })` before writes; write JSON with `JSON.stringify(x, null, 2) + '\n'`.
- Imports use the `import * as fs from 'fs'` / `'os'` / `'path'` style and `.js` extensions on relative imports, matching the rest of src/.
- Tests use `bun:test` (`describe`, `it`/`test`, `expect`) like `src/storage/meta.test.ts`.
- Error reporting: throw `Error` with actionable messages; callers (Phases 03/04) handle display. No `console.log` in this module.

## Edge cases

- `currentVersion === 'dev'` must short-circuit `isNewer` to false — dev builds never self-update.
- `compareVersions('v0.10.0', 'v0.9.0')` must be positive (numeric, not lexical, segment comparison).
- Prerelease ordering: `v1.0.0-rc.1` < `v1.0.0`.
- SUMS parsing must tolerate both single-space and double-space separators and trailing newline, and must match the exact filename (no substring matches — `cpe-linux-x64` must not match a hypothetical `cpe-linux-x64-musl` line).
- Temp file must be cleaned up on every failure path; a failed update must leave the original binary untouched.
- `fetchLatestTag` must not follow the redirect (a 302 with `location` is the success case) and must handle a 200 (no redirect — unexpected) as an error.

## Acceptance criteria

- `compareVersions` unit tests cover: equal versions, patch/minor/major bumps, leading-`v` stripping, multi-digit segments (0.10 vs 0.9), prerelease < release, missing segments (1.0 == 1.0.0).
- `isNewer` returns false for `currentVersion 'dev'` regardless of the latest tag.
- `assetName` tests cover the current platform's mapping and assert the error path via monkey-patched `process.platform`/`process.arch` descriptors (or by extracting a pure helper that takes platform/arch as arguments — preferred).
- `downloadAndInstall` tests (stubbed fetch, temp dir): happy path replaces the target file and makes it executable; checksum mismatch leaves the original target untouched, removes the temp file, and rejects; missing SHA256SUMS (404 stub) rejects with a message mentioning checksums; the temp file is created in the same directory as the target.
- `shouldCheck` tests: no state file → true; fresh state → false; state older than interval → true; corrupt JSON → true.
- `bun run typecheck`, `bun run lint`, and `bun test` all pass.

## References

- `src/storage/meta.ts` — `base?: string` testability pattern and JSON write style.
- `src/storage/config.ts` — read-with-default and `CONFIG_PATH` constant style.
- `src/storage/meta.test.ts` — bun:test structure and temp-dir usage.
- `src/version.ts` — the `CPE_VERSION` constant the comparison logic serves (do not import it into src/update/; take versions as parameters so the module stays pure and testable).
- `.github/workflows/release.yml` — tag format (`v*`, prerelease tags contain `-`) and asset names the installer must request.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with a conventional commit message (e.g. `feat: phase 02 — self-update core: version check, verified install, check-state`). Do not make intermediate commits during the phase. If you find the working tree already has a commit for this phase (check `git log --oneline -3`), skip the commit step.
