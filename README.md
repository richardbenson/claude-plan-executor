# Claude Plan Executor (`cpe`)

A CLI/TUI tool that automates the planbot → next-phase → summarise-plan loop.
Queue work across multiple repos, let it run overnight, and pick up where Claude Code left off after session-limit resets — all without manual intervention.

Every run carries a selectable **`{ provider, model, harness }`** triple:

- **provider** — the API endpoint/credentials (Anthropic, a local Ollama, an internal gateway). See [Providers](#providers).
- **model** — the model id to run.
- **harness** — which coding agent drives the work. `claude-code` is the default and powers the full plan loop; nine more agents (opencode, aider, goose, …) are supported for running and **benchmarking** the same task across tools — including on local models at zero API cost. See [Harnesses](#harnesses) and [Benchmarking harnesses](#benchmarking-harnesses).

Defaults preserve the original behaviour: with no flags, `cpe` runs `claude-code` against Anthropic exactly as before.

## Prerequisites

- [Claude Code](https://claude.ai/code) (`claude` on your PATH) — the default harness
- `git`
- `gh` (GitHub CLI, for PR creation and release notes)
- Linux (x64/arm64) or macOS (x64/arm64)
- *Optional:* any of the [alternative harnesses](#harnesses) you want to run or benchmark (each is a separate CLI install)

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
| `cpe prompt [text]` | Queue a single-prompt run (args, stdin, or `--github-issue`) |
| `cpe start` | Start the TUI queue processor |
| `cpe status` | Print queue status (non-interactive, for scripting) |
| `cpe list` | List all runs |
| `cpe pause` / `cpe resume` | Pause or resume queue processing |
| `cpe remove <run-id>` | Remove a run from the queue |
| `cpe clean` | Remove worktrees for completed runs |
| `cpe worktree` | Enter a worktree shell for the current repo |
| `cpe bootstrap` | Set up per-repo bootstrap config (`--detect`, `--stub`, `--edit`) |
| `cpe bench <prompt>` | Enqueue a harness×model matrix for one prompt (clone-isolated) |
| `cpe bench summary` | Print a table over captured bench results |
| `cpe harness check` | Probe every harness for its CLI + version and cache the result |
| `cpe harness list` | Show cached harness install status |
| `cpe provider list` | List configured providers and their assigned roles |
| `cpe provider add` | Add a provider interactively |
| `cpe provider remove <name>` | Remove a provider by name |
| `cpe provider test [name]` | Test health checks for all providers, or one by name |

`cpe plan`, `cpe queue`, and `cpe prompt` accept `--provider <name>`, `--model <id>`, and `--harness <name>` to override the `{ provider, model, harness }` triple for that run.

## Per-repo configuration

The file `cpe.config.json` at the repo root controls how `cpe` behaves for that specific project. On first use `cpe` will prompt you to set it up; you can also run `cpe bootstrap --edit` to open it directly.

A fully annotated example:

```json
{
  "bootstrap": [
    "pnpm install"
  ],
  "sandbox": {
    "allowedDomains": [
      "registry.npmjs.org",
      "my-internal-registry.example.com"
    ]
  },
  "dangerously_skip_permissions": false,
  "providers": [
    {
      "name": "local-ollama",
      "model": "claude-opus-4-5",
      "anthropic_base_url": "http://localhost:11434/v1",
      "health_check_url": "/health"
    }
  ],
  "provider_for_planning": "local-ollama",
  "provider_for_phases": "local-ollama"
}
```

### All available fields

| Field | Type | Description |
|---|---|---|
| `bootstrap` | `string[]` | Shell commands run in the worktree before each phase (e.g. dependency installs) |
| `sandbox.allowedDomains` | `string[]` | Additional network domains Claude's sandbox may reach |
| `sandbox.allowWrite` | `string[]` | Additional filesystem paths the sandbox may write to |
| `dangerously_skip_permissions` | `boolean` | Pass `--dangerously-skip-permissions` to every Claude session (see below) |
| `providers` | `ProviderEntry[]` | Alternative Claude endpoints/models for this repo (overrides global config) |
| `provider_for_planning` | `string` | Name of the preferred provider for interactive planning sessions |
| `provider_for_phases` | `string` | Name of the preferred provider for headless phase and single-prompt runs |
| `harness_for_planning` | `string` | Harness used for interactive planning (default `claude-code`) |
| `harness_for_phases` | `string` | Harness used for headless phase and single-prompt runs (default `claude-code`) |

When `providers` is set in `cpe.config.json` it fully replaces the global provider list for that repo. The `provider_for_planning` and `provider_for_phases` fields name the preferred provider for each role; if that provider fails its health check, `cpe` falls back through the list in order.

Run `cpe bootstrap --detect` to have Claude inspect the repo and propose bootstrap commands automatically.

### Global settings (`~/.config/cpe/config.json`)

A few settings live only in the global config:

| Field | Type | Description |
|---|---|---|
| `harness_for_planning` / `harness_for_phases` | `string` | Default harness per role (default `claude-code`) |
| `isolation` | `"worktree"` \| `"clone"` | Default isolation mode (`bench` always uses `clone`) |
| `inactivity_timeout_seconds` | `number` | Kill a run after this long with no new output (0/unset = off) |
| `max_runtime_seconds` | `number` | Absolute wall-clock cap per run (0/unset = off) |
| `pause_seconds` | `number` | Sleep between sequential runs (lets a local model server evict the previous model) |
| `harnesses` | `HarnessStatus[]` | Cached harness install-detection results — managed automatically by `cpe harness check`; you don't edit this by hand |

## Providers

Providers let you route `cpe` sessions through alternative Claude endpoints or models — a local Ollama proxy, an internal API gateway, or any service that speaks the Anthropic API.

### Provider fields

| Field | Required | Description |
|---|---|---|
| `name` | yes | Identifier used to reference this provider |
| `model` | no | Passes `--model <value>` to every Claude spawn |
| `anthropic_base_url` | no | Sets `ANTHROPIC_BASE_URL` in the session environment |
| `anthropic_api_key` | no | Sets `ANTHROPIC_API_KEY` in the session environment |
| `anthropic_auth_token` | no | Sets `ANTHROPIC_AUTH_TOKEN` in the session environment |
| `health_check_url` | no | A full URL or a path relative to `anthropic_base_url`. `cpe` GETs this before each run (5 s timeout, must return 2xx). Providers without a health check are assumed always available. |

### Resolution behaviour

Before each Claude spawn, `cpe` picks a provider as follows:

1. The preferred provider (from `provider_for_planning` or `provider_for_phases`) is tried first.
2. If it fails its health check, `cpe` tries the remaining providers in list order.
3. If no provider passes, `cpe` falls back silently to bare Anthropic — no extra environment variables or `--model` flag.

This means you can list a fast local provider first with a health check, and it will be used when available and skipped automatically when it isn't.

### Global vs per-repo config

Providers can be configured globally in `~/.config/cpe/config.json`:

```json
{
  "providers": [
    {
      "name": "my-proxy",
      "anthropic_base_url": "https://proxy.example.com",
      "anthropic_api_key": "sk-...",
      "health_check_url": "/health"
    }
  ],
  "provider_for_planning": "my-proxy",
  "provider_for_phases": "my-proxy"
}
```

A repo's `cpe.config.json` can override this entirely by defining its own `providers`, `provider_for_planning`, and `provider_for_phases` fields. The repo-level list fully replaces the global list — there is no merging.

### Managing providers

```bash
cpe provider list             # Show all providers and their assigned roles
cpe provider add              # Interactive wizard — name, model, URL, API key, health check
cpe provider remove my-proxy  # Remove by name
cpe provider test             # Run health checks for all providers
cpe provider test my-proxy    # Run health check for one provider
```

`cpe provider list` shows a `Roles` column: **P** = used for planning, **F** = used for phases, **P+F** = both, **—** = not currently assigned to a role.

### Local models (zero API cost)

Point a provider at a local [Ollama](https://ollama.com) endpoint to run `cpe` for free. Modern Ollama serves the **Anthropic Messages API natively** (including tool use), so `claude-code` needs no translation proxy — just set `anthropic_base_url` to the Ollama host:

```bash
cpe provider add
  Name:                 local-ollama
  Models:               gemma4-cpe:31b, gemma4-cpe:26b
  Default model:        gemma4-cpe:31b
  ANTHROPIC_BASE_URL:   http://<ollama-host>:11434
  ANTHROPIC_AUTH_TOKEN: ollama        # Ollama ignores it; any value
  Health check URL:     /api/tags
```

The opaque harnesses reach local models through their own native/OpenAI-compatible/LiteLLM paths (see the [Supported harnesses](#supported-harnesses) table); `cpe` translates the provider's base URL into whatever each harness expects. A LiteLLM proxy is only needed for backends that don't speak the Anthropic API natively.

## Harnesses

A **harness** is the coding agent that actually edits code. `cpe` ships an adapter per harness behind a small contract (headless invocation, model wiring, and a *completion mode*):

- **structured** — the agent returns a parseable result envelope (outcome, tokens, cost). Only `claude-code` is structured, and it is the harness that drives the full **plan → phase → PR → summary** loop.
- **opaque** — the agent gives no machine-readable result; `cpe` derives the outcome from the process exit code plus the git diff it produced. All the alternative harnesses are opaque, and today they are run via [`cpe bench`](#benchmarking-harnesses) (clone-isolated). Wiring them into the normal worktree plan loop is in progress.

### Supported harnesses

| Harness | `--harness` | Mode | Local model | Install |
|---|---|---|---|---|
| Claude Code | `claude-code` | structured | Anthropic API (or Anthropic-native Ollama) | [docs](https://docs.claude.com/en/docs/claude-code) |
| opencode | `opencode` | opaque | OpenAI-compatible | [opencode.ai](https://opencode.ai) |
| Aider | `aider` | opaque | LiteLLM / OpenAI-compatible | [aider.chat](https://aider.chat) |
| goose | `goose` | opaque | Ollama provider | [block.github.io/goose](https://block.github.io/goose) |
| OpenHands | `openhands` | opaque | LiteLLM (`ollama/…`) | [docs.all-hands.dev](https://docs.all-hands.dev) |
| Plandex | `plandex` | opaque | server-side (needs a Plandex server) | [plandex.ai](https://plandex.ai) |
| pi | `pi` | opaque | OpenAI-compatible | [pi.dev](https://pi.dev) |
| Crush | `crush` | opaque | OpenAI-compatible | [github.com/charmbracelet/crush](https://github.com/charmbracelet/crush) |
| Codex CLI | `codex` | opaque | OpenAI Responses API (Ollama serves it natively) | [github.com/openai/codex](https://github.com/openai/codex) |
| mini-swe-agent | `mini-swe-agent` | opaque | LiteLLM (`ollama/…`) | [github.com/SWE-agent/mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent) |

Only `claude-code` is required. Each alternative harness is its own CLI you install separately — `cpe` does **not** bundle them.

### Install detection

`cpe` will only let you select a harness whose CLI is actually installed. Probing every harness on each invocation would be slow, so detection results are **cached** in `~/.config/cpe/config.json`. The first harness-selecting command (`cpe start`, `cpe bench`, or a `--harness` run) runs detection automatically; afterwards it is read from the cache.

```bash
cpe harness check     # (re)probe every harness's CLI + version, refresh the cache
cpe harness list      # show the cached status (probes once if never checked)
```

`cpe harness check` prints live progress while scanning and a final table:

```
Checking for codex........... found (0.137.0)
Checking for aider........... found (0.86.2)
...
Harness         Installed  Version     Path / install
---------------------------------------------------------------------------------
codex           yes        0.137.0     /home/you/.local/bin/codex
aider           yes        0.86.2      /home/you/.local/bin/aider
opencode        no         —           (not on PATH)
```

Selecting an uninstalled harness is blocked with its install link — both for an explicit `--harness` and for the resolved default at run time. Re-run `cpe harness check` after installing or upgrading a harness.

### Selecting a harness

```bash
cpe prompt "fix the failing test" --harness opencode --model gemma4-cpe:31b --provider local-ollama
```

You can also set defaults in config (global or per-repo): `harness_for_planning` and `harness_for_phases` (both default to `claude-code`).

## Benchmarking harnesses

`cpe bench` runs the **same prompt** across a harness×model matrix so you can compare how different agents (and models) tackle one task. Each combination runs in a throwaway **full clone** of your repo (an agent running `git reset --hard` can never touch your real checkout), strictly sequentially, with an activity-based timeout and a manual bail.

```bash
# One prompt, three harnesses, two models = 6 clone-isolated runs:
cpe bench "add a --json flag to the export command" \
  --harness claude-code,opencode,aider \
  --model gemma4-cpe:31b,gemma4-cpe:26b \
  --provider local-ollama

cpe start            # execute the queued matrix (sequential, with an inter-run pause)
cpe bench summary    # tabulate the captured results
```

For each combination `cpe` captures `results/<harness>__<model>/{diff,transcript,meta.json}` under its state dir and pushes a `harnesstests/<harness>__<model>` branch (when the repo has a remote). `cpe bench summary` prints outcome, duration, files/lines changed, tokens, cost, and the pushed branch per combination. Quality scoring stays manual — `cpe` gives you the diffs and metrics to judge.

Useful flags: `--repo`/`--branch` (baseline to clone, defaults to the current repo/branch), `--prompt-file`, and `--force` (re-run combinations that already have captured results).

## How it works

Each plan lives in a `docs/<folder>/` directory with a `PROGRESS.md` and one `PHASE_NN.prompt.md` per phase (planbot output). `cpe` processes them sequentially:

1. Creates a `git worktree` for the run so your main checkout is never touched
2. Runs each phase through the configured harness (by default `claude-code`, spawning `claude -p`) with the phase prompt
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
