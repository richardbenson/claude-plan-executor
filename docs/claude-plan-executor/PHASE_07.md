# Phase 07 — Live Observability + Event Bus

## Summary

Build the internal typed event bus and the jsonl tail mechanism that converts per-session jsonl
entries into ActivityEvents in real time. The TUI subscribes to this bus in later phases.

## Context

### ActivityEvent types (src/events/types.ts)
Typed events emitted on the bus. Each corresponds to a row kind in the Watch mode activity feed
(see `docs/DESIGN.md §3`):

```typescript
type ActivityEventKind = 'phase' | 'edit' | 'bash' | 'commit' | 'ok' | 'pause' | 'error' | 'limit';

interface ActivityEventBase {
  kind: ActivityEventKind;
  timestamp: Date;
  runId: string;
  phaseNumber: number;
}

interface PhaseEvent extends ActivityEventBase { kind: 'phase'; phaseName: string; }
interface EditEvent extends ActivityEventBase { kind: 'edit'; file: string; additions: number; deletions: number; inProgress: boolean; }
interface BashEvent extends ActivityEventBase { kind: 'bash'; command: string; result?: string; durationMs?: number; }
interface CommitEvent extends ActivityEventBase { kind: 'commit'; sha: string; message: string; }
interface OkEvent extends ActivityEventBase { kind: 'ok'; summary: string; costUsd: number; }
interface PauseEvent extends ActivityEventBase { kind: 'pause'; }
interface ErrorEvent extends ActivityEventBase { kind: 'error'; message: string; }
interface LimitEvent extends ActivityEventBase { kind: 'limit'; resumeAt: Date; }

type ActivityEvent = PhaseEvent | EditEvent | BashEvent | CommitEvent | OkEvent | PauseEvent | ErrorEvent | LimitEvent;
```

### Event bus (src/events/bus.ts)
A simple typed event emitter (do not use Node's EventEmitter — it lacks type safety). Implement
a minimal typed pub/sub:
- `subscribe(handler: (event: ActivityEvent) => void): () => void` — returns unsubscribe function
- `emit(event: ActivityEvent): void` — calls all subscribers synchronously
- `getBuffer(): readonly ActivityEvent[]` — returns the in-memory ring buffer (last 200 events)
- The module exports a singleton `activityBus` instance (one per process)

Ring buffer: maintain a fixed-size array (capacity 200). On overflow, drop the oldest entry. The
TUI reads this buffer on mount to show recent history, then subscribes for updates.

### jsonl tail (src/runner/jsonl-tail.ts)
Pre-allocated session UUIDs (set before spawning Claude) let us know the jsonl path in advance:

```
~/.claude/projects/<encoded-cwd>/<uuid>.jsonl
```

where `<encoded-cwd>` is the worktree path with `/` replaced by `-` and any leading `-` stripped
(verified format from probe-claude-data). Example:
`/home/ubuntu/.local/state/cpe/worktrees/01JXYZ/`
→ `-home-ubuntu-.local-state-cpe-worktrees-01JXYZ-`
→ `home-ubuntu-.local-state-cpe-worktrees-01JXYZ-` (leading dash stripped? verify: probe said
slashes → dashes, no mention of stripping. Use the raw replacement first; add fallback if needed.)

The spec notes the encoding is open for worktree paths specifically (§11) — implement the basic
replacement and add a `findJsonlByUuid(uuid)` glob fallback:
1. Try the computed path first
2. If file doesn't appear within 3 seconds, glob `~/.claude/projects/**/<uuid>.jsonl`
3. Log which path was used so we can fix the encoding if it's wrong

`startJsonlTail(uuid, worktreePath, runId, phaseNumber, bus)`:
1. Compute the expected jsonl path (or find via glob)
2. Wait for the file to appear (poll every 200ms, timeout 10s)
3. Track last byte offset; on each `fs.watch` event, read new bytes, split on newlines,
   parse each line as JSON
4. For each parsed jsonl entry, classify into an ActivityEvent and emit on the bus:
   - Entry with `message.content[].type === 'tool_use'` and `name === 'Edit' | 'Write'`
     → `EditEvent` (inProgress: true)
   - Entry with `message.content[].type === 'tool_use'` and `name === 'Bash'`
     → `BashEvent`
   - `toolUseResult` arriving for a prior Edit/Write → update the matched EditEvent as complete
     (inProgress: false), emit new event
   - Phase start/end and commit events are emitted by the phase loop (Phase 08), not here
5. Return a `stop()` function that removes the fs.watch listener

## Files Expected to Change

- `src/events/types.ts` — created
- `src/events/bus.ts` — created
- `src/runner/jsonl-tail.ts` — created

## Acceptance Criteria

1. `tsc --noEmit` passes
2. The event bus ring buffer drops the oldest entry when capacity (200) is exceeded
3. `subscribe` returns an unsubscribe function that, when called, stops the handler being invoked
4. `startJsonlTail` correctly parses a fixture jsonl file and emits the right event types
   (write one unit test with a fake jsonl file containing a tool_use entry for Edit and Bash)
5. The glob fallback is implemented (even if untested — the real jsonl path test requires a live
   Claude session)

## Dependencies

Phase 06 (session UUIDs available; worktree paths defined by storage layer).
