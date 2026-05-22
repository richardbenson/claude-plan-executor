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
