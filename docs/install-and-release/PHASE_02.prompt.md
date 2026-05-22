Read docs/install-and-release/PHASE_02.md for full context before starting.

You are implementing Phase 02 of the install-and-release plan: GitHub Actions workflows. The goal is to add two workflow files — one for CI checks on every push/PR, one for building and releasing platform binaries when a `v*` tag is pushed.

**Idempotency**: Before each significant action (creating a file, making a commit), check the working tree state first — does the file already exist? Is this already committed? This makes the phase safe to resume after a rate-limit interruption.

**PROGRESS.md update**: At the start of this phase, update `docs/install-and-release/PROGRESS.md`: set the status for Phase 02 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with message `feat: phase 02 — github actions workflows`. Do not make intermediate commits. If `git log --oneline -3` already shows a commit for this phase, skip the commit step.

---

## Work to do

### 1. Create `.github/workflows/ci.yml`

Create a workflow that:
- Is named `CI`
- Triggers on: `push` to any branch, `pull_request` targeting `main`
- Has a single job `check` running on `ubuntu-latest`
- Steps:
  1. `actions/checkout@v4`
  2. `oven-sh/setup-bun@v2`
  3. `bun install --frozen-lockfile`
  4. Run `bun run typecheck`
  5. Run `bun run lint`
  6. Run `bun test`

### 2. Create `.github/workflows/release.yml`

Create a workflow that:
- Is named `Release`
- Triggers on: `push` with tags matching `v*`
- Has a `build` job running a matrix of four targets on `ubuntu-latest`:
  - Matrix entries (each with `target` and `asset` fields):
    - `bun-linux-x64` / `cpe-linux-x64`
    - `bun-linux-arm64` / `cpe-linux-arm64`
    - `bun-darwin-x64` / `cpe-darwin-x64`
    - `bun-darwin-arm64` / `cpe-darwin-arm64`
  - Steps per matrix job:
    1. `actions/checkout@v4`
    2. `oven-sh/setup-bun@v2`
    3. `bun install --frozen-lockfile`
    4. Build command:
       ```
       bun build --compile --target=${{ matrix.target }} --define 'process.env.CPE_VERSION="${{ github.ref_name }}"' --outfile ${{ matrix.asset }} src/index.ts
       ```
    5. `actions/upload-artifact@v4` — name: `${{ matrix.asset }}`, path: `${{ matrix.asset }}`

- Has a `release` job that:
  - `needs: build`
  - Runs on `ubuntu-latest`
  - Has `permissions: contents: write`
  - Steps:
    1. `actions/download-artifact@v4` with `path: artifacts`
    2. Create the release:
       ```
       gh release create ${{ github.ref_name }} \
         --title "Release ${{ github.ref_name }}" \
         --generate-notes \
         artifacts/cpe-linux-x64/cpe-linux-x64 \
         artifacts/cpe-linux-arm64/cpe-linux-arm64 \
         artifacts/cpe-darwin-x64/cpe-darwin-x64 \
         artifacts/cpe-darwin-arm64/cpe-darwin-arm64
       ```
       with `env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`

### 3. Verify

Confirm the YAML syntax is valid by running:
```
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo OK
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" && echo OK
```

Both must print `OK`.

---

## Acceptance criteria

- `.github/workflows/ci.yml` exists and is valid YAML
- `.github/workflows/release.yml` exists and is valid YAML
- The CI workflow triggers on push and PR, runs typecheck + lint + test
- The release workflow triggers only on `v*` tags
- The matrix covers all four Bun targets: `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`
- The release job has `permissions: contents: write`
- The version define flag uses `github.ref_name` (the tag name)
- YAML syntax validation passes for both files

---

**Structured output**: Your final message in this conversation must be a JSON object matching the schema you have been given. Do all your work using tools first, then emit only the JSON as your closing message.
