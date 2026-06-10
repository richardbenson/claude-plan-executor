# Phase 01 — Release checksums (SHA256SUMS)

**Branch:** feature/self-update
**Dependencies:** none

## Summary

Add a `SHA256SUMS` file to every GitHub release so the updater (Phase 02) and
`scripts/install.sh` can verify downloaded binaries. This phase ships first so
that the next tagged release already carries checksums by the time the updater
exists.

## Context

- `.github/workflows/release.yml` has two jobs: a 4-entry matrix `build` job
  that uploads each binary as an artifact named after the asset
  (`cpe-linux-x64`, `cpe-linux-arm64`, `cpe-darwin-x64`, `cpe-darwin-arm64`),
  and a `release` job that downloads them into `artifacts/` — note the nested
  layout `artifacts/<asset>/<asset>` — and runs `gh release create` listing
  each binary path plus `scripts/install.sh`.
- `SHA256SUMS` must contain **bare asset names** (e.g.
  `<hash>  cpe-linux-x64`), not nested artifact paths, so verifiers can match
  by filename. The binaries therefore need to be collected into one flat
  directory before hashing.
- `scripts/install.sh` downloads from the `releases/latest/download/` URL,
  detects OS/arch via `uname`, and currently does no verification. It must
  keep working against releases that predate `SHA256SUMS` (warn + continue on
  404), because the script itself is published as a release asset and users
  may run a new script against an old release. macOS has `shasum -a 256`, not
  `sha256sum`.

## Files expected to change

- `.github/workflows/release.yml` — generate and attach `SHA256SUMS`
- `scripts/install.sh` — download and verify checksum when available
- `docs/install-and-release.md` — short "What changed" note documenting the new asset
