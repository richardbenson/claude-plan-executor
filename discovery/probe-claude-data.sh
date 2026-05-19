#!/usr/bin/env bash
# probe-claude-data.sh
#
# What this answers:
#   - Does ~/.claude/projects/ exist on your machine?
#   - What's in it? jsonl files per project?
#   - What fields do session entries contain? (token counts, timestamps, model names?)
#   - Anything that looks like a 5-hour-window marker or rate-limit signal?
#
# This is what Claude-Code-Usage-Monitor reads. If we can read it too, we get
# predictive limit detection instead of just stdout-parsing after the fact.
#
# Cost: zero. Read-only.

set -u

OUT_DIR="$(dirname "$0")/probe-output"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/probe-claude-data.log"
: > "$LOG"

say() { echo -e "$@" | tee -a "$LOG"; }
hr()  { say "\n=== $* ==="; }

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

say "probe-claude-data.sh — $(date -Is)"
say "CLAUDE_CONFIG_DIR env: ${CLAUDE_CONFIG_DIR:-(unset, using \$HOME/.claude)}"
say "Looking at: $CLAUDE_DIR"

if [[ ! -d "$CLAUDE_DIR" ]]; then
  say "DIRECTORY DOES NOT EXIST. Either Claude Code hasn't been used yet,"
  say "or it's storing data somewhere else. Try:"
  say "  find \$HOME -maxdepth 4 -type d -name 'projects' 2>/dev/null | grep -i claude"
  exit 1
fi

hr "1. Top-level layout"
ls -la "$CLAUDE_DIR" | tee -a "$LOG"

hr "2. projects/ subdir"
if [[ -d "$CLAUDE_DIR/projects" ]]; then
  say "found $CLAUDE_DIR/projects"
  COUNT=$(find "$CLAUDE_DIR/projects" -type d | wc -l)
  say "subdir count (incl projects/ itself): $COUNT"
  say ""
  say "Tree (2 levels):"
  find "$CLAUDE_DIR/projects" -maxdepth 2 -type d | tee -a "$LOG"
else
  say "no projects/ subdir."
fi

hr "3. JSONL files"
mapfile -t JSONL_FILES < <(find "$CLAUDE_DIR" -name '*.jsonl' -type f 2>/dev/null | head -20)
say "found ${#JSONL_FILES[@]} jsonl file(s) (capped at 20):"
for f in "${JSONL_FILES[@]}"; do
  LINES=$(wc -l <"$f" 2>/dev/null || echo 0)
  SIZE=$(stat -c%s "$f" 2>/dev/null || echo 0)
  say "  $f  ($LINES lines, $SIZE bytes)"
done

if [[ ${#JSONL_FILES[@]} -eq 0 ]]; then
  say "no jsonl files found — nothing more to probe."
  exit 0
fi

hr "4. Field summary across all jsonl lines"
say "Unique top-level keys seen:"
# Read all jsonl lines, extract top-level keys, sort | uniq
for f in "${JSONL_FILES[@]}"; do
  cat "$f"
done 2>/dev/null | \
  python3 -c '
import sys, json
keys = {}
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        obj = json.loads(line)
        for k in obj.keys():
            keys[k] = keys.get(k, 0) + 1
    except Exception:
        pass
for k, n in sorted(keys.items(), key=lambda x: -x[1]):
    print(f"  {n:>8}  {k}")
' | tee -a "$LOG"

hr "5. One sample line (first jsonl, first line) — REDACTED"
FIRST="${JSONL_FILES[0]}"
say "from: $FIRST"
say ""
say "Showing top-level keys + value TYPES only, not values (privacy):"
head -1 "$FIRST" | python3 -c '
import sys, json
line = sys.stdin.read().strip()
obj = json.loads(line)
def kind(v):
    if isinstance(v, dict): return f"dict({len(v)} keys: {list(v.keys())[:5]})"
    if isinstance(v, list): return f"list(len={len(v)})"
    if isinstance(v, str): return f"str(len={len(v)})"
    return type(v).__name__
for k, v in obj.items():
    print(f"  {k}: {kind(v)}")
' | tee -a "$LOG"

hr "6. Token / usage / limit related fields"
say "Grepping all jsonl for keys that look usage-related..."
for f in "${JSONL_FILES[@]}"; do
  cat "$f"
done 2>/dev/null | \
  python3 -c '
import sys, json
hits = {}
def walk(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            kl = k.lower()
            if any(t in kl for t in ["token", "usage", "limit", "rate", "reset", "quota", "block", "session"]):
                hits.setdefault(path + "." + k, set()).add(type(v).__name__)
            walk(v, path + "." + k)
    elif isinstance(obj, list):
        for item in obj:
            walk(item, path + "[]")
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        walk(json.loads(line))
    except: pass
for path, types in sorted(hits.items()):
    print(f"  {path}  -> {types}")
' | tee -a "$LOG"

hr "DONE"
say "Full log: $LOG"
say ""
say "Look in the output for: token counts, model names, timestamps, anything"
say "that looks like a session/block boundary or a reset time."
