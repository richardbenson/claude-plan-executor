# Phase 5: Queue Processor Integration

## Summary

Update the queue processor to route queue entries to the appropriate execution path based on their type (plan vs single-prompt).

## Context

The queue processor currently assumes all entries are plan-based and runs them through the phase loop. We need to detect entry type and route to the appropriate execution path:
- Plan entries → existing phase loop (runPhase, resumeOrRestart)
- Single-prompt entries → new single-prompt runner (runSinglePrompt)

## Files Expected to Change

- `src/commands/start.ts` - Update queue processor loop to route by type

## Key Changes

### Queue Processor Logic

Update the `runQueueProcessor()` function to:

1. After dequeuing and reading metadata, detect entry type:
   ```typescript
   const isSinglePrompt = !meta.plan_folder && meta.prompt;
   ```

2. Route to appropriate execution path:
   ```typescript
   if (isSinglePrompt) {
     await runSinglePrompt(runId, config, bus);
   } else {
     // Existing phase loop logic
     const pendingPhases = meta.phases.filter(p => p.status !== 'complete');
     for (const phase of pendingPhases) {
       // ... existing phase execution logic
     }
     // ... existing finalise logic
   }
   ```

3. Maintain pause/resume behavior for both types:
   - Check pause before starting execution
   - Re-enqueue at front if paused during execution
   - Emit pause events

4. Handle completion for both types:
   - Plans: existing finalise step
   - Single-prompt: PR creation handled within runSinglePrompt

### Error Handling

- Handle failures from both execution paths
- Update metadata status to 'failed' on error
- Emit error events for both types
- Continue to next queue entry regardless of failure

## Edge Cases and Error Handling

- Metadata missing both plan_folder and prompt → treat as plan (backward compatibility)
- Single-prompt execution fails → mark failed, emit error, continue
- Plan execution fails → existing behavior (mark failed, emit error, continue)
- Pause during single-prompt execution → not supported (single shot), skip pause check for single-prompt

## Acceptance Criteria

- [ ] Queue processor detects entry type correctly
- [ ] Plan entries route to existing phase loop
- [ ] Single-prompt entries route to runSinglePrompt
- [ ] Pause behavior maintained for plan entries
- [ ] Error handling works for both types
- [ ] Metadata status updates correctly for both types
- [ ] Activity events emitted for both types
- [ ] Queue continues processing after failures
- [ ] Backward compatibility maintained for existing plan entries
- [ ] TypeScript compilation succeeds
