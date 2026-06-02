# Phase 01 - Run parameterization + Harness contract & registry

## Summary
Introduce `{ provider, model, harness }` as first-class, persisted per-run fields, and define the
`Harness` adapter contract + a registry. Wrap the existing claude execution as the `claude-code`
adapter and register it. **No behaviour change yet** - the executor still runs via the current code
path; the new fields are persisted but not yet consumed (that is Phase 02).

## Context
- cpe is Bun/TypeScript with a `commander` CLI (`src/cli.ts`) and Ink TUI. Run state is `RunMeta` in
  `src/types/meta.ts`; config is `AppConfig` there too (`providers[]`, `provider_for_planning`,
  `provider_for_phases`).
- The current claude execution is `runSession` in `src/runner/session.ts` (spawns `claude -p ...
  --output-format json --json-schema`, parses an envelope via `src/runner/envelope.ts`) - this is
  the "structured" completion mode.
- Provider env injection already exists: `buildProviderEnv` / `buildProviderArgs` / `resolveProvider`
  in `src/runner/provider.ts`.

## The contract (design this carefully - it is the linchpin)
Define a `Harness` interface that supports **two completion modes** and **both** single-prompt and
phase execution:
- `name: string`
- `completionMode: 'structured' | 'opaque'`
- `run(ctx: HarnessContext): Promise<HarnessResult>` where `HarnessContext` carries
  `{ cwd, prompt | promptFile, model?, providerEnv, sessionId, logPath, timeoutMs?, schema? }` and
  `HarnessResult` carries `{ exitCode, outcome: 'completed'|'error'|'timeout'|'no-op', envelope?,
  tokens?, costUsd?, summary? }`.
- The `claude-code` adapter (structured) wraps `runSession` and maps its `SessionResult.envelope`
  into `HarnessResult`. Opaque adapters (later phases) derive `outcome` from exit code + git diff.

## Files expected to change
- `src/types/meta.ts` - add `harness?`, `model?`, `provider?` to `RunMeta`; add `harness_for_phases`/
  `harness_for_planning` (default `'claude-code'`) to `AppConfig` + `DEFAULT_CONFIG`.
- `src/harness/types.ts` (new) - `Harness`, `HarnessContext`, `HarnessResult`.
- `src/harness/registry.ts` (new) - register/get adapters by name; default `claude-code`.
- `src/harness/claude-code.ts` (new) - adapter wrapping `runSession`.
- `src/cli.ts` + relevant `src/commands/*.ts` (`plan.ts`, `queue.ts`, `prompt.ts`) - add
  `--provider`, `--model`, `--harness` options that persist into `RunMeta`.
