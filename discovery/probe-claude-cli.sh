#!/usr/bin/env bash
# probe-claude-cli.sh
#
# What this answers:
#   - Is `claude -p` actually a thing, and what's its surface?
#   - Does it accept stdin? A prompt as positional arg? Both?
#   - What's the exit code on success?
#   - Can interactive mode be seeded with an initial message from a file?
#   - Does it honour `cwd` for project context, or find the repo some other way?
#
# Cost: small. A handful of trivial `claude -p` calls (each one a token or two
# of output). Won't materially dent your limit.
#
# Run from anywhere.

set -u  # no -e, we WANT to capture failures

OUT_DIR="$(dirname "$0")/probe-output"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/probe-claude-cli.log"
: > "$LOG"

say() { echo -e "$@" | tee -a "$LOG"; }
hr()  { say "\n=== $* ==="; }

say "probe-claude-cli.sh — $(date -Is)"
say "claude binary: $(command -v claude || echo 'NOT FOUND')"
say "claude version: $(claude --version 2>&1 || echo 'no --version')"

hr "1. Help dump"
claude --help 2>&1 | tee -a "$LOG" | head -200 >/dev/null
say "(full --help captured to log; first 200 lines shown above)"

hr "2. Headless with positional prompt"
say "Running: claude -p 'reply with the single word PONG and nothing else'"
START=$(date +%s)
OUT=$(claude -p "reply with the single word PONG and nothing else" 2>&1)
EC=$?
END=$(date +%s)
say "exit code: $EC"
say "elapsed:   $((END-START))s"
say "stdout/stderr (combined):"
say "----"
say "$OUT"
say "----"

hr "3. Headless with prompt on stdin"
say "Running: echo '...' | claude -p"
START=$(date +%s)
OUT=$(echo "reply with the single word STDIN and nothing else" | claude -p 2>&1)
EC=$?
END=$(date +%s)
say "exit code: $EC"
say "elapsed:   $((END-START))s"
say "stdout/stderr (combined):"
say "----"
say "$OUT"
say "----"

hr "4. Headless with prompt file via shell redirect"
PROMPT_FILE="$(mktemp)"
echo "reply with the single word FILE and nothing else" > "$PROMPT_FILE"
say "Running: claude -p < $PROMPT_FILE"
OUT=$(claude -p < "$PROMPT_FILE" 2>&1)
EC=$?
say "exit code: $EC"
say "stdout/stderr:"
say "----"
say "$OUT"
say "----"
rm -f "$PROMPT_FILE"

hr "5. cwd / project context check"
TMPDIR_TEST=$(mktemp -d)
cd "$TMPDIR_TEST"
git init -q
echo "# tmp" > README.md
git add . && git -c user.email=a@b -c user.name=a commit -q -m init
say "tmp git repo: $TMPDIR_TEST"
say "Running claude -p from inside the tmp repo, asking what dir it's in"
OUT=$(claude -p "What is the absolute path of the current working directory you have access to? Reply with only the path." 2>&1)
EC=$?
say "exit code: $EC"
say "claude says cwd is:"
say "----"
say "$OUT"
say "----"
say "expected: $TMPDIR_TEST"
cd - >/dev/null
rm -rf "$TMPDIR_TEST"

hr "6. Initial-message-from-file in interactive mode (HUMAN STEP)"
say "NOT automated — you need to try this manually."
say ""
say "Try each of these in turn, see which (if any) actually seeds the conversation:"
say ""
say "  claude < some_file.md"
say "  claude --append-system-prompt \"\$(cat some_file.md)\""
say "  claude --system-prompt \"\$(cat some_file.md)\""
say "  cat some_file.md | claude"
say ""
say "Goal: launch interactive Claude with a multi-page prompt already loaded as if"
say "the user had typed it. Note which flag works and what the UX is like (does the"
say "prompt show in the session history, or stay hidden?)."

hr "DONE"
say "Full log: $LOG"
