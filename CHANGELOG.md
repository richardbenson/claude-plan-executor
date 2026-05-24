# Changelog

## v0.2.0

### Features

- **Live bootstrap output** — the TUI now shows a scrolling output box while bootstrap commands run, so you can see progress (and spot failures) in real time rather than waiting for the spinner to resolve.

### Fixed

- **Bootstrap commands now run through a shell** — commands are executed via `sh -c` instead of direct exec, so shell built-ins, pipes, and `&&` chains in your bootstrap config work correctly.
- **Bootstrap failure details visible in TUI** — when a bootstrap command fails, the TUI now shows the error details and a tail of the log rather than a bare "setup failed" message.
- **Progress shown after Ctrl+D during plan setup** — resuming a session after a Ctrl+D interrupt now correctly displays the plan setup progress indicator.

## v0.1.1

### Fixed

- **Archive now removes the worktree** — pressing `d` in the TUI or using the `archive` palette command now calls `git worktree remove --force` immediately, so disk space is reclaimed without needing a separate `cpe clean` run.
- **`d archive` is now visible in the command bar** — the footer previously showed `r remove`, which was a dead keybind with no handler. It now correctly shows `d archive`.
- **`cpe clean` covers archived and failed runs** — previously only `complete` and `pr-created` runs were offered for cleanup; archived and failed runs are now included.
- **Session log files now have content** — phase and single-prompt `.log` files were always 0 bytes because the runner only captured stderr (empty in `--output-format json` mode). The JSONL tail now writes a human-readable log line for each TEXT narration, BASH call, RTK rewrite, EDIT/READ, and tool result as they stream in.

## v0.1.0

Initial public release.

`cpe` (Claude Plan Executor) automates the planbot → next-phase → summarise-plan loop. Queue feature work across multiple repos, let it run overnight, and pick up automatically after Claude Code session-limit resets.

### Features

- **Queue processor** — multiple runs across multiple repos, processed one at a time with a live TUI
- **Git worktrees** — each run lives in an isolated worktree; your working tree is never touched
- **Session-limit handling** — automatic pause and resume around the Claude Code hourly token window
- **Single-prompt mode** — for tasks that don't need a full multi-phase plan (`cpe queue --prompt "..."`)
- **Sandbox support** — runs Claude inside bubblewrap on Linux for network and filesystem isolation
- **Live activity feed** — streams tool calls, file edits, bash output, and RTK rewrites as they happen
- **Per-repo bootstrap** — configurable setup commands via `cpe.config.json` or `cpe bootstrap --detect`
- **RTK-aware** — install script detects RTK and prompts if absent; sessions benefit from 60–90% token savings when RTK is installed
- **Prebuilt binaries** for Linux x64/arm64 and macOS x64/arm64
