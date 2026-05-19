Read docs/claude-plan-executor/PHASE_03.md for full context before starting.

You are implementing phase 03 of the Claude Plan Executor (`cpe`) project. This phase defines all
shared TypeScript types (state taxonomy, meta.json interfaces) and the three JSON storage modules.

Working directory: /home/ubuntu/Code/claude-plan-executor
Branch: feature/claude-plan-executor-phase-3 (create it off feature/claude-plan-executor)
PR target: feature/claude-plan-executor

Before writing anything, read:
- docs/DESIGN.md §2.2 (Tokyo Night colour tokens) and §2.3 (state taxonomy table with glyphs)
- docs/000-claude-plan-executor-spec.md §5 (storage layout and meta.json shape)
- docs/000-claude-plan-executor-spec.md §5.1 (state taxonomy definitions)
- src/prompts/phase-result-schema.json (the phase result shape to align with)

FILE: src/types/state.ts

Define RunStatus and PhaseStatus as TypeScript string union types (not enums — string literals
round-trip cleanly through JSON). Both draw from the same set of 10 states:
'queued' | 'executing' | 'retrying' | 'paused' | 'paused-limit' | 'finalising' | 'complete' |
'pr-created' | 'failed' | 'pending'

Define a StateInfo interface: { glyph: string; color: string; label: string }

Define STATE_TABLE as a Record<RunStatus | PhaseStatus, StateInfo>. Each entry must exactly match
docs/DESIGN.md §2.3. Glyph column uses the Unicode character shown (○ ◐ ↻ ⏸ ◴ ⤴ ● ✓ ✕ ·).
Color column uses the hex value of the named Tokyo Night token from DESIGN.md §2.2:
- queued: dim2 (#737aa2)
- executing: cyan (#7dcfff)
- retrying: orange (#ff9e64)
- paused: yellow (#e0af68)
- paused-limit: magenta (#bb9af7)
- finalising: teal (#73daca)
- complete: green (#9ece6a)
- pr-created: green (#9ece6a)
- failed: red (#f7768e)
- pending: dim (#565f89)

Export: RunStatus, PhaseStatus, StateInfo, STATE_TABLE, and a helper function:
getStateInfo(status: RunStatus | PhaseStatus): StateInfo
(throws if status is unknown — safeguard against future schema drift)

FILE: src/types/meta.ts

TypeScript interfaces matching the JSON shapes from spec §5. All fields that can be absent from
a newly-created run should be optional (?). Use readonly arrays where the data doesn't mutate
after creation.

interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

interface PhaseEntry {
  number: number;
  prompt_file: string;
  status: PhaseStatus;
  retry_count: number;
  head_before?: string;
  commit_sha?: string;
  started_at?: string;
  completed_at?: string;
  session_id?: string;
  cost_usd?: number;
  tokens?: TokenUsage;
  summary?: string;
  commit_message?: string;
  notes_for_next_phase?: string;
  blockers?: string[];
}

interface RunRemote {
  host: string;
  owner: string;
  repo: string;
  type: 'github' | 'gitea' | 'other';
}

interface RunMeta {
  id: string;
  primary_repo_path: string;
  worktree_path: string;
  plan_folder: string;
  feature_branch: string;
  target_branch: string;
  remote?: RunRemote;
  status: RunStatus;
  total_cost_usd: number;
  bootstrapped?: boolean;
  phases: PhaseEntry[];
}

interface QueueEntry {
  run_id: string;
  added_at: string;
}

interface AppQueue {
  entries: QueueEntry[];
  paused: boolean;
}

interface AppConfig {
  max_retries: number;
  gitea_host?: string;
  target_branch?: string;
}

Export all interfaces. Also export DEFAULT_CONFIG: AppConfig = { max_retries: 1 }.

FILE: src/storage/config.ts

Manages ~/.config/cpe/config.json. Use os.homedir() from the 'os' module. Ensure parent
directories exist before writing (mkdir -p equivalent using fs.mkdirSync with { recursive: true }).
Write JSON with 2-space indent and a trailing newline.

Export:
- CONFIG_PATH: string (computed constant, not function)
- readConfig(): AppConfig — reads and parses the file; if absent returns DEFAULT_CONFIG (no throw)
- writeConfig(config: AppConfig): void

FILE: src/storage/queue.ts

Manages ~/.local/state/cpe/queue.json. Same dir-creation pattern.

Export:
- QUEUE_PATH: string
- readQueue(): AppQueue — if absent returns { entries: [], paused: false }
- writeQueue(queue: AppQueue): void
- enqueue(runId: string): void — reads queue, appends entry with added_at = new Date().toISOString(), writes queue
- dequeue(): string | null — reads queue, removes and returns first entry's run_id (FIFO), writes queue; returns null if empty
- removeFromQueue(runId: string): boolean — returns true if found and removed
- isQueuePaused(): boolean

FILE: src/storage/meta.ts

Manages ~/.local/state/cpe/runs/<run-id>/meta.json. The run directory is created on first write.

Export:
- getMetaPath(runId: string): string
- getLogsDir(runId: string): string
- readMeta(runId: string): RunMeta — throws if file not found (caller must handle)
- writeMeta(runId: string, meta: RunMeta): void — creates run dir if absent
- updateMeta(runId: string, partial: Partial<RunMeta>): RunMeta — read-modify-write; returns the updated meta
- updatePhase(runId: string, phaseNumber: number, partial: Partial<PhaseEntry>): RunMeta — updates a specific phase entry

FILE: src/storage/meta.test.ts

Tests — use a temp directory for all file I/O so tests don't touch real state dirs:
- 'STATE_TABLE covers all 10 states' — iterate the expected state names, assert each has a
  non-empty glyph, color (starts with #), and label in STATE_TABLE
- 'getStateInfo throws on unknown status' — expect getStateInfo('bad-status' as any) to throw
- 'readMeta / writeMeta round-trip' — write a minimal RunMeta to tmpdir, read it back, deep-equal
- 'updateMeta merges partial without clobbering other fields' — write a meta with total_cost_usd
  = 0, updateMeta with { total_cost_usd: 1.5 }, assert plan_folder is unchanged and cost is 1.5
- 'updatePhase updates the correct phase entry' — write a meta with 2 phases, updatePhase for
  phase 2, assert only phase 2 changed
- 'enqueue / dequeue FIFO ordering' — enqueue three run IDs, dequeue them, assert order preserved

To use a temp dir: before each test group, set the base paths by importing a test helper that
overrides the base directory. Alternatively, pass the base path as a parameter to readMeta /
writeMeta. Choose whichever approach keeps the production code cleanest — parameterised base path
is recommended.

VERIFY before committing:
1. bun test passes including all new tests in src/storage/meta.test.ts
2. bun run typecheck passes
3. STATE_TABLE has exactly 10 entries

After all criteria pass:
1. git add src/types/ src/storage/
2. git commit -m "feat: phase 03 — types, state taxonomy, storage layer"
3. git push -u origin feature/claude-plan-executor-phase-3
4. Create PR: gh pr create --base feature/claude-plan-executor --title "Phase 03: Types, state taxonomy, storage" --fill

Update docs/claude-plan-executor/PROGRESS.md on start and completion.

Your final message in this conversation must be a JSON object matching the schema you have been
given. Do all your work using tools first, then emit only the JSON as your closing message.
