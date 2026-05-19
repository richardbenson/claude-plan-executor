#!/usr/bin/env bash
# probe-git-worktree.sh
#
# What this answers:
#   - Can we git worktree add a new branch from main and get a clean workspace?
#   - Can we rename the branch (git branch -m) and then move the worktree
#     (git worktree move) while the worktree exists? In what order?
#   - Does git worktree remove cleanly tear it down?
#   - What happens if you try to add a worktree for a branch that already exists?
#
# This is the most risky bit of the worktree model — the rename-after-planning
# dance in §7.1 of the spec.
#
# Cost: zero. All in a tmp dir, deleted at end.

set -u

OUT_DIR="$(pwd)/probe-output"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/probe-git-worktree.log"
: > "$LOG"

say() { echo -e "$@" | tee -a "$LOG"; }
hr()  { say "\n=== $* ==="; }
run() { say "\$ $*"; eval "$*" 2>&1 | tee -a "$LOG"; }

WORK=$(mktemp -d)
trap "rm -rf '$WORK'" EXIT

say "probe-git-worktree.sh — $(date -Is)"
say "git version: $(git --version)"
say "scratch dir: $WORK"

PRIMARY="$WORK/primary"
WT_BASE="$WORK/worktrees"

hr "1. Set up a fake 'primary clone' with a main branch"
mkdir -p "$PRIMARY"
cd "$PRIMARY"
run "git init -q -b main"
run "git config user.email a@b"
run "git config user.name a"
run "echo '# proj' > README.md"
run "git add ."
run "git commit -q -m 'initial'"
run "git log --oneline"

hr "2. Add a worktree on a NEW branch off main"
run "git worktree add -b cpe/planning-1700000000 '$WT_BASE/run-abc' main"
run "git worktree list"
run "ls -la '$WT_BASE/run-abc'"

hr "3. Make a commit inside the worktree"
cd "$WT_BASE/run-abc"
run "git branch --show-current"
run "mkdir -p docs/001-add-tests"
run "echo 'progress' > docs/001-add-tests/PROGRESS.md"
run "git add ."
run "git commit -q -m 'docs: plan 001-add-tests'"
run "git log --oneline"

hr "4. Rename the branch (still inside the worktree)"
run "git branch -m feature/001-add-tests"
run "git branch --show-current"
run "git worktree list"
say "(note: worktree path is still .../run-abc/, but branch name has changed)"

hr "5. Move the worktree dir to match the new branch"
cd "$PRIMARY"  # leave the worktree we're about to move
run "git worktree move '$WT_BASE/run-abc' '$WT_BASE/feature-001-add-tests'"
run "git worktree list"
run "ls -la '$WT_BASE/feature-001-add-tests'"

hr "6. Confirm the worktree still works after the move"
cd "$WT_BASE/feature-001-add-tests"
run "git status"
run "git branch --show-current"
run "git log --oneline"

hr "7. Add a SECOND worktree for the same repo (different run)"
cd "$PRIMARY"
run "git worktree add -b cpe/planning-1700000999 '$WT_BASE/run-def' main"
run "git worktree list"
say "(both worktrees should coexist; this is the killer feature for queueing)"

hr "8. Try adding a worktree for an already-checked-out branch (should fail)"
run "git worktree add '$WT_BASE/run-zzz' feature/001-add-tests || echo '<-- expected failure'"

hr "9. Remove worktrees cleanly"
run "git worktree remove '$WT_BASE/feature-001-add-tests'"
run "git worktree remove '$WT_BASE/run-def'"
run "git worktree list"
run "git branch -a"
say "(the feature branch should still exist even though its worktree is gone)"

hr "10. Sanity: prune leftover worktree refs"
run "git worktree prune --verbose"

hr "DONE"
say "Full log: $LOG"
say ""
say "Things to verify in the output:"
say "  - step 2: new branch and worktree created cleanly"
say "  - step 4: branch renames in place, worktree list reflects new name"
say "  - step 5: worktree move works while worktree is not the cwd"
say "  - step 7: two worktrees coexist"
say "  - step 8: git refuses duplicate checkout (we'll need to handle this)"
