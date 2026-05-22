# Phase 01 — Version embedding

## Summary

Replace the hardcoded version string `'0.1.0'` in `src/cli.ts` with a build-time injectable constant. The version is sourced from the `CPE_VERSION` environment variable at compile time via Bun's `--define` flag. When built locally without that flag it falls back to `'dev'`.

## Context

`src/cli.ts:31` currently calls `program.version('0.1.0')`. This must be replaced with a value that CI can override when building a tagged release.

Bun's `--define` flag replaces references to `process.env.FOO` with a literal string at compile time. The compiled binary therefore contains the baked-in version with no runtime environment dependency.

## Files Expected to Change

| File | Change |
|------|--------|
| `src/version.ts` | New file — exports `CPE_VERSION` constant |
| `src/cli.ts` | Import `CPE_VERSION` and pass it to `program.version()` |

## How version injection works

Local build (no define):
```
bun build --compile --outfile cpe src/index.ts
# cpe --version → dev
```

CI build (with define):
```
bun build --compile --define 'process.env.CPE_VERSION="v1.2.3"' --outfile cpe src/index.ts
# cpe --version → v1.2.3
```

`src/version.ts` content:
```ts
export const CPE_VERSION: string = process.env.CPE_VERSION ?? 'dev';
```

Because Bun replaces `process.env.CPE_VERSION` at compile time, the `?? 'dev'` fallback is the value used for local builds; the right-hand side is dead code in CI builds.
