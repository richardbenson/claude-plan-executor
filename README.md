# Claude Plan Executor (`cpe`)

A CLI/TUI tool that automates the planbot → next-phase → summarise-plan loop.
Queue work across multiple repos, let it run overnight, and pick up where Claude Code left off after session-limit resets — all without manual intervention.

## Prerequisites

- [Claude Code](https://claude.ai/code) (`claude` on your PATH)
- `git`
- `gh` (GitHub CLI, for PR creation and release notes)
- Linux (x64/arm64) or macOS (x64/arm64)

## Installation

### One-liner (recommended)

Downloads the prebuilt binary for your OS and architecture from the latest GitHub release:

```bash
curl -fsSL https://github.com/richardbenson/claude-plan-executor/releases/latest/download/install.sh | bash
```

Then ensure `~/.local/bin` is on your PATH (add to `~/.bashrc` or `~/.zshrc` if needed):

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Verify the install:

```bash
cpe --version
```

### Build from source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/richardbenson/claude-plan-executor.git
cd claude-plan-executor
bash scripts/install-local.sh
```

## Quick start

```bash
# Inside a repo you want to automate work in:
cpe plan "add dark mode support to the settings panel"

# cpe launches Claude Code with planbot to break the feature into phases,
# then offers to queue it when planning completes.

# Alternatively, queue a plan folder you've already created:
cpe queue docs/my-feature

# Start the TUI — this runs the queue and shows live progress:
cpe start
```

## Commands

| Command | Description |
|---|---|
| `cpe plan [details]` | Launch an interactive planning session in the current repo |
| `cpe queue [folder]` | Add a plan folder to the queue |
| `cpe start` | Start the TUI queue processor |
| `cpe status` | Print queue status (non-interactive, for scripting) |
| `cpe list` | List all runs |
| `cpe pause` / `cpe resume` | Pause or resume queue processing |
| `cpe remove <run-id>` | Remove a run from the queue |
| `cpe clean` | Remove worktrees for completed runs |
| `cpe bootstrap` | Set up per-repo bootstrap config (`--detect`, `--stub`, `--edit`) |

## Per-repo configuration

On first use in a repo, `cpe` will ask how you want to set up bootstrap commands — shell commands run before each phase (e.g. `pnpm install`). The config is stored in `cpe.config.json` at the repo root:

```json
{
  "bootstrap": [
    "pnpm install"
  ]
}
```

Run `cpe bootstrap --detect` to have Claude inspect the repo and propose bootstrap commands automatically.

## How it works

Each plan lives in a `docs/<folder>/` directory with a `PROGRESS.md` and one `PHASE_NN.prompt.md` per phase (planbot output). `cpe` processes them sequentially:

1. Creates a `git worktree` for the run so your main checkout is never touched
2. Runs each phase by spawning `claude -p` with the phase prompt
3. Detects Claude Code session-limit pauses and resumes automatically when the window reopens
4. Commits after each phase, then raises a PR and summarises the plan when all phases complete

## License

MIT
