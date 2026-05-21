# CPE Sandboxing — Summary

## Original Requirements

Extend CPE so every run executes inside Claude Code's native sandbox, restricting filesystem writes
to the worktree and outbound network to an approved domain list. Sandboxing should be on by default
with an opt-out flag (`--disable-sandbox`), configurable globally and per-repo, and gracefully
disabled when bubblewrap is unavailable.

## Work Done

### Phase 1 — Sandbox module + types

Added `SandboxConfig` interface to `src/types/meta.ts` and extended `AppConfig`, `RunMeta`, and
`RepoConfig` to carry sandbox configuration. Exported `DEFAULT_SANDBOX` (four approved domains,
enabled by default) from `src/storage/config.ts`. Created `src/runner/sandbox.ts` with three
exports: `isBubblewrapAvailable()` (Linux bwrap check), `buildSandboxSettings()` (merges global →
repo → flag overrides), and `injectSandboxSettings()` (writes `.claude/settings.local.json` into
the worktree, always including the worktree path in `allowWrite`).

### Phase 2 — Queue/plan integration + --disable-sandbox

Wired sandbox injection into `queuePlan()` — called by both `cpe queue` and `cpe plan`. The
`noSandbox` parameter threads from CLI (`--disable-sandbox` option on both commands) through
`queueCommand` / `planCommand` to `queuePlan`, which calls `buildSandboxSettings` and
`injectSandboxSettings` before writing meta. The `sandboxed` boolean is recorded on `RunMeta` for
downstream display.

### Phase 3 — TUI sandbox indicator

Added a `⊡` glyph to queue rows in `src/tui/components/QueuePane.tsx` (rendered when
`run.sandboxed === true`, `dim` colour). Added a "Sandbox: enabled / disabled" metadata field to
`src/tui/Drilldown.tsx` (green for enabled, dim for disabled).

## Lessons Learned

- On WSL2 with bubblewrap present, `filesystem.allowWrite` must explicitly list the worktree path
  or Claude's Edit/Write tools are blocked at the OS level — the `--dangerously-skip-permissions`
  flag only bypasses the interactive prompt layer, not the bwrap filesystem restrictions.
- The finalise step needs `--dangerously-skip-permissions` passed to its `claude -p` spawn,
  otherwise the summarise session blocks on permission prompts when stdin is a file.
