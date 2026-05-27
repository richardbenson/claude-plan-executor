# Phase 3 — `cpe provider` CLI subcommand

## Summary

Add a `cpe provider` parent command with four subcommands for managing the global provider list in `~/.config/cpe/config.json`. This is the only user-facing surface for provider management.

## Context

After Phases 1 and 2, providers are fully functional but can only be configured by hand-editing `~/.config/cpe/config.json`. This phase adds a proper CLI surface.

## Subcommands

### `cpe provider list`

Reads `~/.config/cpe/config.json` and prints a table of configured providers. If no providers are configured, prints a helpful message. Columns: Name, Model, Base URL, Health check URL, Role (P=planning, F=phases, PF=both, –=neither). Mark the provider_for_planning with `[P]` and provider_for_phases with `[F]` in a roles column.

### `cpe provider add`

Interactive wizard. Prompts for:
1. Name (required, must be unique)
2. Model name (optional, press Enter to skip)
3. ANTHROPIC_BASE_URL (optional)
4. ANTHROPIC_API_KEY (optional)
5. ANTHROPIC_AUTH_TOKEN (optional)
6. Health check URL (optional; full URL or path relative to base URL)
7. Set as default for planning? [y/N]
8. Set as default for phases? [y/N]

Writes the updated config. Prints confirmation.

### `cpe provider remove <name>`

Removes the provider with the given name. Errors clearly if not found. If the removed provider was `provider_for_planning` or `provider_for_phases`, clears those fields too.

### `cpe provider test [name]`

Runs the health check for one named provider (or all providers if no name given). Prints pass/fail for each. Uses `checkProvider` from Phase 1. For providers without a `health_check_url`, prints `(no check — assumed available)`.

## Files Expected to Change

| File | Change |
|---|---|
| `src/commands/provider.ts` | **New file** — all four subcommands |
| `src/cli.ts` | Register `cpe provider` command with four subcommands |
