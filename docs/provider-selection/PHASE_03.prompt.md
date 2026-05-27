Read `docs/provider-selection/PHASE_03.md` for full context before starting.

**PROGRESS.md update**: At the start of this phase, update `docs/provider-selection/PROGRESS.md`: set the status for Phase 3 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**Idempotency**: Before each significant action (creating a file, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after interruption.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with message `feat: phase 03 — cpe provider CLI`. If `git log --oneline -3` already shows this commit, skip the commit step.

**Structured output**: Your final message must be a JSON object matching the phase result schema you have been given.

---

## Task

Implement the `cpe provider` CLI subcommand with four sub-subcommands: `list`, `add`, `remove`, `test`.

### 1. `src/commands/provider.ts` (new file)

Implement the following exported async functions:

#### `providerListCommand(): Promise<void>`

- Read config via `readConfig()` from `'../storage/config.js'`.
- If `config.providers` is undefined or empty, print `No providers configured. Use 'cpe provider add' to add one.` and return.
- Print a header row and separator, then one row per provider.
- Columns: `Name`, `Model`, `Base URL`, `Health URL`, `Roles`
- For `Roles`: if the provider's name matches `config.provider_for_planning` and `config.provider_for_phases`, print `P+F`. If only planning, `P`. If only phases, `F`. Otherwise `—`.
- Truncate long URLs to 40 chars with `…` suffix for display.
- After the table, if `config.provider_for_planning` is set, print `Planning default: <name>`.
- After the table, if `config.provider_for_phases` is set, print `Phase default:    <name>`.

#### `providerAddCommand(): Promise<void>`

Interactive wizard using synchronous `readLine()` (same pattern as `src/config/repo-config.ts`):

```typescript
function readLine(): string {
  const buf = Buffer.alloc(4096);
  let total = 0;
  while (true) {
    const n = fs.readSync(0, buf, total, 1, null);
    if (n === 0) break;
    if (buf[total] === 0x0a) break;
    total += n;
  }
  return buf.slice(0, total).toString('utf8').trim();
}
```

Prompt sequence (print prompt, read line):
1. `Name: ` — required; re-prompt if empty or already exists.
2. `Model (Enter to skip): ` — optional.
3. `ANTHROPIC_BASE_URL (Enter to skip): ` — optional.
4. `ANTHROPIC_API_KEY (Enter to skip): ` — optional.
5. `ANTHROPIC_AUTH_TOKEN (Enter to skip): ` — optional.
6. `Health check URL (Enter to skip): ` — optional; explain "(full URL or path relative to base URL)".
7. `Set as default for planning sessions? [y/N]: ` — default N.
8. `Set as default for phase/single-prompt sessions? [y/N]: ` — default N.

Build the `ProviderEntry` from non-empty fields only. Append to `config.providers` (initialise array if undefined). Update `provider_for_planning` / `provider_for_phases` if answered `y`. Write config. Print `Provider '<name>' added.`

#### `providerRemoveCommand(name: string): Promise<void>`

- Read config.
- Find the provider with the given name. If not found, print error and `process.exit(1)`.
- Remove it from `config.providers`.
- If `config.provider_for_planning === name`, delete that field.
- If `config.provider_for_phases === name`, delete that field.
- Write config. Print `Provider '<name>' removed.`

#### `providerTestCommand(name?: string): Promise<void>`

- Read config.
- Build the list of providers to test: if `name` is given, find that one (error + exit(1) if not found); otherwise test all.
- For each provider, call `checkProvider(provider)` from `'../runner/provider.js'`.
- Print one line per provider:
  - If no `health_check_url`: `  <name>: (no check — assumed available)`
  - If check passed: `  <name>: ✓ available  [<url>]`
  - If check failed: `  <name>: ✗ unavailable  [<url>]`
- Use `process.stdout.write` for output.

Import `ProviderEntry` from `'../types/meta.js'`, `readConfig`, `writeConfig` from `'../storage/config.js'`, `checkProvider` from `'../runner/provider.js'`.

### 2. `src/cli.ts`

Import the four command functions:

```typescript
import {
  providerListCommand,
  providerAddCommand,
  providerRemoveCommand,
  providerTestCommand,
} from './commands/provider.js';
```

Register a `provider` parent command with four subcommands. Follow the existing pattern of `wrap()` for error handling:

```typescript
const providerCmd = program
  .command('provider')
  .description('Manage Claude providers (alternative models / API endpoints)');

providerCmd
  .command('list')
  .description('List configured providers')
  .action(wrap(providerListCommand));

providerCmd
  .command('add')
  .description('Add a provider interactively')
  .action(wrap(providerAddCommand));

providerCmd
  .command('remove <name>')
  .description('Remove a provider by name')
  .action(wrap(providerRemoveCommand));

providerCmd
  .command('test [name]')
  .description('Test provider health checks (all providers, or one by name)')
  .action(wrap(providerTestCommand));
```

### Code patterns to follow

- `readLine()` reads from file descriptor 0 (stdin) synchronously — same pattern as `src/config/repo-config.ts` lines 128–138.
- `readConfig()` / `writeConfig()` from `src/storage/config.ts` are the canonical config accessors.
- All imports use `.js` suffix.
- No `console.log` in the command functions — use `process.stdout.write(... + '\n')` for consistency with the rest of the CLI.
- Commander subcommands use the `parentCmd.command(...)` pattern; do not use `.addCommand()`.

### Edge cases

- `cpe provider add` with a name that already exists → re-prompt (do not exit).
- `cpe provider remove` with a name not in the list → print `Provider '<name>' not found.` and exit(1).
- `cpe provider test` with an empty provider list → print `No providers configured.` and return without error.
- `cpe provider test <name>` where name is not found → print error and exit(1).
- `writeConfig` creates the config directory if it does not exist (already handled by `writeConfig` in `src/storage/config.ts`).

### Acceptance criteria

- [ ] `cpe provider list` prints a table when providers are configured, and a helpful message when none are.
- [ ] `cpe provider add` successfully adds a provider to `~/.config/cpe/config.json`.
- [ ] `cpe provider add` sets `provider_for_planning` / `provider_for_phases` if the user answers `y`.
- [ ] `cpe provider remove <name>` removes the provider and clears role references.
- [ ] `cpe provider remove <nonexistent>` exits with code 1 and an error message.
- [ ] `cpe provider test` runs health checks and prints pass/fail.
- [ ] `cpe provider test <name>` tests only the named provider.
- [ ] All four subcommands are reachable via `cpe provider <subcommand>`.
- [ ] `bun run build` passes with no type errors.
- [ ] `bun test` passes.

### References

- `src/cli.ts` — existing command registration pattern (lines 28–116)
- `src/config/repo-config.ts` — `readLine()` implementation (lines 128–138), interactive prompt pattern (lines 157–208)
- `src/storage/config.ts` — `readConfig()`, `writeConfig()`, `CONFIG_PATH`
- `src/runner/provider.ts` — `checkProvider` (from Phase 1)
- `src/types/meta.ts` — `ProviderEntry`, `AppConfig` (from Phase 1)
