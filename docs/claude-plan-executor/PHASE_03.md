# Phase 03 — Types, State Taxonomy, Storage Layer

## Summary

Define all shared TypeScript interfaces and the central state taxonomy, then implement the three
JSON-file persistence modules (config, queue, meta). Unit tests cover the state table lookups and
the meta.json read/write round-trip.

## Context

### State taxonomy (src/types/state.ts)
The single source of truth for run/phase status, matching `docs/DESIGN.md §2.3` exactly.
Must define:
- `RunStatus` and `PhaseStatus` as TypeScript union types (string literals — not enums, for JSON
  round-trip safety)
- A `STATE_TABLE` constant mapping each status to `{ glyph, color, label }` where color is the
  Tokyo Night hex token from DESIGN.md §2.2 and glyph is the Unicode character from DESIGN.md
  §2.3
- Both run and phase statuses draw from the same set so the TUI can render either with the same
  lookup

States: `queued`, `executing`, `retrying`, `paused`, `paused-limit`, `finalising`, `complete`,
`pr-created`, `failed`, `pending` — see DESIGN.md §2.3 for each state's glyph and color.

### Shared interfaces (src/types/meta.ts)
TypeScript interfaces matching the JSON shapes in §5 of the spec:
- `PhaseEntry` — number, prompt_file, status, retry_count, commit_sha?, started_at?, completed_at?,
  session_id?, cost_usd?, tokens?, summary?, notes_for_next_phase?, commit_message?, blockers?
- `RunMeta` — id, primary_repo_path, worktree_path, plan_folder, feature_branch, target_branch,
  remote, status, total_cost_usd, phases: PhaseEntry[]
- `QueueEntry` — run_id, added_at, priority (position in queue)
- `AppQueue` — entries: QueueEntry[]
- `AppConfig` — global settings: max_retries (default 1), gitea_host? (for VCS detection)

### Storage modules
Each module owns one JSON file. Pattern: read file (parse JSON), write file (stringify with 2-space
indent + trailing newline), ensure parent directory exists on write.

- `src/storage/config.ts` — `~/.config/cpe/config.json`. Exports `readConfig()`, `writeConfig()`.
  On first read, if file absent, returns default config (do not throw).
- `src/storage/queue.ts` — `~/.local/state/cpe/queue.json`. Exports `readQueue()`, `writeQueue()`,
  `enqueue(runId)`, `dequeue()` (returns first run_id and removes it), `removeFromQueue(runId)`.
- `src/storage/meta.ts` — `~/.local/state/cpe/runs/<run-id>/meta.json`. Exports `readMeta(runId)`,
  `writeMeta(runId, meta)`, `updateMeta(runId, partial)` (read-modify-write). Must create the run
  directory if absent on write.

### Unit tests (src/storage/meta.test.ts)
- `STATE_TABLE` covers all 10 states (no missing keys)
- `readMeta` / `writeMeta` round-trip: write a `RunMeta`, read it back, deep-equal
- `updateMeta` correctly merges a partial update without clobbering other fields
- `enqueue` / `dequeue` FIFO ordering

Use a temp directory (via `os.tmpdir()` + unique suffix) for storage tests — never write to the
real `~/.local/state/cpe/` in tests.

## Files Expected to Change

- `src/types/state.ts` — created
- `src/types/meta.ts` — created
- `src/storage/config.ts` — created
- `src/storage/queue.ts` — created
- `src/storage/meta.ts` — created
- `src/storage/meta.test.ts` — created (covers all four units above)

## Acceptance Criteria

1. `bun test` passes including all new tests
2. `tsc --noEmit` passes
3. `STATE_TABLE` contains entries for all 10 states with non-empty glyph, color (hex string), and
   label fields
4. Storage modules write valid JSON with 2-space indent + trailing newline
5. `updateMeta` is atomic at the JS level (read → merge → write, no concurrent-write safety needed
   yet)

## Dependencies

Phase 02 (prompts directory created so `src/` structure is established).
