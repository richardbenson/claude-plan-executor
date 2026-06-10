Read docs/self-update/PHASE_01.md for context before starting, and docs/self-update/README.md for the overall feature requirements. You are working on branch feature/self-update — create it from main if it does not exist yet, or check it out if it does.

**PROGRESS.md update**: At the start of this phase, update `PROGRESS.md`: set the status for this phase to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format. The file is docs/self-update/PROGRESS.md — update both the summary table row and the Phase Details entry.

**Idempotency**: Before each significant action (creating a file, running a migration, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after a rate-limit interruption.

## Task

Add SHA256 checksum publication to the release pipeline and checksum verification to the remote install script.

## Files to modify

1. `.github/workflows/release.yml` — in the `release` job, after the `actions/download-artifact@v8` step and before the `gh release create` step, add a step that collects the four binaries from their nested artifact paths (`artifacts/<asset>/<asset>`) into a single flat directory, then runs `sha256sum` over the bare filenames to produce a `SHA256SUMS` file whose lines reference plain asset names (`<hash>  cpe-linux-x64`, etc.). Add the `SHA256SUMS` file to the asset list passed to `gh release create`. Keep the existing assets (four binaries plus `scripts/install.sh`) exactly as they are; adjust the binary paths in the `gh release create` arguments if you point them at the flat directory instead of the nested artifact paths.

2. `scripts/install.sh` — after downloading the binary and before `chmod +x`, attempt to download `SHA256SUMS` from the same `releases/latest/download/` base URL into a temp file. If the download fails (release predates checksums), print a `[warn]` line that verification was skipped and continue — this script is itself a release asset and must keep working against older releases. If it succeeds, extract the line matching the chosen `$ASSET` name and verify the downloaded binary against it; on mismatch, delete the downloaded binary, print a clear error to stderr, and exit 1. Use `sha256sum` when available and fall back to `shasum -a 256` (macOS ships only the latter). Clean up the temp file in all paths.

3. `docs/install-and-release.md` — append a dated note (2026-06-10) to the "What Was Built" section recording that releases now include a `SHA256SUMS` asset and that `install.sh` verifies against it when present.

## Code patterns to follow

- `release.yml` uses plain `run:` steps with bash; follow the existing style (env vars via `env:` blocks, `$TAG`-style references, no third-party actions beyond the ones already used).
- `install.sh` uses `set -euo pipefail`, lowercase locals (`os`, `arch`, `ASSET` for the derived asset), `[warn]`/`[info]` prefixes for advisory output, and stderr + `exit 1` for fatal errors. Match the existing case-statement and quoting style.

## Edge cases

- `SHA256SUMS` lines must use exactly two spaces between hash and filename (the `sha256sum` default) so `sha256sum -c` and naive `awk '{print $1}'` parsing both work.
- The artifact download layout is nested (`artifacts/cpe-linux-x64/cpe-linux-x64`); hashing must happen against bare filenames or the SUMS lines will contain paths no verifier can match.
- macOS has no `sha256sum`; Linux minimal images may lack `shasum`. Detect with `command -v` and use whichever exists; if neither exists, warn and skip verification rather than failing the install.
- A partially-downloaded binary must never be left at `~/.local/bin/cpe` after a failed verification.

## Acceptance criteria

- `bash -n scripts/install.sh` passes (syntax check).
- The release workflow YAML is valid (parses cleanly; `actionlint` if available, otherwise a YAML parse via `bun -e` or python is sufficient).
- Reading the workflow diff: `SHA256SUMS` is generated from bare asset names and is included in the `gh release create` asset list.
- `scripts/install.sh` verification logic: mismatch path deletes the binary and exits non-zero; missing-SUMS path warns and continues; both checked by manual inspection or a scripted dry-run with a locally crafted SUMS file (do not hit the network in CI tests).
- `bun run typecheck`, `bun run lint`, and `bun test` still pass (no TypeScript is touched, but run them to confirm the tree is green).

## References

- `.github/workflows/release.yml` — current build/release jobs and asset naming.
- `scripts/install.sh` — current download flow, platform detection, and the `[warn]`/`[info]` output conventions to match.
- `docs/install-and-release.md` — "Lessons Learned" already documents the nested artifact layout (`artifacts/<asset>/<asset>`); your flat-directory step is the consequence of that layout.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with a conventional commit message (e.g. `feat: phase 01 — publish SHA256SUMS with releases and verify in install.sh`). Do not make intermediate commits during the phase. If you find the working tree already has a commit for this phase (check `git log --oneline -3`), skip the commit step.
