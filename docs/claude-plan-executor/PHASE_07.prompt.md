Read docs/claude-plan-executor/PHASE_07.md for full context before starting.

You are implementing phase 07 of the Claude Plan Executor (`cpe`) project. This phase builds the
typed internal event bus and the jsonl tail mechanism that produces live ActivityEvents from
Claude's session data stream.

Working directory: /home/ubuntu/Code/claude-plan-executor
Branch: feature/claude-plan-executor-phase-7 (create it off feature/claude-plan-executor)
PR target: feature/claude-plan-executor

Before writing anything, read:
- docs/000-claude-plan-executor-spec.md §7.3.3 (real-time session observability, jsonl path)
- docs/000-claude-plan-executor-spec.md §8.3 (jsonl confirmation, what the entries look like)
- docs/DESIGN.md §3 (activity feed kinds, glyphs, colors)
- src/runner/session.ts (session UUID usage, worktree paths)

FILE: src/events/types.ts

Define the ActivityEvent union type. Each variant extends ActivityEventBase:

interface ActivityEventBase {
  kind: ActivityEventKind;
  timestamp: Date;
  runId: string;
  phaseNumber: number;
}

type ActivityEventKind = 'phase' | 'edit' | 'bash' | 'commit' | 'ok' | 'pause' | 'error' | 'limit';

interface PhaseEvent extends ActivityEventBase {
  kind: 'phase';
  phaseName: string;
}

interface EditEvent extends ActivityEventBase {
  kind: 'edit';
  file: string;
  additions: number;
  deletions: number;
  inProgress: boolean;   // true while the tool call hasn't returned yet
  toolUseId: string;     // to match the toolUseResult later
}

interface BashEvent extends ActivityEventBase {
  kind: 'bash';
  command: string;
  result?: string;       // first 120 chars of stdout, set when toolUseResult arrives
  durationMs?: number;
  toolUseId: string;
}

interface CommitEvent extends ActivityEventBase {
  kind: 'commit';
  sha: string;
  message: string;
}

interface OkEvent extends ActivityEventBase {
  kind: 'ok';
  summary: string;
  costUsd: number;
}

interface PauseEvent extends ActivityEventBase {
  kind: 'pause';
}

interface ErrorEvent extends ActivityEventBase {
  kind: 'error';
  message: string;
}

interface LimitEvent extends ActivityEventBase {
  kind: 'limit';
  resumeAt: Date;
}

type ActivityEvent = PhaseEvent | EditEvent | BashEvent | CommitEvent | OkEvent | PauseEvent | ErrorEvent | LimitEvent;

Export all types and the ActivityEventKind union.

FILE: src/events/bus.ts

A minimal typed pub/sub singleton (do not extend Node EventEmitter — keep it simple and typed).

const RING_BUFFER_CAPACITY = 200;

class ActivityBus {
  private buffer: ActivityEvent[] = [];
  private subscribers: Set<(event: ActivityEvent) => void> = new Set();

  emit(event: ActivityEvent): void {
    // Add to ring buffer; drop oldest if at capacity
    if (this.buffer.length >= RING_BUFFER_CAPACITY) {
      this.buffer.shift();
    }
    this.buffer.push(event);
    // Notify all subscribers synchronously
    for (const sub of this.subscribers) {
      try { sub(event); } catch { /* subscriber errors must not crash the bus */ }
    }
  }

  subscribe(handler: (event: ActivityEvent) => void): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  getBuffer(): readonly ActivityEvent[] {
    return this.buffer;
  }

  clear(): void {
    this.buffer = [];
  }
}

Export:
- ActivityBus class
- activityBus: ActivityBus — singleton instance (module-level const)

Now update src/runner/limit.ts from Phase 06: change the bus parameter type from
{ emit: (event: unknown) => void } to ActivityBus (import from src/events/bus.ts) and emit a
proper LimitEvent instead of the placeholder.

FILE: src/runner/jsonl-tail.ts

The jsonl file path is pre-computed from the session UUID and worktree path. Spec §7.3.3:
path = ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl
where encoded-cwd replaces every '/' with '-' in the worktree path.

Export:
- encodeWorktreePath(worktreePath: string): string
  Replaces all '/' with '-', then strips any leading '-'.
  Example: '/home/ubuntu/.local/state/cpe/worktrees/01JXYZ/'
  → 'home-ubuntu-.local-state-cpe-worktrees-01JXYZ-' (trailing dash retained)
  The spec notes this encoding is unverified for worktree paths — the glob fallback handles
  mismatches.

- getExpectedJsonlPath(uuid: string, worktreePath: string): string
  Returns path.join(os.homedir(), '.claude', 'projects', encodeWorktreePath(worktreePath),
  uuid + '.jsonl')

- findJsonlByUuid(uuid: string): Promise<string | null>
  Globs ~/.claude/projects/**/<uuid>.jsonl using Bun's glob API (Bun.Glob).
  Returns the first match or null if not found after 3 seconds (poll every 500ms).

- startJsonlTail(
    uuid: string,
    worktreePath: string,
    runId: string,
    phaseNumber: number,
    bus: ActivityBus
  ): Promise<() => void>
  Returns a stop() function.

  Implementation:
  1. Try the expected path first. If file doesn't exist within 3 seconds (poll every 200ms),
     call findJsonlByUuid(uuid). If still not found after 10 seconds total, log a warning to
     stderr and return a no-op stop function.
  2. Track a byte offset (start at 0). Watch the file using fs.watch.
  3. On each fs.watch event ('change'), read from offset to EOF. Split on newlines. Parse each
     complete line as JSON. Advance offset.
  4. For each parsed line call classifyJsonlEntry(entry, runId, phaseNumber, pendingEdits).
     Pass a mutable pendingEdits Map<string, EditEvent> to correlate tool_use with toolUseResult.
  5. If classifyJsonlEntry returns an ActivityEvent, emit it on the bus.
  6. Return () => { watcher.close(); }

- classifyJsonlEntry(
    entry: unknown,
    runId: string,
    phaseNumber: number,
    pendingEdits: Map<string, EditEvent | BashEvent>
  ): ActivityEvent | null

  A jsonl entry is a JSON object. The relevant shapes (from spec §7.3.3 and §8.3):

  Tool use (Claude calling a tool):
    entry.type === 'assistant' AND entry.message.content is an array containing an item
    where item.type === 'tool_use'.
    For each tool_use item:
    - name in ['Edit', 'Write'] → emit EditEvent with inProgress: true, toolUseId: item.id,
      file: item.input?.file_path ?? item.input?.path ?? '<unknown>',
      additions: 0, deletions: 0 (we can't compute diffs from the jsonl alone)
      Store in pendingEdits map keyed by item.id.
    - name === 'Bash' → emit BashEvent with inProgress: true (actually Bash doesn't have
      inProgress, but set command: item.input?.command ?? '<bash>')
      Store in pendingEdits map.

  Tool result (the result of a tool call returning):
    entry.type === 'tool' AND entry.content is an array with type === 'tool_result' items.
    Look up pendingEdits by toolUseId. If found:
    - If it was an EditEvent: emit a new EditEvent with inProgress: false (same data, updated)
    - If it was a BashEvent: emit a new BashEvent with result = first 120 chars of the content,
      remove from pendingEdits

  Rate-limit error in jsonl (spec §8.3):
    entry.isApiErrorMessage === true AND entry.apiErrorStatus === 429 → emit LimitEvent.

  Return null for any entry that doesn't match the above patterns.

Unit test: src/runner/jsonl-tail.test.ts

Test classifyJsonlEntry with fixture data (no real fs.watch needed):
- A tool_use entry with name 'Edit' → returns EditEvent with inProgress: true
- A tool_use entry with name 'Bash' → returns BashEvent
- A tool_result entry matching a pending EditEvent → returns EditEvent with inProgress: false
- An unrecognised entry → returns null
- A rate-limit entry (isApiErrorMessage: true, apiErrorStatus: 429) → returns LimitEvent

Test encodeWorktreePath:
- '/home/ubuntu/Code/x' → 'home-ubuntu-Code-x'
- '/home/ubuntu/.local/state/cpe/worktrees/01JXYZ/' → 'home-ubuntu-.local-state-cpe-worktrees-01JXYZ-'

VERIFY before committing:
1. bun test passes (all tests including new jsonl-tail.test.ts)
2. bun run typecheck passes
3. activityBus.getBuffer() starts as an empty array
4. Ring buffer drops the oldest entry when capacity is exceeded (easy to test in a unit test —
   add one to src/events/bus.test.ts)

After all criteria pass:
1. git add src/events/ src/runner/jsonl-tail.ts src/runner/jsonl-tail.test.ts
   src/events/bus.test.ts (create it) src/runner/limit.ts (updated)
2. git commit -m "feat: phase 07 — live observability and event bus"
3. git push -u origin feature/claude-plan-executor-phase-7
4. Create PR targeting feature/claude-plan-executor

Update docs/claude-plan-executor/PROGRESS.md on start and completion.

Your final message in this conversation must be a JSON object matching the schema you have been
given. Do all your work using tools first, then emit only the JSON as your closing message.
