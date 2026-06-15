# Results — frontier-planned phases vs vague prompt (gemma4-cpe:12b round)

Graded per [PROTOCOL.md](PROTOCOL.md) (criteria first, cost metrics after).
Verdict: **hypothesis supported — B ≫ A** — with a sharp asterisk about
verification discipline.

## Headline

| Run | Outcome | Evidence |
|---|---|---|
| A-pi (vague) | **0 edits** | 1,051 tool events of *good* exploration (found release.yml, binary naming), then one empty model reply ended the session before any edit |
| A-aider (vague) | **0 edits** | repo-map add-files loop never converged on a 238-module repo (model asks for directories, aider auto-adds exact names only) |
| B-pi (planned) | **near-complete feature, DOESN'T COMPILE** | `src/update/{check,install,nudge,state}` + tests, `cpe update --check`, dev guard, GitHub releases API — broken by `import … from "fetch"` + a syntax error in install.ts |
| B-aider (planned) | **working core module, 1 of 4 phases** | check/install/state + 174 test lines incl. real SHA256 verification; builds, 194/195 tests pass; CLI/TUI phases produced nothing |

Identical model, repo, harnesses, isolation. The phase prompts carried the
discovery pre-done, and that alone moved both executors from zero to structured
modules with tests.

## Acceptance criteria (attempted ⇒ code exists / working ⇒ runs correctly)

| # | Criterion | B-pi | B-aider |
|---|---|---|---|
| 1 | report current + latest version | attempted | — |
| 2 | GitHub Releases API lookup | attempted | attempted |
| 3 | download correct platform asset + install | attempted | attempted (not wired to CLI) |
| 4 | already-up-to-date no-op | attempted | attempted |
| 5 | `dev` builds handled | attempted (twice) | — |
| 6 | non-blocking auto-check | attempted (nudge) | — |
| 7 | auto-install | partial | — |
| 8 | TUI restart prompt | — | — |
| 9 | offline-safe | attempted | attempted |
| 10 | unit tests + build/lint/tests pass | tests written; **build FAILS** | tests written; builds; 1 self-broken test |
| 11 | committed (one per phase) | **no phase commits** (finalise swept all work into its summary commit) | 1 of 4 phases committed |

**Working-criteria score: B-pi 0/11** (nothing compiles), **B-aider ~3/11**
(2, 4, 9 in the core module). Arm A: 0/11 and 0/11 with zero attempted.

## Cost

| Run | Input tok | Output tok | Wall |
|---|---|---|---|
| A-pi | 101k | 3.1k | ~13m |
| A-aider | 26k | 2.8k | ~3m |
| B-pi | 915k (P03 alone 574k) | 35.5k | 13m32s across 4 phases |
| B-aider | 165k | 46.5k | 17m37s across 4 phases |

All `token_source: litellm`. B-pi's P03 (574k in) is the CLI-integration phase —
the model thrashed re-reading context. B-aider P04 died on **aider's own context
limit** (the "token limit" message seen in the TUI came from the phase's
self-reported blocker — cpe's Anthropic rate-limit machinery never fired; local
models don't rate-limit, they overflow).

## What planning fixes, and what it can't (at 12b)

- **Fixed completely: discovery + scoping.** Arm A died exploring; Arm B never
  had to explore — both executors went straight to writing the right modules in
  the right places, following repo conventions.
- **Not fixed: verification discipline.** B-pi never ran `bun run build`
  despite every phase prompt requiring it; shipped syntax errors. The 12b
  treats acceptance criteria as narrative, not gates.
- **Not fixed: integration-shaped phases.** Both executors aced the
  self-contained-module phase (02) and faltered exactly on the phases that wire
  into existing surfaces (CLI registration, TUI).

## cpe findings (actionable)

1. **Phase completion gating is too lenient**: three phases reported `complete`
   with "No changes were made", and B-pi's phases completed without committing.
   The phase loop trusts the report; it should gate on evidence (diff present,
   build/test green) and feed failures back — the bench side already derives
   honest outcomes the same way.
2. **Per-phase commit discipline doesn't survive a 12b**: HEAD cross-check
   records the truth but doesn't enforce; an auto-commit fallback (or
   gate-and-retry) at phase end would have preserved B-pi's per-phase history.
3. The aider worktree info/exclude bug and the planbot result-format-instruction
   collision were found and fixed during this experiment (commits `f0a05bb`-era;
   see git log).

## Next round

Per the pre-registered "both-low ⇒ raise the floor" path: re-run both arms at
**gemma4-cpe:31b** (same plan reused for Arm B — it is model-agnostic by
construction), `max_runtime_seconds` raised for the slower model. If 31b closes
the verification gap, the recipe (frontier plans + capable-local execution +
evidence-gated phases) is the homelab pattern.

## Layout

- `plan/` — the frontier-generated plan (4 phases incl. unprompted SHA256SUMS
  supply-chain phase; zero result-format instructions — the planbot fix held)
- `armA-{pi,aider}/`, `armB-{pi,aider}/` — per run: `meta.json`, run log
  (giant logs tail-capped at 2 MB), `branch.diff` (the work vs baseline),
  `commits.txt`, `worktree-status.txt`
