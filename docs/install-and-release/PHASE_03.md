# Phase 03 — Install scripts

## Summary

Add two shell scripts under `scripts/`. The first builds the binary from source and installs it locally. The second downloads a pre-built binary from GitHub Releases for the current platform.

## Context

Both scripts install to `~/.local/bin/cpe`. No `sudo` is required.

### `scripts/install-local.sh`

- Must work when called from any working directory (use `cd "$(dirname "$0")/.."` to move to the repo root before building)
- Runs `bun build --compile --outfile cpe src/index.ts`
- Copies the resulting `cpe` binary to `$HOME/.local/bin/cpe`
- Prints a confirmation message
- Prints a reminder if `~/.local/bin` is not on `$PATH`

### `scripts/install.sh`

- Detects OS with `uname -s` (returns `Linux` or `Darwin`)
- Detects arch with `uname -m` (returns `x86_64`, `aarch64`, or `arm64`)
- Maps to asset names:
  - Linux + x86_64 → `cpe-linux-x64`
  - Linux + aarch64 → `cpe-linux-arm64`
  - Darwin + x86_64 → `cpe-darwin-x64`
  - Darwin + arm64 → `cpe-darwin-arm64`
- Exits with a clear message if OS or arch is unsupported
- Downloads from: `https://github.com/richardbenson/claude-plan-executor/releases/latest/download/<asset>`
- Uses `curl -fsSL` with `-o "$HOME/.local/bin/cpe"`
- Makes the file executable with `chmod +x`
- Prints a confirmation message
- Prints a reminder if `~/.local/bin` is not on `$PATH`

## Files Expected to Change

| File | Change |
|------|--------|
| `scripts/install-local.sh` | New — build from source + install |
| `scripts/install.sh` | New — download pre-built binary + install |

Both files must be committed with executable permissions (`chmod +x` before committing, or `git add --chmod=+x`).
