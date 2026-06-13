# Results — round 2: gemma4-cpe:31b

Same task, plan, and protocol as the [12b round](RESULTS.md). Graded criteria
first, cost after. **Verdict: planning's advantage narrows at higher capability
— vague@31b already ships integrated code — but the verification-discipline gap
persists across both model sizes and all four harnesses.**

## Backend note (experiment-integrity caveat)

Mid-round the homelab host changed: pi and aider ran `gemma4-cpe:31b` on Ollama;
the opencode runs ran the **same weights on a new llama-server (`ls/`) host**.
Tool-calling verified equivalent on both wire paths before the opencode runs.
Treat opencode's numbers as "same model, different runtime" — not a perfectly
controlled comparison with pi/aider.

## Headline

| Run | Outcome | Build | Tests | Notes |
|---|---|---|---|---|
| A-pi (vague) | **0 edits** | — | — | trailed off into an empty reply (as at 12b) |
| A-aider (vague) | **working core, 1 commit** | ✅ | none written | `vcs/releases` + `version-manager`; criteria 1–3 |
| A-opencode (vague) | **integrated, wired-up feature** | ✅ | 184 pass (none new) | `cpe version`+`update` registered in cli.ts, background `autoUpdate()` on startup, TUI hourly-check + badge state — **~5/11** |
| B-pi (planned) | 4/4 phases | not re-checked this round | — | completed overnight pre-backend-swap |
| B-aider (planned) | **abandoned at 2/4** | P02 builds | — | repeatedly wedged post-commit; executor swapped (operational, not capability) |
| B-opencode (planned) | **4/4 phases, ~917 lines + tests** | ✅ compiles | **2 fail + 2 errors** | broadest attempt; `cpe update` CLI command orphaned; lint fails |

## The key comparison: vague vs planned at 31b (opencode)

- **A-opencode (vague)** produced *less* code but it was **integrated and working**:
  commands registered, background check wired, TUI badge. ~5/11 working.
- **B-opencode (planned)** produced *more* — SHA256SUMS supply-chain phase, a
  `state` module, an `auto` loop wired into `start.ts`, and genuine test files —
  but introduced its own failures: `} as any;` **syntax errors in
  install.test.ts** (invalid test code), a `fetchLatestTag` test that doesn't
  match the impl, lint failures, and the **`cpe update` CLI command written but
  never registered** in index.ts (the auto-loop is wired; the manual command is
  orphaned). Working-criteria score is held back by the broken test suite.

So at 31b, planning bought **breadth + test coverage** but not **correctness or
integration completeness** — and the 12b round's clean "B ≫ A" collapses to "B
is broader, A is more reliably wired" once the model is strong enough to clear
discovery on its own.

## Cross-round summary

| | 12b | 31b |
|---|---|---|
| vague (best executor) | 0/11 — couldn't start (discovery failure) | ~5/11 — opencode shipped integrated code |
| planned (best executor) | ~3/11 working (aider core module) | broadest code yet, but **no run passes its own tests** |
| What planning fixed | discovery + scoping (completely) | breadth + test *attempts* |
| What stayed broken | verification discipline; integration phases | verification discipline (orphaned cmd, broken tests) |

**The robust finding across both sizes and all four harnesses:** frontier
planning reliably removes the *discovery and scoping* failure mode. It does
**not** instill *verification discipline* — no run at either size ran its own
build/test to green before reporting `complete`. That gap is a cpe
responsibility, not a model or prompt one: phase completion should gate on
evidence (`build && test` green, diff present) rather than the agent's
self-report. Evidenced now, not speculated.

Harness reliability also emerged as an unanticipated selection axis: aider
wedged post-commit repeatedly at 31b (operational, independent of code quality)
and was abandoned mid-run; opencode and pi streamed steadily and ran to
completion.

## Cost (31b)

| Run | Input tok | Output tok | Source |
|---|---|---|---|
| A-opencode | 1,192,344 | 11,093 | litellm |
| B-opencode | 1,891,013 | 39,799 | litellm |
| B-pi | 226,202 | 5,095 | litellm |
| B-aider (partial) | 75,558 | 19,680 | litellm |

opencode's input is an order of magnitude above pi's — it re-sends large file
context every step (the `ls/` backend now reports real cache reads, e.g.
`cache.read: 60002` in a single step, so prefill is largely cached even though
the token counts are huge). Tokens stay the honest chattiness metric, not a
local-compute proxy (see the gateway prompt-caching note in
docs/litellm-integration-spec.md).

## Operational incidents this round (all now fixed in cpe or noted)

- aider stdout block-buffered → silent TUI; fixed with `PYTHONUNBUFFERED=1`.
- max-runtime kill raced finished phases (pi P01, aider P02) → salvage logic
  added (record from committed self-report + HEAD move).
- backend restart left agents on half-open sockets, hanging forever → only
  runtime caps recover them; `inactivity_timeout_seconds` set to 1800.
- `cpe provider refresh` 401'd against the gateway (unauthenticated model fetch)
  → now resolves the litellm admin key.
- aider commits `.cpe/result.json` despite the contract (explicit add bypasses
  info/exclude) — still open.
- post-report bookkeeping wedged a run with no external wait — still open
  (candidate: bound the settlement/tail-close tail-end).

## Layout

`armA-opencode/`, `armB-opencode/` added alongside the 12b round's dirs. Per
run: `meta.json`, run log (tail-capped), `branch.diff`, `commits.txt`. The
aider 31b run's partial work is captured in `armB-aider-31b/`.
