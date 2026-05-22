# Phase 02 — GitHub Actions workflows

## Summary

Add two GitHub Actions workflow files. The CI workflow runs typecheck, lint, and tests on every push and on pull requests to `main`. The release workflow triggers on `v*` tag pushes, builds four platform binaries via Bun cross-compilation from a single Ubuntu runner, and publishes a GitHub Release with all four binaries attached as assets.

## Context

- Repo: `https://github.com/richardbenson/claude-plan-executor`
- Binary name: `cpe`
- Build command: `bun build --compile --target=<target> --define 'process.env.CPE_VERSION="<tag>"' --outfile <asset> src/index.ts`
- Bun cross-compilation targets and their asset names:

| Bun target | Asset name |
|------------|------------|
| `bun-linux-x64` | `cpe-linux-x64` |
| `bun-linux-arm64` | `cpe-linux-arm64` |
| `bun-darwin-x64` | `cpe-darwin-x64` |
| `bun-darwin-arm64` | `cpe-darwin-arm64` |

- All four cross-compilation jobs run on `ubuntu-latest` — Bun supports cross-compiling to all four targets from Linux.
- The release job downloads all four build artifacts and creates a GitHub Release using the `gh` CLI (available in GitHub Actions runners with `GH_TOKEN` set to `secrets.GITHUB_TOKEN`).
- The release workflow needs `permissions: contents: write` on the release job.

## Files Expected to Change

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | New — CI checks on push/PR |
| `.github/workflows/release.yml` | New — build matrix + release on tag |

## Design notes

The release workflow uses a matrix strategy so all four builds run in parallel. A separate `release` job with `needs: build` downloads artifacts and creates the release. Using `actions/upload-artifact` and `actions/download-artifact` to pass binaries between jobs is the standard pattern.

The `gh release create` command should use `--generate-notes` to auto-populate release notes from merged PRs.

Tag format the workflow should match: `v*` (e.g. `v1.0.0`, `v0.2.1`).
