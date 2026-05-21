# Phase 7: TUI Detail View Updates

## Summary

Update the TUI to show a detail view when a single-prompt entry is selected in the queue, instead of the phases list. The detail view should show prompt information, source, status, commit info, and PR URL.

## Context

Currently, selecting an entry in the queue (left column) shows phases in the center column. For single-prompt entries, there are no phases, so we need a different view. When a single-prompt is selected, the center column should show:
- Prompt text (truncated if long)
- Prompt source
- Status
- Commit SHA (if committed)
- PR URL (if created)
- Execution details (cost, tokens, etc.)

## Files Expected to Change

- `src/tui/components/PhasesPane.tsx` - Detect single-prompt and render detail view instead of phases
- `src/tui/Manage.tsx` - May need updates to handle single-prompt selection state

## Key Changes

### Single-Prompt Detection

Add logic to detect when selected run is a single-prompt:
```typescript
const isSinglePrompt = selectedRun && !selectedRun.plan_folder && selectedRun.prompt;
```

### Detail View Component

Create or reuse UI for single-prompt detail view:
- Prompt text (multiline, truncated)
- Prompt source with icon/label
- Status with StateChip
- Commit SHA (if available)
- PR URL (if available)
- Cost and token usage
- Execution time

### Conditional Rendering

In PhasesPane:
- If single-prompt selected → render detail view
- If plan selected → render existing phases list

### Layout

- Similar width to existing phases pane
- Use Box with flexDirection="column"
- Each piece of information on its own row
- Use colors from theme for labels and values

## Edge Cases and Error Handling

- Selected run is null → show empty state
- Selected run has neither type → show empty state or treat as plan
- Very long prompt → truncate with ellipsis
- Missing commit or PR → don't display those rows
- Missing cost/tokens → don't display those rows

## Acceptance Criteria

- [ ] Single-prompt selection detected correctly
- [ ] Detail view renders when single-prompt selected
- [ ] Detail view shows prompt text
- [ ] Detail view shows prompt source
- [ ] Detail view shows status with StateChip
- [ ] Detail view shows commit SHA when available
- [ ] Detail view shows PR URL when available
- [ ] Detail view shows cost and tokens when available
- [ ] Phases list still shows when plan selected
- [ ] Layout fits within pane width
- [ ] Colors match theme
- [ ] Selection state works correctly
- [ ] TypeScript compilation succeeds
