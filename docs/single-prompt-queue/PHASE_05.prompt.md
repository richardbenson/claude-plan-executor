Read PHASE_05.md for full context on this phase.

## Your Task

Update the queue processor to route queue entries to the appropriate execution path based on their type (plan vs single-prompt).

## Files to Modify

1. **src/commands/start.ts** - Update queue processor:

   a) Add import:
      - Import `runSinglePrompt` from `../runner/single-prompt.js`

   b) In `runQueueProcessor()` function, after reading metadata:
      - Detect entry type:
        ```typescript
        const isSinglePrompt = !meta.plan_folder && meta.prompt;
        ```

   c) Route to appropriate execution path:
      - Replace the existing phase loop with conditional routing:
        ```typescript
        if (isSinglePrompt) {
          // Single-prompt execution
          let result;
          try {
            result = await runSinglePrompt(runId, config, bus);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[queue] single-prompt failed for ${runId.slice(0, 8)}: ${msg}\n`);
            updateMeta(runId, { status: 'failed' });
            bus.emit({ kind: 'error', timestamp: new Date(), runId, phaseNumber: -1, message: 'single-prompt: ' + msg });
            continue; // Move to next queue entry
          }
        } else {
          // Existing plan-based execution (keep as-is)
          const pendingPhases = meta.phases.filter(p => p.status !== 'complete');
          for (const phase of pendingPhases) {
            // ... existing phase execution logic
          }
          // ... existing finalise logic
        }
        ```

   d) Maintain pause behavior for plan entries only:
      - Keep the existing pause check before phase execution
      - Single-prompt execution doesn't need pause check (single shot)

   e) Maintain error handling for both paths:
      - Plan errors: existing error handling
      - Single-prompt errors: wrap in try-catch, mark failed, emit error, continue

   f) Keep all other logic unchanged:
      - Worktree reconciliation
      - Status updates
      - Activity events
      - Loop structure

## Code Patterns to Follow

- Follow existing error handling pattern in the file
- Use the same metadata update pattern
- Use the same activity event emission pattern
- Maintain existing pause/resume logic for plan entries
- Keep the overall loop structure unchanged
- Use the same logging pattern (process.stderr.write)

## Edge Cases and Error Handling

- Metadata missing both plan_folder and prompt → treat as plan (backward compatibility)
- Single-prompt execution fails → mark failed, emit error, continue to next entry
- Plan execution fails → existing behavior (mark failed, emit error, continue)
- runSinglePrompt throws error → catch and handle, don't crash queue processor
- runSinglePrompt returns pause outcome → not expected, but handle as error if it happens

## Acceptance Criteria

- [ ] `runSinglePrompt` imported from `../runner/single-prompt.js`
- [ ] Entry type detection works (`!meta.plan_folder && meta.prompt`)
- [ ] Plan entries route to existing phase loop (unchanged behavior)
- [ ] Single-prompt entries route to runSinglePrompt
- [ ] Pause behavior maintained for plan entries (unchanged)
- [ ] Single-prompt execution wrapped in try-catch
- [ ] Single-prompt failures mark metadata as 'failed'
- [ ] Single-prompt failures emit error events
- [ ] Queue processor continues to next entry after single-prompt failure
- [ ] Plan failures still handled as before
- [ ] Worktree reconciliation still runs for both types
- [ ] TypeScript compilation succeeds
- [ ] Existing plan queue entries still process correctly

## References

- See existing queue processor logic in `src/commands/start.ts`
- See `runSinglePrompt` from Phase 4 in `src/runner/single-prompt.ts`
- See existing error handling pattern in the file

## After Completion

Update PROGRESS.md to mark Phase 5 as complete with date completed.
