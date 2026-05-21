# Phase 1: Type System and Data Model Extensions

## Summary

Extend the type system to support single-prompt queue entries as a distinct type from plan-based entries. This phase focuses on data model changes only, with no UI or execution logic.

## Context

Currently, `QueueEntry` has no type field and all entries are assumed to be plan-based. `RunMeta` requires `plan_folder` and `phases` fields, which doesn't make sense for single-prompt runs. We need to:

1. Add a `type` field to distinguish entry types
2. Make plan-specific fields optional in `RunMeta`
3. Add single-prompt-specific fields to `RunMeta`
4. Ensure backward compatibility with existing data

## Files Expected to Change

- `src/types/meta.ts` - Extend interfaces
- `src/storage/queue.ts` - Update queue handling to respect type field
- `src/storage/meta.ts` - Update metadata functions to handle optional fields

## Key Changes

### QueueEntry Extension
```typescript
export interface QueueEntry {
  run_id: string;
  added_at: string;
  type: 'plan' | 'single-prompt'; // NEW
}
```

### RunMeta Extension
```typescript
export interface RunMeta {
  id: string;
  primary_repo_path: string;
  worktree_path: string;
  plan_folder?: string; // Was required, now optional
  feature_branch: string;
  target_branch: string;
  remote?: RunRemote;
  status: RunStatus;
  total_cost_usd: number;
  bootstrapped?: boolean;
  sandboxed?: boolean;
  claude_pid?: number;
  phases?: PhaseEntry[]; // Was required, now optional

  // Single-prompt specific fields (NEW)
  prompt?: string;
  prompt_source?: 'free-text' | 'github-issue' | 'clipboard';
  github_issue_number?: number;
}
```

### Backward Compatibility
- Default `type` to `'plan'` when reading existing queue entries without the field
- Default `plan_folder` and `phases` to empty values when missing for safety
- All existing code should continue to work with the extended types

## Edge Cases and Error Handling

- Reading old queue entries without `type` field → default to `'plan'`
- Reading old metadata without single-prompt fields → handle gracefully
- Validation should allow both plan and single-prompt shapes
- Queue operations should preserve type field

## Acceptance Criteria

- [ ] `QueueEntry` has `type` field with union type
- [ ] `RunMeta` has optional `plan_folder` and `phases` fields
- [ ] `RunMeta` has new single-prompt specific fields
- [ ] `readQueue()` defaults missing `type` to `'plan'` for backward compatibility
- [ ] `readMeta()` handles missing optional fields gracefully
- [ ] Existing tests pass (if any)
- [ ] TypeScript compilation succeeds
