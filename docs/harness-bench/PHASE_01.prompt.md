Read docs/harness-bench/PHASE_01.md and docs/harness-bench/README.md for full context before starting. Work in the cpe repo on the single working branch feature/harness-bench (off main); there are no per-phase branches or PRs. When the phase is done and green, commit it on feature/harness-bench as one commit (message e.g. "harness-bench phase 01: run parameterization + Harness contract").

Goal: make provider, model, and harness first-class persisted per-run fields, and add a Harness adapter contract plus a registry, with claude-code as the first registered adapter. This phase must NOT change runtime behaviour - the executor still runs through the existing code path; the new fields are only persisted, and the registry/adapter exist but are not yet dispatched to (that is Phase 02).

Files to modify and why:
- src/types/meta.ts: add optional harness, model, and provider fields to the RunMeta interface. Add harness_for_planning and harness_for_phases to AppConfig (both defaulting to 'claude-code' in DEFAULT_CONFIG). Keep all existing fields and defaults untouched.
- src/harness/types.ts (new): define the Harness interface, HarnessContext, and HarnessResult exactly as described in PHASE_01.md. completionMode is the union 'structured' | 'opaque'. HarnessResult.outcome is 'completed' | 'error' | 'timeout' | 'no-op'. Include optional envelope, tokens (reuse TokenUsage from src/types/meta.ts), costUsd, and summary fields so structured adapters can populate them and opaque ones can omit them.
- src/harness/registry.ts (new): a small registry that maps adapter name to a Harness instance, with register(harness) and get(name) helpers and a sensible error if a name is unknown. Register the claude-code adapter as the default.
- src/harness/claude-code.ts (new): a Harness with name 'claude-code', completionMode 'structured', whose run() delegates to runSession in src/runner/session.ts and maps SessionResult (envelope + exitCode) into a HarnessResult. Derive outcome from envelope.is_error / terminal_reason; copy tokens, total_cost_usd, and a summary if present. Do not change runSession itself.
- src/cli.ts and the relevant command modules (src/commands/plan.ts, src/commands/queue.ts, src/commands/prompt.ts): add --provider <name>, --model <model>, and --harness <name> options. Persist whatever is passed into the created RunMeta (harness, model, provider). When omitted, leave them undefined so existing defaults apply.

Patterns to follow from the existing codebase:
- Match the existing commander option style in src/cli.ts (see the existing --disable-sandbox and --github-issue options and the wrap() error helper).
- Match the existing module/import style (ESM, .js import extensions, named exports) used across src/runner and src/types.
- Reuse TokenUsage and ProviderEntry from src/types/meta.ts; reuse ResolvedProvider/buildProviderEnv from src/runner/provider.ts where the claude-code adapter needs env.

Edge cases and error handling:
- An unknown --harness value must fail fast with a clear error message (use the wrap() pattern) rather than silently defaulting.
- The claude-code adapter must preserve the existing fallback behaviour in runSession where envelope parsing fails (map that to outcome 'error', not a crash).
- Do not require model/provider/harness - all three are optional; absence means "use existing defaults".

Acceptance criteria:
- The project builds (bun run build) and lints clean.
- All existing tests pass unchanged - especially src/runner/envelope.test.ts and src/runner/jsonl-tail.test.ts. Do not modify them.
- Launching a run with --harness claude-code --model <m> --provider <p> persists those values into the run's RunMeta; launching without them behaves exactly as before.
- registry.get('claude-code') returns the adapter; registry.get('nope') throws a clear error.
- No change to how runs actually execute (claude still runs via the current path).

When done, update docs/harness-bench/PROGRESS.md: set Phase 01 status to complete with today's date and a one-line note, then commit the phase on feature/harness-bench.
