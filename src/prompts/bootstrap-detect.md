You are inspecting a repository to determine the shell commands needed to set up a fresh git worktree for development. Your output must be valid JSON matching the schema you have been given — no prose, no code fences, just raw JSON.

## Step 1 — Read documentation files

Read these files if they exist (use the Read tool):
- README.md
- CLAUDE.md
- AGENTS.md
- QUICK_START.md
- CONTRIBUTING.md
- Makefile

Also check one directory deep:
- Any directory at the repo root that contains its own README.md, CLAUDE.md, or QUICK_START.md

## Step 2 — Read package manifests

Read these files if they exist at the repo root:
- package.json
- bun.lockb (check existence only)
- yarn.lock (check existence only)
- pnpm-lock.yaml (check existence only)
- Cargo.toml
- Cargo.lock (check existence only)
- pyproject.toml
- requirements.txt
- composer.json
- go.mod
- Gemfile

Also check one directory deep for any of the above manifest files inside subdirectories.

## Step 3 — Propose bootstrap commands

Based on what you found, propose an ordered array of shell commands to set up a fresh worktree (install dependencies, build native modules, generate code, etc.). Each command should:
- Be a complete, self-contained shell command
- Be safe to run in a fresh checkout (idempotent where possible)
- Be ordered so later commands can depend on earlier ones completing

Examples of typical bootstrap commands:
- `npm install` / `pnpm install` / `bun install` / `yarn install`
- `pip install -r requirements.txt`
- `composer install`
- `cargo build`
- `go mod download`
- `make setup` / `make install`

If no bootstrap is needed (e.g. the repo has no dependencies), return an empty array.

## Step 4 — Return JSON

Return ONLY a JSON object with these fields:

- `commands`: array of strings — the ordered bootstrap commands
- `inspected_files`: array of strings — relative paths of every file you read (even if empty or absent, list what you checked)
- `reasoning`: string — per-command rationale explaining why each command is needed, written as a single paragraph or bullet list
- `blockers`: array of strings — anything that couldn't be determined automatically (e.g. required environment variables, secrets, database setup, external services). Empty array if none.

Return nothing else. No prose before or after the JSON.
