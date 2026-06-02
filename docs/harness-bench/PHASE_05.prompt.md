Read docs/harness-bench/PHASE_05.md and docs/harness-bench/README.md before starting. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Depends on Phase 04.

Goal: add a bench command that enqueues the harness x model cross-product of one prompt as ordinary runs, and a summary view over captured results.

Files to create/modify and why:
- src/commands/bench.ts (new): implement cpe bench. Accept the prompt as positional args, piped stdin, or --prompt-file (mirror how src/commands/prompt.ts already accepts a prompt three ways). Accept --harness as a comma-separated list, --model as a comma-separated list, --provider <name>, and optional --repo and --branch overrides. The repo/branch baseline DEFAULTS to where cpe was started: getPrimaryRepo() (CWD repo) at getCurrentBranch() (src/git/repo.ts) - do not hardcode a repo or the modeltests/sandbox-no-docs branch; only use the overrides when explicitly passed. For each (harness, model) pair, create a single-prompt RunMeta with isolation 'clone', the resolved baseline repo/branch, the given prompt/provider, and enqueue it via src/storage/queue.ts. Name runs and their harnesstests branches <harness>__<model> (slugify model: replace : and / with -). Print the planned matrix (including the baseline repo/branch) before enqueueing.
- Add a summary path: cpe bench summary (a subcommand or a --summary flag) that reads every results/*/meta.json produced by capture (Phase 04) and prints a table with columns: harness, model, outcome, duration, files changed, lines +/-, tokens, cost, branch. Follow the existing table rendering approach in src/commands/list.ts and src/commands/status.ts.
- src/cli.ts: register the bench command following the existing commander pattern (and the wrap() error helper).
- src/storage/queue.ts: add a small helper only if needed for batch enqueue; otherwise reuse existing read/write.

Patterns and edge cases:
- Validate every --harness value against the registry (registry.get) before enqueueing anything; if any is unknown, fail fast and enqueue nothing.
- De-duplicate combos; if a results/<combo> already exists, warn and either skip or overwrite based on a --force flag (default skip).
- Keep enqueue order deterministic (harness-major, then model) so the run order is predictable.
- The summary must handle missing/partial meta.json (a timed-out or crashed run) gracefully - show the outcome, not a stack trace.

Acceptance criteria:
- bun run build, lint, and existing tests pass.
- cpe bench "<prompt>" --harness claude-code --model gemma4-cpe:31b,gemma4-cpe:26b enqueues two clone-isolated runs named claude-code__gemma4-cpe-31b and claude-code__gemma4-cpe-26b, which the queue processor runs sequentially with the configured pause between them.
- After runs complete, cpe bench summary prints a correct table across the captured results.
- Unknown harness/model inputs fail fast and enqueue nothing.

When done, update docs/harness-bench/PROGRESS.md (Phase 05 complete, date) and commit the phase on feature/harness-bench.
