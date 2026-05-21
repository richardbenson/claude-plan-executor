# Phase 1 — Sandbox module + types

## Summary

Introduce the `SandboxConfig` type, extend `AppConfig` and `RepoConfig` to carry sandbox settings,
update `DEFAULT_CONFIG` to enable the sandbox by default, and build the core `src/runner/sandbox.ts`
module that handles bubblewrap detection, config merging, and settings injection.

No changes to CLI commands or TUI in this phase — those come in phases 2 and 3.

## Context

Claude Code has a native sandbox feature configured via `settings.local.json` in the project
directory. When `sandbox.enabled` is `true`, Claude Code uses bubblewrap (Linux/WSL2) or Seatbelt
(macOS) to restrict bash subprocess access. The key settings CPE needs to inject are:

```json
{
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": false,
    "autoAllowBashIfSandboxed": true,
    "network": {
      "allowedDomains": ["api.anthropic.com", "github.com", "registry.npmjs.org", "pypi.org"]
    }
  }
}
```

`autoAllowBashIfSandboxed: true` is the default in Claude Code but we set it explicitly because
CPE runs headlessly — permission prompts for bash commands would hang the process.

`failIfUnavailable: false` means if bubblewrap is absent, Claude Code warns and continues rather
than crashing. CPE also does its own pre-flight check (see `isBubblewrapAvailable`) so the user
gets a clear CPE-level warning before any Claude session is spawned.

The injection target is `.claude/settings.local.json` (not `settings.json`). The `.local` variant
is machine-specific and excluded from git, so it never pollutes the target repo's history.

## Files expected to change

| File | Change |
|------|--------|
| `src/types/meta.ts` | Add `SandboxConfig` interface; extend `AppConfig` with `sandbox?: SandboxConfig`; add `sandboxed?: boolean` to `RunMeta` |
| `src/storage/config.ts` | Add `DEFAULT_SANDBOX` constant; update `DEFAULT_CONFIG` to include `sandbox: DEFAULT_SANDBOX` |
| `src/config/repo-config.ts` | Add `sandbox?: SandboxConfig` to `RepoConfig`; mention the field in the stub template comment |
| `src/runner/sandbox.ts` | **New file.** Exports `isBubblewrapAvailable`, `buildSandboxSettings`, `injectSandboxSettings` |
