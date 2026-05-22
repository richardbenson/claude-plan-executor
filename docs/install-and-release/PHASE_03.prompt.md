Read docs/install-and-release/PHASE_03.md for full context before starting.

You are implementing Phase 03 of the install-and-release plan: install scripts. The goal is to add two shell scripts — one to build from source and install locally, one to download a pre-built binary from GitHub Releases.

**Idempotency**: Before each significant action (creating a file, making a commit), check the working tree state first — does the file already exist? Is this already committed? This makes the phase safe to resume after a rate-limit interruption.

**PROGRESS.md update**: At the start of this phase, update `docs/install-and-release/PROGRESS.md`: set the status for Phase 03 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with message `feat: phase 03 — install scripts`. Do not make intermediate commits. If `git log --oneline -3` already shows a commit for this phase, skip the commit step.

---

## Work to do

### 1. Create `scripts/install-local.sh`

Create the file with this logic:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Building cpe from source..."
bun build --compile --outfile cpe src/index.ts

mkdir -p "$HOME/.local/bin"
cp cpe "$HOME/.local/bin/cpe"

echo "Installed: $HOME/.local/bin/cpe"

if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  echo "Note: add $HOME/.local/bin to your PATH to use cpe from anywhere."
fi
```

### 2. Create `scripts/install.sh`

Create the file with this logic:

```bash
#!/usr/bin/env bash
set -euo pipefail

OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Linux)  os="linux"  ;;
  Darwin) os="darwin" ;;
  *)      echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  x86_64)          arch="x64"   ;;
  aarch64 | arm64) arch="arm64" ;;
  *)               echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

ASSET="cpe-${os}-${arch}"
URL="https://github.com/richardbenson/claude-plan-executor/releases/latest/download/${ASSET}"

echo "Detected platform: ${os}-${arch}"
echo "Downloading ${ASSET}..."

mkdir -p "$HOME/.local/bin"
curl -fsSL "$URL" -o "$HOME/.local/bin/cpe"
chmod +x "$HOME/.local/bin/cpe"

echo "Installed: $HOME/.local/bin/cpe"

if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  echo "Note: add $HOME/.local/bin to your PATH to use cpe from anywhere."
fi
```

### 3. Make both scripts executable and commit with correct permissions

After creating each file, run `chmod +x scripts/install-local.sh scripts/install.sh`.

When staging for the commit, use `git add --chmod=+x scripts/install-local.sh scripts/install.sh` to ensure the executable bit is recorded in git even on filesystems where it might not be set.

### 4. Verify

Run `bash -n scripts/install-local.sh && echo OK` — must print `OK` (syntax check only, does not execute).
Run `bash -n scripts/install.sh && echo OK` — must print `OK`.

Check file permissions: `ls -la scripts/` — both files must show `-rwxr-xr-x` or similar (executable).

---

## Acceptance criteria

- `scripts/install-local.sh` exists and is executable
- `scripts/install.sh` exists and is executable
- Both scripts pass `bash -n` syntax check
- `install-local.sh` changes directory to the repo root before building, so it works from any working directory
- `install.sh` handles all four platform combinations: linux-x64, linux-arm64, darwin-x64, darwin-arm64
- `install.sh` prints a clear error and exits non-zero for unsupported OS or arch
- Both scripts print a PATH reminder if `~/.local/bin` is not already on `$PATH`
- Both files are committed with executable bit set in git

---

**Structured output**: Your final message in this conversation must be a JSON object matching the schema you have been given. Do all your work using tools first, then emit only the JSON as your closing message.
