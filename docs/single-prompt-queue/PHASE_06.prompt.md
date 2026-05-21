Read PHASE_06.md for full context on this phase.

## Your Task

Update the QueuePane component to display single-prompt entries distinctly from plan entries, adding visual differentiation and appropriate information for each type.

## Files to Modify

1. **src/tui/components/QueuePane.tsx** - Update display logic:

   a) Add helper function to detect entry type:
      ```typescript
      const isSinglePrompt = (run: RunMeta): boolean => {
        return !run.plan_folder && !!run.prompt;
      };
      ```

   b) Add helper function to get source label:
      ```typescript
      const getSourceLabel = (run: RunMeta): string => {
        if (!isSinglePrompt(run)) return '';
        switch (run.prompt_source) {
          case 'github-issue': return 'GH';
          case 'clipboard': return 'CLIP';
          case 'free-text':
          default: return 'TXT';
        }
      };
      ```

   c) Update the map function in the render to handle both types:
      - For each run, detect if single-prompt
      - Conditionally render row 2:
        - Plan: `{'  /' + run.plan_folder.slice(0, 10)}`
        - Single-prompt: `{'  ' + getSourceLabel(run)}`
      - Conditionally render row 3:
        - Plan: status chip + phase count
        - Single-prompt: status chip only (no phase count)
      - Add "★" prefix for single-prompt in row 1 if desired

   d) Update the progress bar logic:
      - Should work for both types (single-prompt is always 100% when executing)
      - For single-prompt: show full bar when executing
      - For plan: existing phase-based progress

   e) Optional: Add color distinction:
      - Use a different color for single-prompt source label
      - Consider using `magenta` or `cyan` for distinction
      - Import from existing theme

## Code Patterns to Follow

- Keep the existing component structure
- Use existing Box and Text components
- Follow existing color usage from theme
- Maintain the 4-row layout per entry
- Use existing StateChip component
- Keep selection highlighting logic unchanged

## UI Design Guidelines

- Maintain the same card width (16 chars)
- Keep text truncation (slice(0, N)) for long strings
- Use colors from the existing theme (see `src/tui/theme.ts`)
- Keep alignment consistent with existing entries
- Don't break the visual rhythm of the queue list

## Edge Cases and Error Handling

- Entry has neither plan_folder nor prompt → treat as plan (display folder name if available, fallback to safe display)
- Very long prompt source → truncate appropriately
- Missing prompt_source → default to "TXT"
- Single-prompt with github_issue_number → could display issue number alongside source label (optional enhancement)
- Selection highlighting should work for both types

## Acceptance Criteria

- [ ] Helper function `isSinglePrompt()` implemented correctly
- [ ] Helper function `getSourceLabel()` implemented correctly
- [ ] Single-prompt entries display with visual distinction (e.g., "★" prefix or source label)
- [ ] Plan entries display folder name as before
- [ ] Single-prompt entries show prompt source indicator (GH/TXT/CLIP)
- [ ] Single-prompt entries don't show phase count in row 3
- [ ] Plan entries show phase count as before
- [ ] Status chip displays correctly for both types
- [ ] Progress bar displays for executing entries of both types
- [ ] Selection highlighting works for both types
- [ ] Layout remains 4 rows per entry
- [ ] Colors match existing theme
- [ ] No layout overflow
- [ ] Backward compatibility maintained for plan entries
- [ ] TypeScript compilation succeeds

## References

- See existing QueuePane implementation in `src/tui/components/QueuePane.tsx`
- See theme colors in `src/tui/theme.ts`
- See StateChip component in `src/tui/components/StateChip.tsx`
- See DESIGN.md for color guidelines

## After Completion

Update PROGRESS.md to mark Phase 6 as complete with date completed.
