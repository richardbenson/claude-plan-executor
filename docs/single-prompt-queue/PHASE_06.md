# Phase 6: TUI QueuePane Updates

## Summary

Update the QueuePane component to display single-prompt entries distinctly from plan entries, adding visual differentiation and appropriate information for each type.

## Context

The QueuePane currently displays all entries the same way, assuming they're all plan-based with phases. We need to:
- Add visual distinction for single-prompt entries (e.g., "★" prefix, different color)
- Show prompt source indicator for single-prompt entries
- Hide phase count for single-prompt entries (they're single shot)
- Display plan folder name for plan entries
- Maintain compact layout

## Files Expected to Change

- `src/tui/components/QueuePane.tsx` - Update display logic for entry type differentiation

## Key Changes

### Entry Type Detection

Add logic to detect single-prompt vs plan:
```typescript
const isSinglePrompt = !run.plan_folder && run.prompt;
```

### Visual Differentiation

- For single-prompt entries:
  - Use "★" prefix instead of folder name
  - Display prompt source indicator (e.g., "GH" for GitHub, "TXT" for free text)
  - Skip phase count display
  - Use different color for source indicator

- For plan entries:
  - Keep existing display (repo name, folder name, phase count)
  - No changes to existing behavior

### Layout Adjustments

- Keep the same 4-row layout per entry
- Row 1: repo name (both types)
- Row 2: folder name (plan) or prompt source (single-prompt)
- Row 3: status chip + phase count (plan) or status only (single-prompt)
- Row 4: progress bar (both types if executing)

### Color Usage

Follow DESIGN.md color tokens:
- Use existing colors for consistency
- Maybe use `cyan` or `magenta` for single-prompt distinction
- Keep `green` for complete status

## Edge Cases and Error Handling

- Entry has neither plan_folder nor prompt → display as plan (backward compatibility)
- Very long prompt → truncate display
- Missing prompt_source → default to "TXT"
- Missing github_issue_number → don't display issue number

## Acceptance Criteria

- [ ] Single-prompt entries display with "★" prefix
- [ ] Plan entries display folder name as before
- [ ] Single-prompt entries show prompt source indicator
- [ ] Single-prompt entries don't show phase count
- [ ] Plan entries show phase count as before
- [ ] Status chip displays correctly for both types
- [ ] Progress bar displays for executing entries of both types
- [ ] Colors follow DESIGN.md guidelines
- [ ] Layout remains compact and consistent
- [ ] Backward compatibility maintained for plan entries
- [ ] TypeScript compilation succeeds
