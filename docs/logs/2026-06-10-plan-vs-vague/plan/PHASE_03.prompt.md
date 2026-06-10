Read docs/self-update/PHASE_03.md for context before starting, and docs/self-update/README.md for the overall feature requirements. You are working on branch feature/self-update — check it out; Phase 02 must already be committed there (verify src/update/check.ts exists before starting; if it does not, stop and report that Phase 02 has not run).

**PROGRESS.md update**: At the start of this phase, update `PROGRESS.md`: set the status for this phase to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format. The file is docs/self-update/PROGRESS.md — update both the summary table row and the Phase Details entry.

**Idempotency**: Before each significant action (creating a file, running a migration, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after a rate-limit interruption.

## Task

Expose the Phase 02 updater through the CLI: add `cpe update [--check]`, the `update_auto` config flag, and a throttled post-command update nudge for short-lived commands.

## Files to modify or create

1. `src/types/meta.ts` — add `update_auto?: boolean;` to `AppConfig` with a doc comment in the style of the existing commented fields: absent/true enables automatic update checks (TUI auto-install in Phase 04, CLI nudge here); false disables both; explicit `cpe update` always works. Do NOT add it to `DEFAULT_CONFIG` — consumers must treat `config.update_auto !== false` as enabled so existing config files keep working.

2. `src/commands/update.ts` (new) — `export async function updateCommand(opts: { check?: boolean }): Promise<void>`:
   - If `CPE_VERSION === 'dev'`: print that self-update is disabled for dev builds and to rebuild via `scripts/install-local.sh`, then return (exit 0, even for `--check`).
   - Call `fetchLatestTag()`; with `--check`, print current version and latest tag, plus either an "update available — run cpe update" or "already up to date" line, and return.
   - Without `--check`: if `isNewer(latest, CPE_VERSION)`, print a downloading line (the binary is ~92 MB — say what is happening), call `downloadAndInstall(latest)`, then print `updated <current> → <latest>` and a reminder that any running `cpe start` session is still on the old version and should be restarted. If not newer, print "already up to date (<version>)".
   - In every successful path (check or install), write the update state via `writeUpdateState({ last_checked_at: new Date().toISOString(), latest_seen: <latest> })` so the nudge throttle resets.
   - Let errors throw — `wrap()` in cli.ts handles printing and exit code.

3. `src/update/nudge.ts` (new) — `export async function maybePrintUpdateNudge(argv: string[]): Promise<void>`:
   - Determine the invoked subcommand from argv and return immediately for `start` and `update`.
   - Return immediately when `CPE_VERSION === 'dev'`, when `readConfig().update_auto === false`, or when `!shouldCheck(24)`.
   - Otherwise call `fetchLatestTag(2000)` (short timeout — this runs after every eligible command), write the update state, and if `isNewer(...)` write one line to `process.stderr`: `update available: <tag> — run cpe update`.
   - Wrap the entire body so that no error ever escapes (network down, GitHub unreachable, unwritable state dir → silent no-op). This function must never change a command's exit code or output stream ordering guarantees beyond the single stderr line.
   - Accept optional injectable dependencies (an object with `fetchLatestTag`, `shouldCheck`, `readConfig`, `write` defaults) so the skip-conditions and output are unit-testable without network — follow the injectable-parameter style used by `interruptiblePause` in `src/commands/start.ts`.

4. `src/update/nudge.test.ts` (new) — cover the skip conditions (start/update argv, dev version, `update_auto: false`, throttle says no) and the success path emitting exactly one stderr line, using injected stubs.

5. `src/cli.ts` — register the command following the existing pattern: `program.command('update').description('Update cpe to the latest GitHub release').option('--check', 'Check for a newer version without installing').action(wrap(updateCommand))`. Note the action receives the options object as its first argument for an argument-less command.

6. `src/index.ts` — change to `await program.parseAsync();` (top-level await is fine under Bun) and then `await maybePrintUpdateNudge(process.argv);`.

7. `README.md` — add a short "Updating" section: `cpe update` / `cpe update --check`, the automatic background behaviour (point forward to the TUI auto-update), the once-per-24h nudge, the `update_auto: false` opt-out in `~/.config/cpe/config.json`, and that dev builds are exempt.

## Code patterns to follow

- Command modules export a single `async function <name>Command(...)` and throw on failure; `wrap()` in cli.ts owns error printing and `process.exit(1)` — do not call `process.exit` inside the command.
- `.js` extensions on relative imports; `import * as` for node builtins.
- User-facing output via `console.log` in commands (see `src/commands/status.ts` for tone — terse, lowercase-leaning lines); the nudge writes to `process.stderr` only.
- Version source is `CPE_VERSION` from `src/version.ts`, the same constant `program.version()` uses.

## Edge cases

- `cpe --version` / `--help` invocations: commander handles these before any action runs; the nudge after `parseAsync` will still execute — that is acceptable, but it must not run for `update`/`start` and must never delay exit by more than the 2 s fetch timeout.
- Unparseable or missing config file: `readConfig()` already returns defaults — nudge treats that as enabled.
- `downloadAndInstall` failing mid-download must surface its error through `wrap()` with the binary untouched (guaranteed by Phase 02) — do not catch it in `updateCommand`.
- The nudge must not print when latest equals current (no "you are up to date" noise on every command).

## Acceptance criteria

- `bun run typecheck`, `bun run lint`, and `bun test` pass.
- `cpe update --check` against a dev build prints the dev-build message and exits 0 (verify by running `bun run src/index.ts update --check`).
- `cpe update` appears in `bun run src/index.ts --help` output with its description.
- nudge tests prove: no output and no fetch for `start`/`update` argv, dev builds, `update_auto: false`, and an unfulfilled throttle; exactly one stderr line when a newer tag is found; no exception propagates when the injected fetch rejects.
- README has the new Updating section.

## References

- `src/cli.ts` — `wrap()` and command registration patterns to copy exactly.
- `src/commands/status.ts` — smallest existing command, output tone.
- `src/commands/start.ts` — `interruptiblePause` shows the injectable-dependency-for-tests convention.
- `src/update/check.ts`, `src/update/install.ts`, `src/update/state.ts` — the Phase 02 API this phase consumes.
- `src/storage/config.ts` — `readConfig()` default behaviour the nudge relies on.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with a conventional commit message (e.g. `feat: phase 03 — cpe update command, update_auto flag, post-command nudge`). Do not make intermediate commits during the phase. If you find the working tree already has a commit for this phase (check `git log --oneline -3`), skip the commit step.
