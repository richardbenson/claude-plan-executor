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

# ---- dependency checks ----
echo ""

# Required on Linux: bubblewrap and socat for Claude sandbox isolation.
# cpe works without them but sessions will run unsandboxed.
if [[ "$OS" == "Linux" ]]; then
  missing_sandbox=()
  command -v bwrap  >/dev/null 2>&1 || missing_sandbox+=("bubblewrap")
  command -v socat  >/dev/null 2>&1 || missing_sandbox+=("socat")

  if [[ ${#missing_sandbox[@]} -gt 0 ]]; then
    echo "[warn] Missing sandbox dependencies: ${missing_sandbox[*]}"
    echo "       cpe will work but Claude sessions will run without sandbox isolation."
    echo "       Install with your package manager, e.g.:"
    if command -v apt-get >/dev/null 2>&1; then
      echo "         sudo apt-get install ${missing_sandbox[*]}"
    elif command -v dnf >/dev/null 2>&1; then
      echo "         sudo dnf install ${missing_sandbox[*]}"
    elif command -v pacman >/dev/null 2>&1; then
      echo "         sudo pacman -S ${missing_sandbox[*]}"
    else
      echo "         (use your distro's package manager)"
    fi
    echo "       See: https://docs.anthropic.com/en/docs/claude-code/security#sandboxing"
    echo ""
  fi
fi

# Optional: RTK reduces Claude token usage by 60-90%, saving cost across cpe sessions.
# Guard against the name collision with Rust Type Kit by testing 'rtk gain'.
rtk_ok=false
if command -v rtk >/dev/null 2>&1 && rtk gain >/dev/null 2>&1; then
  rtk_ok=true
fi

if ! $rtk_ok; then
  echo "[info]  RTK (optional) is not installed."
  echo "        RTK reduces Claude token usage by 60-90% across cpe sessions."
  echo "        Install: curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh"
  echo "        Setup:   rtk init -g"
  echo "        More:    https://github.com/rtk-ai/rtk"
  echo ""
fi
