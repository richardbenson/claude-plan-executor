# Claude Plan Executor (`cpe`)

A CLI/TUI tool that automates the planbot → next-phase → summarise-plan loop.
Queue work across multiple repos, let it run overnight, and pick up where Claude Code left off after session-limit resets — all without manual intervention.

## Prerequisites

- [Claude Code](https://claude.ai/code) (`claude` on your PATH)
- `git`
- `gh` (GitHub CLI, for PR creation and release notes)
- Linux (x64/arm64) or macOS (x64/arm64)

**Linux/WSL2 — sandbox isolation** (recommended): `bubblewrap` and `socat` are required for Claude's sandbox to work. `cpe` runs without them but sessions will be unsandboxed.

```bash
sudo apt-get install bubblewrap socat   # Debian/Ubuntu/WSL2
sudo dnf install bubblewrap socat       # Fedora/RHEL
sudo pacman -S bubblewrap socat         # Arch
```

**Optional — [RTK](https://github.com/rtk-ai/rtk)**: reduces Claude token usage by 60–90% across all sessions. The install script will prompt you if it's not detected.

```bash
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh
rtk init -g
```

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

## Using cpe inside a devcontainer

If your project uses a devcontainer, running `cpe` and `claude` **inside** the container is the right approach — not on the host. The container has your build toolchain, so Claude's bash commands work correctly, and all paths (worktrees, state, git registrations) stay in one consistent filesystem. The only thing that needs to come from the host is your Claude authentication and settings, via a bind mount of `~/.claude`.

The exact changes needed depend on your specific devcontainer setup: whether you use a base image or a custom Dockerfile, which user the container runs as, and how your `postCreateCommand` is currently structured. Rather than a one-size-fits-all script, the most reliable way to configure this is to ask Claude to do it for you.

<details>
<summary>Prompt to configure your devcontainer for cpe</summary>

Copy and paste this into Claude Code (inside your project):

```
I want to configure my devcontainer to run cpe (Claude Plan Executor) inside the
container. Please make the following changes to my devcontainer configuration:

1. Add a bind mount of `~/.claude` from the host into the container user's home
   directory (e.g. /home/vscode/.claude or /root/.claude depending on the user
   this container runs as). This gives Claude Code inside the container access to
   authentication credentials and hook settings (including RTK if installed on
   the host).

2. Add install steps for the following tools if not already present:
   - `claude` (Claude Code CLI): npm install -g @anthropic-ai/claude-code
   - `cpe`: curl -fsSL https://github.com/richardbenson/claude-plan-executor/releases/latest/download/install.sh | bash
   - `gh` (GitHub CLI): use the appropriate method for this container's base OS
   - `bubblewrap` and `socat`: apt-get / dnf / pacman as appropriate for the OS
     (needed for Claude sandbox isolation on Linux — cpe works without them but
     sessions will be unsandboxed)

   Install steps should go in `postCreateCommand` or as a `RUN` layer in the
   Dockerfile, whichever is more appropriate given the existing setup. Prefer
   `postCreateCommand` for user-scoped tools like `cpe` and `claude`.

3. Ensure `~/.local/bin` is on PATH inside the container (cpe installs there).

Please read my devcontainer.json and any referenced Dockerfile before making
changes, and handle the postCreateCommand correctly whether it is currently a
string, an array, or an object.
```

</details>

### Sandbox and permission prompts in containers

Standard devcontainers (and most Docker/Podman containers) do not support [bubblewrap](https://github.com/containers/bubblewrap) because bubblewrap requires Linux user namespaces (`CLONE_NEWUSER`), which Docker disables by default. Without bubblewrap, `cpe` cannot enable Claude's sandbox — and without the sandbox, Claude Code's `autoAllowBashIfSandboxed` setting does not apply, so **Claude will show interactive permission prompts** for every bash tool call.

`cpe` detects this situation and shows a warning banner in the TUI when it starts inside a container without bubblewrap available.

**To suppress permission prompts in a container**, set `dangerously_skip_permissions: true`. This passes `--dangerously-skip-permissions` to every Claude session, bypassing all permission checks. Only use this in environments you trust (your own devcontainer is fine; a shared or ephemeral CI environment is not).

You can set it globally or per-repo:

**Global** (`~/.config/cpe/config.json`):
```json
{
  "dangerously_skip_permissions": true
}
```

**Per-repo** (`cpe.config.json` in your project root):
```json
{
  "bootstrap": ["pnpm install"],
  "dangerously_skip_permissions": true
}
```

When `dangerously_skip_permissions` is active, the TUI header shows `⚠ perms skipped` and each affected run shows a `!` badge in the queue pane.

## License

MIT
