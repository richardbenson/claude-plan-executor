# Phase 4: Single-Prompt Runner

## Summary

Implement the single-prompt execution logic that runs a single Claude session with the standardized template, handles completion, detects commits, and creates a PR.

## Context

Single prompts need a different execution path than multi-phase plans. Instead of a phase loop, single prompts execute in one session. We need to implement `runSinglePrompt()` that:

1. Injects user prompt into the template
2. Spawns a Claude session with the combined prompt
3. Tracks session progress (similar to phase execution)
4. Detects commit after completion
5. Pushes to remote
6. Creates PR
7. Updates metadata with completion status

## Files Expected to Change

- `src/runner/single-prompt.ts` - NEW: Single-prompt execution module
- `src/prompts/phase-result-schema.json` - May need extension for single-prompt result schema
- `src/prompts/index.ts` - Export single-prompt result schema if created

## Key Changes

### Single-Prompt Result Schema

Create or extend schema for single-prompt completion:
```json
{
  "type": "object",
  "required": ["completed", "committed", "summary", "pr_created"],
  "properties": {
    "completed": { "type": "boolean" },
    "committed": { "type": "boolean" },
    "commit_message": { "type": ["string", "null"] },
    "summary": { "type": "string" },
    "pr_created": { "type": "boolean" },
    "pr_url": { "type": ["string", "null"] },
    "blockers": { "type": "array", "items": { "type": "string" } }
  }
}
```

### Single-Prompt Runner Function

```typescript
export interface SinglePromptResult {
  completed: boolean;
  committed: boolean;
  commit_message: string | null;
  summary: string;
  pr_created: boolean;
  pr_url: string | null;
  blockers?: string[];
}

export async function runSinglePrompt(
  runId: string,
  appConfig: AppConfig,
  bus: ActivityBus
): Promise<SinglePromptResult>
```

Implementation steps:
1. Read metadata to get prompt and worktree path
2. Inject user prompt into template (replace `{{USER_PROMPT}}` placeholder)
3. Write combined prompt to temp file
4. Spawn Claude session with temp file as input
5. Start JSONL tail for activity feed
6. Await session completion
7. Parse structured output
8. Detect commit (check HEAD before/after)
9. Update metadata with completion status
10. Push to remote
11. Create PR using existing VCS integration
12. Update metadata with PR URL
13. Emit activity events

### Error Handling

Reuse existing error handling from `phase-loop.ts`:
- Rate limit detection and retry
- Transient error detection and retry
- Auth error detection and failure
- Phase failure detection and retry
- Invalid structured output detection and retry

## Edge Cases and Error Handling

- No commit made despite task completion → retry or fail
- Push fails → mark as failed
- PR creation fails → mark as failed
- Rate limited during execution → pause and resume
- No remote configured → skip PR, mark as complete
- Structured output missing → retry

## Acceptance Criteria

- [ ] `runSinglePrompt()` function implemented
- [ ] User prompt injected into template correctly
- [ ] Claude session spawned with combined prompt
- [ ] Activity events emitted during execution
- [ ] Commit detection works (HEAD before/after comparison)
- [ ] Push to remote works when remote configured
- [ ] PR creation works using existing VCS integration
- [ ] Metadata updated with completion status
- [ ] Metadata updated with PR URL
- [ ] Error handling covers rate limits, auth errors, transient errors
- [ ] Retry logic respects max_retries config
- [ ] Handles no remote case gracefully
- [ ] TypeScript compilation succeeds
