Read PHASE_01.md for full context on this phase.

## Your Task

Extend the type system and data model to support single-prompt queue entries as a distinct type from plan-based entries. This phase is data model changes only - no UI or execution logic.

## Files to Modify

1. **src/types/meta.ts** - Extend interfaces:
   - Add `type: 'plan' | 'single-prompt'` field to `QueueEntry`
   - Make `plan_folder` optional in `RunMeta` (change `plan_folder: string` to `plan_folder?: string`)
   - Make `phases` optional in `RunMeta` (change `phases: PhaseEntry[]` to `phases?: PhaseEntry[]`)
   - Add single-prompt specific fields to `RunMeta`:
     - `prompt?: string`
     - `prompt_source?: 'free-text' | 'github-issue' | 'clipboard'`
     - `github_issue_number?: number`

2. **src/storage/queue.ts** - Update queue handling:
   - Modify `readQueue()` to default missing `type` field to `'plan'` for backward compatibility
   - Ensure all queue operations (`enqueue`, `enqueueFront`, `dequeue`, `removeFromQueue`) preserve the `type` field
   - No other logic changes needed

3. **src/storage/meta.ts** - Update metadata functions:
   - Review `readMeta()` and `writeMeta()` functions
   - Ensure they handle optional `plan_folder`, `phases`, and new single-prompt fields gracefully
   - Add validation if needed to ensure metadata is valid for both plan and single-prompt shapes
   - No other logic changes needed

## Code Patterns to Follow

- Follow existing TypeScript patterns in the codebase
- Use optional fields (`?:`) for backward compatibility
- Provide sensible defaults when reading legacy data
- Maintain existing function signatures where possible
- Keep changes minimal and focused on type extensions only

## Edge Cases and Error Handling

- When `readQueue()` encounters entries without `type` field, default to `'plan'`
- When `readMeta()` encounters entries without `plan_folder` or `phases`, handle gracefully (they should be optional now)
- Ensure TypeScript compilation succeeds with the new types
- Ensure existing code that expects these fields still compiles (use optional chaining where needed)

## Acceptance Criteria

- [ ] `QueueEntry` interface has `type: 'plan' | 'single-prompt'` field
- [ ] `RunMeta.plan_folder` is optional (`plan_folder?: string`)
- [ ] `RunMeta.phases` is optional (`phases?: PhaseEntry[]`)
- [ ] `RunMeta` has new fields: `prompt?`, `prompt_source?`, `github_issue_number?`
- [ ] `readQueue()` defaults missing `type` to `'plan'` for backward compatibility
- [ ] All queue operations preserve the `type` field
- [ ] `readMeta()` handles missing optional fields gracefully
- [ ] TypeScript compilation succeeds with no errors
- [ ] Existing code continues to work (check by reading existing usages)

## References

- See current `QueueEntry` definition in `src/types/meta.ts` lines 58-61
- See current `RunMeta` definition in `src/types/meta.ts` lines 42-56
- See current queue implementation in `src/storage/queue.ts`
- See current metadata implementation in `src/storage/meta.ts`

## After Completion

Update PROGRESS.md to mark Phase 1 as complete with date completed.
