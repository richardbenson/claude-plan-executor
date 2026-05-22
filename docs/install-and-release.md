# Install and Release

## Original Requirements

Add a complete release pipeline and user-facing install story for the `cpe` binary:

- **GitHub Actions CI**: Run typecheck, lint, and tests on every push and pull request to `main`.
- **GitHub Actions Release**: Trigger on `v*` tag pushes; build four platform binaries (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`) using Bun cross-compilation from a single Ubuntu runner, then publish a GitHub Release with all four binaries attached as assets.
- **Version embedding**: Inject `CPE_VERSION` at build time via Bun `--define`; fall back to `'dev'` for local builds without the flag; CI passes the git tag name.
- **Local install script** (`scripts/install-local.sh`): Build from source using `bun build --compile` and copy the binary to `~/.local/bin/cpe`.
- **Remote install script** (`scripts/install.sh`): Auto-detect OS and CPU architecture, download the correct binary from the GitHub Release `latest` endpoint, place it at `~/.local/bin/cpe`.

Definition of done: `cpe --version` prints the tag in CI builds and `dev` locally; a `v*` tag push triggers a full release; PRs are gated by CI; both install scripts work correctly.

## What Was Built

All three phases were completed on 2026-05-22 with no deviations from the plan.

### Phase 01 — Version embedding (`b7de2ab`)

- Created `src/version.ts` exporting `CPE_VERSION: string = process.env.CPE_VERSION ?? 'dev'`.
- Updated `src/cli.ts` to import `CPE_VERSION` from `./version.js` and pass it to `program.version()`, removing the hardcoded `'0.1.0'` string.
- Bun's `--define` flag replaces `process.env.CPE_VERSION` at compile time, so the fallback `'dev'` is a local-build-only code path and the CI-injected value is baked into the binary with no runtime env dependency.

### Phase 02 — GitHub Actions workflows (`dd764fc`)

- Created `.github/workflows/ci.yml`: triggers on push to any branch and on PRs targeting `main`; single `check` job on `ubuntu-latest` running `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, and `bun test`.
- Created `.github/workflows/release.yml`: triggers on `v*` tag pushes; a `build` job uses a 4-entry matrix (`bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`) to cross-compile all targets in parallel on Ubuntu; each job uploads its binary as a GitHub Actions artifact. A downstream `release` job (`needs: build`, `permissions: contents: write`) downloads all four artifacts and runs `gh release create --generate-notes` to publish the GitHub Release.

### Phase 03 — Install scripts (`5b2237a`)

- Created `scripts/install-local.sh`: `cd`s to the repo root from any working directory, builds with `bun build --compile`, copies the binary to `~/.local/bin/cpe`, and prints a PATH reminder if needed.
- Created `scripts/install.sh`: detects OS (`uname -s`) and arch (`uname -m`), maps to asset names, downloads with `curl -fsSL` from the `releases/latest/download` URL, marks executable, and prints a PATH reminder. Exits with a clear error message for unsupported platforms.
- Both scripts committed with executable bit set via `git add --chmod=+x`.

## Lessons Learned

**Bun `--define` is compile-time only.** `process.env.CPE_VERSION` is replaced at compile time, not at runtime. This means the binary carries the baked-in version string — there is no way to override it without rebuilding. The `?? 'dev'` fallback becomes dead code in CI builds. This is the intended behaviour but worth noting if you ever need dynamic versioning.

**Cross-compilation from Ubuntu.** Bun supports compiling to all four targets (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`) from a single `ubuntu-latest` runner. No macOS or ARM runners are needed for the build matrix, which keeps CI costs low and parallelism straightforward.

**Artifact hand-off between jobs.** The standard `upload-artifact` / `download-artifact` pattern for passing binaries between the matrix `build` job and the `release` job works well. Each artifact is uploaded by asset name; the release job downloads them all into an `artifacts/` directory and passes the nested paths to `gh release create`.

**`gh release create --generate-notes`.** Auto-generating release notes from merged PRs requires that the repo uses GitHub — this is assumed throughout but worth flagging if the project is ever mirrored elsewhere.

**PATH reminder pattern.** Both install scripts use `[[ ":$PATH:" != *":$HOME/.local/bin:"* ]]` to detect whether the install directory is already on `PATH`. This is a shell-portable idiom that avoids false positives from partial matches (e.g. `/usr/local/bin` matching a naive grep for `local/bin`).

**`install.sh` handles both `aarch64` and `arm64`.** Linux reports `aarch64`; macOS reports `arm64`. The case statement handles both spellings and maps them to the same `arm64` asset name.
