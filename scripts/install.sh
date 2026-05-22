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
