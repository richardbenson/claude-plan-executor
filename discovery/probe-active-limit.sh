#!/usr/bin/env bash
# probe-active-limit.sh
#
# Run this ONLY when you're already close to your session limit (e.g. 99%
# according to the usage monitor or claude.ai's UI). It will fire repeated
# `claude -p` calls until one of them errors, capturing exit code and full
# stdout/stderr for each call.
#
# What this answers:
#   - When you're rate-limited, does `claude -p` exit non-zero? With what code?
#   - Does the error appear on stdout, stderr, or both?
#   - What does the error string actually look like? Is the reset time included?
#   - Or does it just hang? (We use a timeout.)
#
# Cost: by definition, the last bit of your current session window.
#
# Safety: capped at 30 calls + a per-call timeout, so it can't loop forever.

set -u

OUT_DIR="$(dirname "$0")/probe-output"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/probe-active-limit.log"
: > "$LOG"

MAX_CALLS=30
PER_CALL_TIMEOUT=120  # seconds

say() { echo -e "$@" | tee -a "$LOG"; }
hr()  { say "\n=== $* ==="; }

say "probe-active-limit.sh — $(date -Is)"
say "Will make up to $MAX_CALLS calls to 'claude -p' with a ${PER_CALL_TIMEOUT}s timeout each."
say "Stops on first non-zero exit, or after $MAX_CALLS, or Ctrl-C."
say ""
read -p "Are you near your session limit? (y/N) " CONFIRM
if [[ "${CONFIRM,,}" != "y" ]]; then
  say "aborted by user."
  exit 1
fi

for i in $(seq 1 $MAX_CALLS); do
  hr "call $i / $MAX_CALLS"
  START=$(date +%s)

  STDOUT_FILE=$(mktemp)
  STDERR_FILE=$(mktemp)

  timeout "$PER_CALL_TIMEOUT" claude -p "reply with the single word OK and nothing else" \
    > "$STDOUT_FILE" 2> "$STDERR_FILE"
  EC=$?

  END=$(date +%s)
  ELAPSED=$((END - START))

  say "exit code: $EC"
  say "elapsed:   ${ELAPSED}s"
  say "stdout (first 50 lines):"
  say "----"
  head -50 "$STDOUT_FILE" | tee -a "$LOG"
  say "----"
  say "stderr (first 50 lines):"
  say "----"
  head -50 "$STDERR_FILE" | tee -a "$LOG"
  say "----"

  rm -f "$STDOUT_FILE" "$STDERR_FILE"

  if [[ $EC -ne 0 ]]; then
    say ""
    say ">>> non-zero exit on call $i — assume limit hit. Stopping."
    say ">>> Look above for: exit code, reset time string, any structured error."
    break
  fi

  # tiny gap so we're not hammering
  sleep 1
done

hr "DONE"
say "Full log: $LOG"
say ""
say "Things to look for in the final non-zero call:"
say "  - exact stdout/stderr error text (we'll regex-match this)"
say "  - presence of a reset time / 'try again in X' phrase"
say "  - distinct exit code (vs e.g. 1 for generic errors)"
say "  - whether the message is on stdout or stderr"
