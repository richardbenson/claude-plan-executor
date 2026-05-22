# Install and Release

## Overview

Adds a complete release pipeline and user-facing install story for the `cpe` binary.

## Requirements

- **GitHub Actions CI**: Runs typecheck, lint, and tests on every push and pull request
- **GitHub Actions Release**: Triggered on `v*` tags; builds platform binaries for all four targets and publishes a GitHub Release with them as assets
- **Platforms**: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64` — all cross-compiled from a single Ubuntu runner using Bun
- **Version embedding**: `CPE_VERSION` is injected at build time via Bun `--define`; falls back to `'dev'` when built locally without the flag; CI passes the git tag name
- **Local install script** (`scripts/install-local.sh`): builds from source using `bun build --compile`, copies the resulting binary to `~/.local/bin/cpe`
- **Remote install script** (`scripts/install.sh`): auto-detects OS and CPU architecture, downloads the correct binary from the GitHub Release `latest` endpoint, places it at `~/.local/bin/cpe`

## Scope

| Phase | Title | Files |
|-------|-------|-------|
| 01 | Version embedding | `src/version.ts`, `src/cli.ts` |
| 02 | GitHub Actions workflows | `.github/workflows/ci.yml`, `.github/workflows/release.yml` |
| 03 | Install scripts | `scripts/install-local.sh`, `scripts/install.sh` |

## Documents

- [PROGRESS.md](PROGRESS.md)
- [PHASE_01.md](PHASE_01.md) / [PHASE_01.prompt.md](PHASE_01.prompt.md)
- [PHASE_02.md](PHASE_02.md) / [PHASE_02.prompt.md](PHASE_02.prompt.md)
- [PHASE_03.md](PHASE_03.md) / [PHASE_03.prompt.md](PHASE_03.prompt.md)

## Definition of Done

- `cpe --version` prints the git tag (e.g. `v1.0.0`) when built by CI, and `dev` when built locally without the define flag
- Pushing a `v*` tag triggers the release workflow, builds all four platform binaries, and creates a GitHub Release with them attached
- PRs trigger the CI workflow (typecheck, lint, test) and fail if any check fails
- `scripts/install-local.sh` run from any directory builds and installs the binary to `~/.local/bin/cpe`
- `scripts/install.sh` correctly identifies the current platform and downloads the matching binary from the latest GitHub Release
- All scripts are executable (`chmod +x`)
