# CPE Sandboxing

Extends CPE so that every run executes inside Claude Code's native sandbox, restricting filesystem
writes to the worktree and outbound network to an approved domain list.

## Docs

- [PROGRESS.md](PROGRESS.md) — phase table and status
- [PHASE_01.md](PHASE_01.md) / [PHASE_01.prompt.md](PHASE_01.prompt.md) — Sandbox module + types
- [PHASE_02.md](PHASE_02.md) / [PHASE_02.prompt.md](PHASE_02.prompt.md) — Queue/plan integration + --no-sandbox
- [PHASE_03.md](PHASE_03.md) / [PHASE_03.prompt.md](PHASE_03.prompt.md) — TUI sandbox indicator

## Requirements

1. Every new `cpe queue` / `cpe plan` run is sandboxed by default.
2. Users can opt out per-run with `--no-sandbox`, or permanently by setting `sandbox.enabled: false`
   in `~/.config/cpe/config.json`.
3. Filesystem: subprocess writes are restricted to the worktree directory. This is Claude Code's
   default sandbox policy when `cwd = worktreePath` — no extra `allowWrite` configuration is needed.
4. Network: `api.anthropic.com`, `github.com`, `registry.npmjs.org`, and `pypi.org` are allowed by
   default. Additional domains can be added in `~/.config/cpe/config.json` (global) or
   `cpe.config.json` (per-repo). Domain lists are merged, not replaced.
5. Auto-allow mode (`autoAllowBashIfSandboxed: true`): sandboxed bash commands run without prompts,
   which is required for headless operation.
6. On Linux/WSL2: CPE checks for `bwrap` before injecting sandbox settings. If missing, it warns
   and disables the sandbox for that run rather than hard-failing.
7. Sandbox config is injected as `.claude/settings.local.json` in the worktree (the local variant
   is machine-specific and never committed). CPE merges into any existing file.

## Technical approach

CPE writes `.claude/settings.local.json` into each worktree at queue time:

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

The config is assembled by merging: `DEFAULT_SANDBOX` ← `appConfig.sandbox` ← `repoConfig.sandbox`
← `--no-sandbox` flag ← bubblewrap availability check.

## Definition of Done

- `cpe queue` and `cpe plan` inject sandbox settings into every new worktree by default.
- `cpe queue --no-sandbox` (and `cpe plan --no-sandbox`) skips injection.
- `~/.config/cpe/config.json` can disable sandbox globally or extend the domain list.
- `cpe.config.json` per-repo can add extra allowed domains.
- Missing `bwrap` on Linux prints a warning and runs without sandbox (no crash).
- TUI Manage mode shows a padlock glyph on sandboxed runs.
- TUI Drilldown shows a Sandbox field in the metadata section.
- `bun run build` succeeds and the existing test suite passes after all phases.

## Risks and notes

- **Additional domains**: If Claude needs a domain not in the default list (e.g. a private npm
  registry), the user must add it to `cpe.config.json` under `sandbox.allowedDomains`. In
  auto-allow mode, unresolved domain prompts will block the headless process — document this clearly.
- **Ubuntu 24.04 AppArmor**: bubblewrap requires an AppArmor profile tweak. CPE's warn-and-disable
  path handles this gracefully, but the user must set it up manually before sandboxing works.
- **Resume sessions**: `.claude/settings.local.json` persists through rate-limit pauses — resumed
  sessions inherit the same sandbox settings automatically.
