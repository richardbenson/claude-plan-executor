# CPE pre-build probes

Small bash scripts to validate assumptions before we start building the tool. Each one targets a specific open question from §11 of the spec.

Run order doesn't strictly matter, but this is what I'd suggest:

| # | Script | What it answers | When to run |
|---|---|---|---|
| 1 | `probe-claude-cli.sh` | Does `claude -p` work headless? Does interactive mode accept an initial message from a file? What flags exist? | Anytime — no limit cost |
| 2 | `probe-claude-data.sh` | What's in `~/.claude/projects/`? Can we read session/usage data from there? | Anytime — read-only |
| 3 | `probe-git-worktree.sh` | Does the planning-branch → feature-branch rename + worktree-move dance work? | Anytime — uses a temp repo |
| 4 | `snapshot-claude-data.sh` | Captures the state of `~/.claude/projects/` to a file. Run twice (before/after a limit hit) and diff. | Before a heavy session, and again after you've hit a limit |
| 5 | `probe-active-limit.sh` | What does `claude -p` do when you've actually hit the limit? Exit code, stdout, stderr. | Only when you're at 99% or just past — burns a few calls |

All scripts write to stdout and (where useful) save artifacts under `./probe-output/`.

## Setup

```
chmod +x *.sh
```

(File permissions don't survive transfer from the chat sandbox, so do this once after copying.)

## Already verified

I smoke-tested `probe-git-worktree.sh` end-to-end in the sandbox. All 10 steps pass on git 2.43, including the `cpe/planning-<ts>` → `feature/<folder>` rename + `git worktree move` dance. One observation worth carrying into the build:

- When you `git worktree remove` a worktree, the underlying branch is **not** deleted. The tool needs to explicitly `git branch -D <temp>` when binning an abandoned planning worktree, or you'll accumulate dead `cpe/planning-*` branches.

You should still run the script on your machine to confirm the same on your git version, but the design is sound.

## Outputs to share back

When you've run them, the most useful things to send me:
- Output of script 1 (the help dump and headless echo test)
- Output of script 2 (the sample line and field summary)
- The diff between two snapshots (script 4) showing what changes around a limit hit
- The full transcript from script 5

That should close most of §11's open questions.
