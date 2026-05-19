#!/usr/bin/env bash
# snapshot-claude-data.sh
#
# Captures a snapshot of ~/.claude/ for later comparison. Run twice:
#   1. Before/during a heavy Claude Code session
#   2. Once you've naturally hit (or come very close to) a session limit
# Then diff the two with `diff -u`.
#
# Goal: see what fields appear / change when a limit kicks in, so we can
# reliably detect it from data files rather than (or in addition to) stdout.
#
# Cost: zero. Read-only.
#
# Usage:
#   ./snapshot-claude-data.sh before
#   # ... use claude normally for a few hours, hit your limit ...
#   ./snapshot-claude-data.sh after
#   diff -u probe-output/snap-before.txt probe-output/snap-after.txt

set -u

OUT_DIR="$(dirname "$0")/probe-output"
mkdir -p "$OUT_DIR"

LABEL="${1:-snap-$(date +%s)}"
SNAP="$OUT_DIR/snap-$LABEL.txt"
RAW_DIR="$OUT_DIR/snap-$LABEL.raw"
mkdir -p "$RAW_DIR"

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

if [[ ! -d "$CLAUDE_DIR" ]]; then
  echo "no $CLAUDE_DIR" >&2
  exit 1
fi

{
  echo "snapshot: $LABEL"
  echo "taken:    $(date -Is)"
  echo "source:   $CLAUDE_DIR"
  echo ""
  echo "=== file inventory ==="
  find "$CLAUDE_DIR" -type f \( -name '*.jsonl' -o -name '*.json' \) \
    -printf '%P  %s bytes  mtime=%T@\n' 2>/dev/null | sort

  echo ""
  echo "=== last 5 lines of each jsonl (top-level keys + value types only) ==="
  while IFS= read -r f; do
    echo ""
    echo "--- ${f#$CLAUDE_DIR/} ---"
    tail -5 "$f" 2>/dev/null | python3 -c '
import sys, json
def kind(v):
    if isinstance(v, dict): return f"dict(keys={list(v.keys())})"
    if isinstance(v, list): return f"list(len={len(v)})"
    if isinstance(v, str): return f"str(len={len(v)})"
    return type(v).__name__
for i, line in enumerate(sys.stdin):
    line = line.strip()
    if not line: continue
    try:
        obj = json.loads(line)
        print(f"  line {i}:")
        for k, v in obj.items():
            print(f"    {k}: {kind(v)}")
    except Exception as e:
        print(f"  line {i}: PARSE ERROR ({e})")
'
  done < <(find "$CLAUDE_DIR" -name '*.jsonl' -type f 2>/dev/null | sort)

  echo ""
  echo "=== usage-shaped fields seen (any depth) ==="
  find "$CLAUDE_DIR" -name '*.jsonl' -type f -exec cat {} + 2>/dev/null | \
    python3 -c '
import sys, json
hits = {}
def walk(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            kl = k.lower()
            if any(t in kl for t in ["token","usage","limit","rate","reset","quota","block","session","cost","tier"]):
                # capture both type and (for primitives) example value
                if isinstance(v, (int, float, bool)) or v is None:
                    hits.setdefault(path+"."+k, set()).add(f"{type(v).__name__}={v}")
                elif isinstance(v, str) and len(v) < 80:
                    hits.setdefault(path+"."+k, set()).add(f"str={v!r}")
                else:
                    hits.setdefault(path+"."+k, set()).add(type(v).__name__)
            walk(v, path+"."+k)
    elif isinstance(obj, list):
        for it in obj: walk(it, path+"[]")
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try: walk(json.loads(line))
    except: pass
for p, vs in sorted(hits.items()):
    for v in sorted(vs):
        print(f"  {p} = {v}")
'
} > "$SNAP"

# also copy the raw jsonl files so we can do a real diff later if needed
find "$CLAUDE_DIR" -name '*.jsonl' -type f 2>/dev/null | while IFS= read -r f; do
  REL="${f#$CLAUDE_DIR/}"
  DST="$RAW_DIR/$REL"
  mkdir -p "$(dirname "$DST")"
  cp "$f" "$DST"
done

echo "snapshot saved: $SNAP"
echo "raw copies:     $RAW_DIR"
echo ""
echo "Next: take an 'after' snapshot once you've hit a limit, then:"
echo "  diff -u $OUT_DIR/snap-before.txt $OUT_DIR/snap-after.txt"
