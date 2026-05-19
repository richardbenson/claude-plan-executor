#!/usr/bin/env bash
# probe-claude-json-schema.sh
#
# What this answers:
#   - Does --json-schema constrain the final message to the schema shape?
#   - Does it work alongside --print (-p)?
#   - Does the JSON appear on stdout, or wrapped in some envelope?
#   - What does Claude do if the prompt's natural answer would be prose, not JSON?
#     (this is what happens after the model has done tool work and needs to
#     emit a structured result at the end)
#   - Does the schema have to be inline JSON, or can it be a file path?
#
# Cost: ~3 small `claude -p` calls.
#
# Run from anywhere.

set -u

OUT_DIR="$(dirname "$0")/probe-output"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/probe-claude-json-schema.log"
: > "$LOG"

say() { echo -e "$@" | tee -a "$LOG"; }
hr()  { say "\n=== $* ==="; }

say "probe-claude-json-schema.sh — $(date -Is)"

# Simple schema mimicking a slimmed phase result
SCHEMA='{
  "type": "object",
  "required": ["completed", "summary"],
  "properties": {
    "completed": { "type": "boolean" },
    "summary":   { "type": "string", "maxLength": 200 },
    "blockers":  { "type": "array", "items": { "type": "string" } }
  }
}'

# hr "1. Headless with inline --json-schema"
# say "Prompt: 'You finished a small task. Reply with a result object.'"
# say "Schema (inline):"
# say "$SCHEMA"
# say ""

# OUT=$(claude -p --json-schema "$SCHEMA" \
#   "You just completed adding a unit test for the login function. Reply with a result object describing what you did. No blockers." \
#   2>&1)
# EC=$?
# say "exit code: $EC"
# say "stdout/stderr (combined):"
# say "----"
# say "$OUT"
# say "----"

# hr "2. Same, but try to force a schema violation"
# say "Asking Claude to reply with free prose instead of JSON — see if it conforms anyway."
# OUT=$(claude -p --json-schema "$SCHEMA" \
#   "Reply with a friendly paragraph about your day. Don't use JSON." \
#   2>&1)
# EC=$?
# say "exit code: $EC"
# say "stdout/stderr (combined):"
# say "----"
# say "$OUT"
# say "----"

hr "3. Test interaction with --output-format=json"
say "Does --json-schema combine with --output-format=json? What does the envelope look like?"
OUT=$(claude -p --output-format=json --json-schema "$SCHEMA" \
  "You finished a refactor. Reply with a result object." \
  2>&1)
EC=$?
say "exit code: $EC"
say "stdout (raw):"
say "----"
say "$OUT"
say "----"
say "If this is JSON-wrapped, pretty-print it:"
say "$OUT" | python3 -m json.tool 2>&1 | tee -a "$LOG" || true

hr "DONE"
say "Full log: $LOG"
say ""
say "What to look for:"
say "  - Section 1: output is valid JSON matching the schema, on stdout, exit 0"
say "  - Section 2: schema wins over the prose instruction (or it errors clearly)"
say "  - Section 3: shape of the --output-format=json envelope when combined"
