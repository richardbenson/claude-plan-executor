# Self-update bake-off, extended-context re-run (2026-06-15)

Re-run of the [2026-06-14 round](../2026-06-14-selfupd-bakeoff/) after that one
was invalidated by a 32k context cap. Changes for this run: `qwen3-coder-next:80b`
(RAM-locked at 32k, not agentically viable on the 10 GB card) **swapped for
`qwen3-coder:30b`** (98304 ctx, ~37 tok/s MoE); context windows extended on all
models; cpe fixes from the prior round in place (salvage, classification,
finalise tails).

Grid: 2 models (`granite4.1:8b`, `qwen3-coder:30b`) × 2 harnesses (opencode,
claude-code), same 4-phase frontier self-update plan, one clone per cell.

## Result — qwen3-coder:30b × claude-code is the only working feature

Graded on **does it build + not break existing code**, not the agent's
self-reported status (which is unreliable — see below).

| Cell | Phases | Builds? | Existing tests | Verdict |
|---|---|---|---|---|
| **qwen-claude** (30b) | 4/4 | **✅ yes** | **0 fail (intact)** | **Working feature** — all modules + `cpe update` + TUI badge, additive. Only its *own* 10 new update-tests fail (wrote tests it couldn't pass) |
| granite-opencode (8b) | 4/4 "complete" | ❌ fails | 4 fail | Destructive — deleted ~990 lines of TUI, stray `index.js` |
| granite-claude (8b) | 4/4 "complete" | ❌ fails | — | Destructive — deleted ~890 lines |
| qwen-opencode (30b) | 3/4, **dropped** | P01–P03 sound on main | — | Not a model failure — git-debris infra curse (below) |

## Findings

1. **Model capability dominates harness and plan.** Same plan, same harness
   (claude-code): granite-8b gutted the codebase, qwen-30b built a clean additive
   feature. An 8B can't safely edit a 238-module repo.
2. **Verification discipline is still absent even in the winner.** qwen-claude
   wrote 10 tests it never made pass and reported "complete". Builds, but green
   status ≠ verified — the standing case for evidence-gated phase completion,
   now demonstrated across 12b/31b/8b/30b and four harnesses.
3. **Agent self-report text is not trustworthy.** qwen-opencode's P03 summary
   read "Removed SHA256 checksum generation" — the literal opposite of the work;
   the actual `main` commit *preserved* SHA256 and added the update command.
   Grade from diffs, never from the summary string.
4. **granite4.1:8b's verdict is task-size-dependent**: floor-test winner
   (fast, correct on a one-liner), destructive on a real multi-file feature.
   Excellent utility model, not an autonomous-feature model.

## The qwen-opencode infra curse (root-caused, fixed in cpe)

qwen-opencode failed three times from one origin: the **first** queue attempt
(plan-on-wrong-branch ENOENT) left behind a bootstrapped worktree **and** its
`feature/self-update` branch. cpe's queue-failure path didn't clean either up.
Consequences, run after run:
- opencode's project resolver followed git to the orphaned **worktree** and did
  an entire phase's work there, leaving its real worktree empty (looked like a
  model stall; the inactivity guard correctly fired on the trailing hung `task`
  sub-agent).
- after the worktree was pruned, a resume checked out the orphaned **branch**
  (a divergent first-attempt P03 based on an old commit), discarding P01/P02 and
  landing on a "removed SHA256" lineage.

Both P01–P03 were ultimately sound on `main`; only the cosmetic branch/worktree
topology was corrupt. Dropped rather than surgically salvaged (we already have
qwen-claude as a clean 30b data point).

**Fix shipped:** `queuePlan` now throws (not `process.exit`) on bootstrap
failure, and both callers remove the worktree **and** delete the branch on any
post-`createWorktree` error — no git debris survives a failed queue. Plus the
finalise structured-path output tail (the earlier "finalise looks idle in the
TUI" gap).

## Note on attribution

Laptop clock was ~-3h skewed vs the homelab/Langfuse clock this round; runs were
attributed by **worktree path in each run's own log**, not timestamps. (A first
Langfuse pass on a timestamp window pulled the wrong run — clock-independent
attribution is the lesson.)

## Layout

One dir per cell: `meta.json`, run logs (tail-capped), `branch.diff`,
`commits.txt`. `qwen-opencode-DROPPED/` holds the 3/4 partial for reference.
