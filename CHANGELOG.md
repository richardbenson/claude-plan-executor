# Changelog

## Unreleased

### Features

- **Pluggable harnesses** — every run carries a `{ provider, model, harness }` triple. Ten harness adapters (claude-code structured; opencode, aider, goose, openhands, plandex, pi, crush, codex, mini-swe-agent opaque) behind a single contract, with install detection (`cpe harness check` / `list`) and hard gating on uninstalled selections.
- **Any harness runs the full job** — not just benchmarks: headless phases, single-prompt tasks, and the summarise→push→PR finalise all work on opaque harnesses via a hybrid result contract (agent self-report → model summarisation → git-derived), with claude-code's structured path preserved unchanged.
- **`cpe bench`** — harness×model matrix runs of one prompt in throwaway clone isolation, with capture (`diff`/`transcript`/`meta.json`), `harnesstests/*` branch pushes, a bounded live TUI, and `cpe bench summary`.
- **LiteLLM gateway integration** — a provider with `type: "litellm"` routes any harness through a self-hosted LiteLLM proxy and records **wire-accurate split input/output tokens** from the gateway's spend logs, attributed by an ephemeral per-run virtual key (minted at run start, revoked at settlement). Recorded totals carry a `token_source` of `litellm` or `adapter`.
- **Provider management** — decoupled endpoint + model catalogue (`models[]`, `default_model`), `cpe provider refresh` to re-fetch catalogues, auto-detected health checks, and local-model wiring per harness (Anthropic-native Ollama for claude-code, OpenAI-compatible/Responses/LiteLLM paths for the rest).
- **Activity guard for non-bench runs** — inactivity timeout + max-runtime cap + manual bail now also protect opaque worktree runs.

### Fixed

- **Opaque outcome mislabelling** — agents that committed their work left a clean tree and were reported as `no-op`; "changed" is now HEAD-moved-since-entry OR dirty tree, shared across all opaque adapters.
- **crush token under-reporting** — crush.db only keeps the last turn's snapshot; usage is now summed from the `--debug` HTTP log across all turns.
- **Spend-log collection race** — gateway spend rows flush in batches, so the first non-empty poll could record a fraction of a short run's tokens; totals now require two consecutive agreeing polls.
- **codex helper binaries** — CODEX_HOME moved out of /tmp (codex refuses to install its bundled `rg` there, which broke its discovery searches).
- **Autonomy preamble vs harness protocols** — the "do not stop partway" instruction no longer conflicts with harnesses whose own workflow names files before editing (aider's repo-map protocol).

## v0.4.0

### Features

- **Alternative provider support** — `cpe` can now route sessions through alternative Claude API providers (e.g. OpenRouter). Configure a provider globally in `~/.config/cpe/config.json` or per-repo in `cpe.config.json` using the new `provider` field.
- **Health-checked routing** — before starting a session, `cpe` verifies the configured provider is reachable. If health check fails, it falls back to the default Anthropic endpoint automatically.
- **`cpe provider` CLI** — new subcommand for managing providers: `cpe provider list` shows configured providers and their health status, `cpe provider set` sets the active provider globally or per-repo, and `cpe provider test` runs a health check on demand.

## v0.3.0

### Features

- **Container detection** — `cpe start` now detects Docker/Podman environments. If bubblewrap is unavailable (standard in most containers), a warning banner appears in the TUI explaining why Claude will show permission prompts and how to fix it.
- **`dangerously_skip_permissions` per repo** — in addition to the global `~/.config/cpe/config.json`, you can now set `dangerously_skip_permissions: true` in a repo's `cpe.config.json`. The per-repo setting is merged at run time, so each repo can opt in independently.
- **Permission-skip indicators in UI** — when `dangerously_skip_permissions` is active, the TUI header shows `⚠ perms skipped` and each affected run shows a `!` badge in the queue pane.
- **Rate-limit window persists across restarts** — if `cpe` is quit while waiting for a session-limit reset, it previously re-launched the session immediately on restart (hitting the limit again). The resume timestamp is now stored in run state so the processor waits for the correct window even after a restart.

### Fixed

- **Duplicate React keys in activity feed** — two bash events arriving within the same millisecond produced a React duplicate-key warning. Keys now include a stable index as a tiebreaker.

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
