Read docs/claude-plan-executor/PHASE_04.md for full context before starting.

You are implementing phase 04 of the Claude Plan Executor (`cpe`) project. This phase builds the
git worktree lifecycle, primary-repo detection, and the per-repo cpe.config.json system.

Working directory: /home/ubuntu/Code/claude-plan-executor
Branch: feature/claude-plan-executor-phase-4 (create it off feature/claude-plan-executor)
PR target: feature/claude-plan-executor

Before writing anything, read:
- docs/000-claude-plan-executor-spec.md §4.3 (worktree model)
- docs/000-claude-plan-executor-spec.md §6.1 (per-repo config and first-time prompt)
- docs/000-claude-plan-executor-spec.md §7.0 (worktree creation and bootstrap)

Pattern for shelling out to git: use Bun.spawn (synchronous) or spawn with await. Always set
cwd explicitly. Capture stdout as text. Throw a typed Error with the command and exit code on
non-zero exit. Never use execSync from 'child_process' — use Bun's APIs throughout.

Example spawn pattern:
  const proc = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { cwd });
  if (proc.exitCode !== 0) throw new Error(`git error: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();

FILE: src/git/repo.ts

interface ParsedRemote {
  host: string;
  owner: string;
  repo: string;
  type: 'github' | 'gitea' | 'other';
}

Export:
- getPrimaryRepo(): string — runs `git rev-parse --show-toplevel` from process.cwd(); throws
  with a user-friendly message if not in a git repo ("Not inside a git repository")
- getRemote(repoPath: string, giteaHost?: string): ParsedRemote — runs `git remote get-url origin`
  then parses. Handle both SSH (git@github.com:owner/repo.git) and HTTPS
  (https://github.com/owner/repo.git) formats. Type is 'github' if host is github.com, 'gitea'
  if host matches giteaHost param, 'other' otherwise. Strip trailing .git from repo name.
- getCurrentBranch(repoPath: string): string — `git rev-parse --abbrev-ref HEAD`
- getHead(repoPath: string): string — `git rev-parse HEAD` (returns full SHA)

FILE: src/git/worktree.ts

interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

WORKTREE_BASE: string = path.join(os.homedir(), '.local', 'state', 'cpe', 'worktrees')

Export:
- getWorktreePath(runId: string): string — path.join(WORKTREE_BASE, runId)
- createWorktree(primaryRepo: string, runId: string, branch: string, targetBranch: string): string
  — creates the worktree directory, runs `git worktree add <path> -b <branch> <targetBranch>` in
  primaryRepo. Returns the worktree path.
- renameWorktreeBranch(primaryRepo: string, oldBranch: string, newBranch: string): void
  — `git branch -m <old> <new>` in primaryRepo
- moveWorktree(primaryRepo: string, oldPath: string, newPath: string): void
  — `git worktree move <old> <new>` in primaryRepo. Creates parent dir of newPath if needed.
- removeWorktree(primaryRepo: string, worktreePath: string, force?: boolean): void
  — `git worktree remove [--force] <path>` in primaryRepo.
  IMPORTANT: this does NOT delete the branch — call deleteBranch separately if needed.
- deleteBranch(primaryRepo: string, branch: string): void
  — `git branch -D <branch>` in primaryRepo
- listWorktrees(primaryRepo: string): WorktreeInfo[]
  — parse `git worktree list --porcelain` output. Each worktree block:
    worktree <path>\n HEAD <sha>\n branch refs/heads/<branch>\n
    (or "bare" line instead of branch for bare repos)
  Returns array with one entry per worktree. Skip entries where path === primaryRepo (the main
  worktree) to return only added worktrees.
- reconcileWorktrees(primaryRepo: string, knownRunIds: string[]): {
    orphaned: WorktreeInfo[];
    missing: string[];
  }
  — orphaned: worktrees in git whose path basename matches the worktree base dir but no known
    run ID matches. missing: run IDs in knownRunIds whose worktree path doesn't appear in git
    worktree list.

FILE: src/config/repo-config.ts

interface RepoConfig {
  bootstrap: string[];
}

interface BootstrapDetectResult {
  commands: string[];
  inspected_files: string[];
  reasoning: string;
  blockers?: string[];
}

interface BootstrapRunResult {
  success: boolean;
  failedCommand?: string;
  exitCode?: number;
}

Export:
- REPO_CONFIG_FILENAME: string = 'cpe.config.json'
- readRepoConfig(repoPath: string): RepoConfig | null
  — reads and parses cpe.config.json; returns null if absent; throws on malformed JSON
- writeRepoConfig(repoPath: string, config: RepoConfig): void
  — writes with 2-space indent + trailing newline
- runBootstrap(worktreePath: string, commands: string[], logPath: string): Promise<BootstrapRunResult>
  — executes each command sequentially using Bun.spawn with cwd: worktreePath.
  Stream stdout+stderr to the log file (create parent dirs with { recursive: true }).
  On non-zero exit from any command: return { success: false, failedCommand: cmd, exitCode }.
  On all commands pass: return { success: true }.
- ensureRepoConfig(repoPath: string, giteaHost?: string): Promise<RepoConfig>
  — if config exists, return it. Otherwise run the first-time interactive prompt (see below).

First-time prompt in ensureRepoConfig:
Print to stdout:
  "No cpe.config.json found for this repo."
  "How would you like to set up the bootstrap commands for fresh worktrees?"
  "  1. Detect with Claude (one-off LLM call, ~$0.05)"
  "  2. Create a stub I'll fill in myself"
  "  3. Skip — I don't need a bootstrap step"
  "Choice [1/2/3]: "
Read one character from stdin. Switch:
- '1': call detectBootstrap(repoPath) — spawn `claude -p --output-format=json --json-schema
  <bootstrap-schema-path>` with the bootstrap-detect prompt injected with repo path. Parse the
  JSON response as BootstrapDetectResult. Print the suggested commands, files inspected, and
  reasoning. Prompt "Accept? [Y/edit/n]: ". On Y: writeRepoConfig and return. On edit: write to
  temp file, open in $EDITOR (Bun.spawn with stdio inherited), re-read, save. On n: fall through
  to option 2.
- '2': write a stub config with comments explaining the bootstrap field. Open in $EDITOR if set.
  Return the written config (or { bootstrap: [] } if editor not set).
- '3' (or default): writeRepoConfig with { bootstrap: [] }. Print "Saved cpe.config.json with
  empty bootstrap." Return { bootstrap: [] }.

STUB TEMPLATE for option 2:
{
  "bootstrap": [
    // Add shell commands to run in fresh worktrees before any phase starts.
    // Example: "npm install", "composer install", "pip install -e ."
    // Commands run in order from the worktree root.
    // Commit or gitignore this file — your choice.
  ]
}

FILE: src/commands/bootstrap.ts

Exports one function: bootstrapCommand(flags: { detect?: boolean; stub?: boolean; edit?: boolean })
- No flags: call ensureRepoConfig with force=true (always show menu, overwrite if exists)
- --detect: run LLM detection only; skip menu
- --stub: write stub template only; skip menu
- --edit: if config exists, open in $EDITOR; if not, stub first then open
This will be wired to the `cpe bootstrap` subcommand in Phase 05.

Unit test: src/git/worktree.test.ts
- 'parseWorktreeList correctly parses --porcelain output' — write a fixture string with two
  worktrees (main + one added worktree), call a helper that parses the porcelain format,
  assert the parsed WorktreeInfo matches expected values. Test the pure parsing logic without
  any real git calls.
Export a `parseWorktreePorcelain(output: string): WorktreeInfo[]` helper (also used in
listWorktrees) so it can be tested in isolation.

VERIFY before committing:
1. bun test passes (including worktree.test.ts)
2. bun run typecheck passes
3. getPrimaryRepo() returns the correct path when run from within this git repo

After all criteria pass:
1. git add src/git/ src/config/ src/commands/bootstrap.ts src/git/worktree.test.ts
2. git commit -m "feat: phase 04 — worktree management and per-repo config"
3. git push -u origin feature/claude-plan-executor-phase-4
4. Create PR targeting feature/claude-plan-executor

Update docs/claude-plan-executor/PROGRESS.md on start and completion.

Your final message in this conversation must be a JSON object matching the schema you have been
given. Do all your work using tools first, then emit only the JSON as your closing message.
