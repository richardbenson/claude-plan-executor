# Phase 01 — Project Skeleton + Tooling

## Summary

Bootstrap the `cpe` project from scratch: install dependencies, configure TypeScript, set up the
binary build pipeline, add ESLint, and wire `bun test`. After this phase the repo compiles, one
stub test passes, and `bun run build` produces a runnable `./cpe` binary that prints help and
exits cleanly.

## Context

- Working directory: `/home/ubuntu/Code/claude-plan-executor`
- Runtime: Bun. Use `bun` for all package operations (not npm or yarn).
- The binary entry point is `src/index.ts`, compiled by `bun build --compile`.
- Ink (React-for-terminal) requires JSX. `tsconfig.json` must set `"jsx": "react-jsx"` and use
  `"moduleResolution": "bundler"` for Bun compatibility.
- Do NOT import from future phases — keep Phase 01 self-contained so `tsc --noEmit` passes.
- The embedded prompts directory (`src/prompts/`) is created in Phase 02; Phase 01 must not
  reference it.

## Files Expected to Change

- `package.json` — created; defines deps, scripts, and package metadata
- `tsconfig.json` — created; strict TS with Bun/Ink-compatible settings
- `.gitignore` — created
- `bunfig.toml` — created; sets build target
- `eslint.config.ts` — created; flat-config ESLint (v9) with TypeScript rules
- `src/index.ts` — created; binary entry point using `commander`
- `src/test/stub.test.ts` — created; one passing test to validate `bun test`

## Acceptance Criteria

1. `bun install` completes without errors
2. `bun run typecheck` (`tsc --noEmit`) passes with zero errors
3. `bun run lint` passes with zero errors (warnings are acceptable)
4. `bun test` passes (1 test)
5. `bun run build` produces `./cpe` binary
6. `./cpe --help` prints commander help and exits 0
7. `./cpe --version` prints `0.1.0`

## Dependencies

None — this is the first phase.
