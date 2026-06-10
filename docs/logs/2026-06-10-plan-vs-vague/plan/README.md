# Self-Update — Version Checking and Automatic Updating

## Problem

cpe has no way to keep itself up to date. The binary is installed once via
`scripts/install.sh` (or built locally) and never hears about new releases.

## Requirements

### Explicit commands
- `cpe update` — resolve the latest GitHub release, compare against the
  baked-in `CPE_VERSION`, download the matching `cpe-{os}-{arch}` asset,
  verify its SHA256 checksum, atomically replace the running binary, and
  report `vOLD → vNEW`.
- `cpe update --check` — report current vs latest version; change nothing.

### Automatic updating
- **`cpe start` (long-running TUI)**: check every 6 hours in the background
  and auto-install when a newer release exists. After a successful install,
  show a persistent yellow footer badge — `↑ vX.Y.Z installed — restart to
  apply` — in all TUI modes (badge only; no activity-feed event).
- **Short-lived CLI commands**: throttled check (at most once per 24 h,
  cached in `~/.local/state/cpe/update-check.json`). When a newer version
  exists, print one stderr line: `update available: vX.Y.Z — run cpe update`.
  Short-lived commands never install.

### Configuration and guards
- `update_auto?: boolean` in `AppConfig` (`~/.config/cpe/config.json`),
  default `true`. Setting `false` disables both the TUI auto-update loop and
  the CLI nudge. Explicit `cpe update` always works.
- Dev builds (`CPE_VERSION === 'dev'`) never check, nudge, or auto-install.

### Release integrity
- `release.yml` publishes a `SHA256SUMS` file alongside the four binaries.
- The updater downloads `SHA256SUMS` for the target tag and verifies the
  binary before swapping; it fails closed (clear error, no swap) on mismatch
  or if the file is missing from the release.
- `scripts/install.sh` also verifies when `SHA256SUMS` is present (warns and
  continues for older releases that predate it).

## Technical approach

- **Latest-version lookup**: HTTP request to
  `https://github.com/richardbenson/claude-plan-executor/releases/latest`
  with `redirect: 'manual'`; parse the tag from the `Location` header. No
  GitHub API, no rate limits, cheap enough for the CLI nudge.
- **Atomic swap**: download to a temp file in the same directory as
  `process.execPath`, chmod 755, verify SHA256, then `rename()` over
  `process.execPath`. Writing in place would hit `ETXTBSY`; rename is atomic
  and safe under a running process on Linux/macOS (the running session keeps
  its old inode — hence the restart badge).
- **Target path**: whatever the binary actually runs from
  (`process.execPath`), not a hardcoded `~/.local/bin/cpe`.
- **Check-state cache**: `~/.local/state/cpe/update-check.json`
  (`last_checked_at`, `latest_seen`), following the `src/storage/` module
  patterns (optional `base` parameter for tests).

## Documents

- [PROGRESS.md](PROGRESS.md) — phase status tracker
- [PHASE_01.md](PHASE_01.md) / [PHASE_01.prompt.md](PHASE_01.prompt.md) — release checksums
- [PHASE_02.md](PHASE_02.md) / [PHASE_02.prompt.md](PHASE_02.prompt.md) — updater core module
- [PHASE_03.md](PHASE_03.md) / [PHASE_03.prompt.md](PHASE_03.prompt.md) — CLI surface
- [PHASE_04.md](PHASE_04.md) / [PHASE_04.prompt.md](PHASE_04.prompt.md) — TUI auto-update + badge

## Branching

Single feature branch `feature/self-update` for all phases. No per-phase
branches or PRs; one PR to `main` at the end of Phase 04.

## Decisions and why

- **Redirect-parse over GitHub API**: unauthenticated API calls are limited
  to 60/h; the redirect trick has no such limit and returns in one round trip.
- **CLI nudge never installs**: a 92 MB download must not stall or race a
  short command; installs happen only where there is a long-lived process
  (TUI) or explicit intent (`cpe update`).
- **Fail closed on missing SHA256SUMS in the updater**: the updater only ever
  targets the *latest* release, and every release after this feature ships
  carries checksums, so a missing file means something is wrong.
- **Footer badge only** (user decision): a persistent badge cannot scroll
  away; an activity-feed event was judged unnecessary noise.
- **`docs/tui-design.html` is not regenerated**: DESIGN.md gets the badge
  spec; the HTML mock is out of scope.

## Definition of Done

- [ ] `cpe update --check` prints current and latest version on a release build
- [ ] `cpe update` replaces the binary at `process.execPath` and `cpe --version` then prints the new tag
- [ ] `cpe update` aborts (non-zero exit, binary untouched) on checksum mismatch
- [ ] Dev builds: `cpe update` explains self-update is disabled; no auto-check or nudge fires
- [ ] A release created by the updated `release.yml` contains `SHA256SUMS` covering all four binaries
- [ ] Short-lived commands print the one-line nudge at most once per 24 h, and never when `update_auto: false`
- [ ] `cpe start` auto-installs in the background and shows the footer badge in Watch, Manage, and Bench modes
- [ ] DESIGN.md documents the badge (placement, color, copy)
- [ ] `bun run typecheck`, `bun run lint`, and `bun test` pass after every phase
