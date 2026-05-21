Read PHASE_07.md for full context on this phase.

## Your Task

Update the TUI to show a detail view when a single-prompt entry is selected in the queue, instead of the phases list.

## Files to Modify

1. **src/tui/components/PhasesPane.tsx** - Add single-prompt detail view:

   a) Add helper function to detect single-prompt:
      ```typescript
      const isSinglePrompt = (run: RunMeta | null): boolean => {
        return run !== null && !run.plan_folder && !!run.prompt;
      };
      ```

   b) Add helper function to format source label:
      ```typescript
      const formatSource = (source?: string): string => {
        if (!source) return 'Unknown';
        switch (source) {
          case 'github-issue': return 'GitHub Issue';
          case 'clipboard': return 'Clipboard';
          case 'free-text':
          default: return 'Free Text';
        }
      };
      ```

   c) Add helper function to truncate prompt text:
      ```typescript
      const truncatePrompt = (prompt: string, maxLines: number = 4): string => {
        const lines = prompt.split('\n');
        if (lines.length <= maxLines) return prompt;
        return lines.slice(0, maxLines).join('\n') + '…';
      };
      ```

   d) In the main render, add conditional logic:
      - If `isSinglePrompt(selectedRun)` → render detail view
      - Else → render existing phases list

   e) Create the detail view component:
      ```tsx
      if (isSinglePrompt(selectedRun)) {
        return (
          <Box flexDirection="column" borderStyle="round" borderColor={focused ? cyan : border} width={40}>
            <Text color={focused ? cyan : dim}>{'DETAIL'}</Text>
            <Text>{'Source: ' + formatSource(selectedRun.prompt_source)}</Text>
            <Text>{'Status: '}</Text><StateChip status={selectedRun.status} showLabel={true} />
            {selectedRun.prompt && (
              <Box flexDirection="column" marginTop={1}>
                <Text color={dim}>{'Prompt:'}</Text>
                <Text>{truncatePrompt(selectedRun.prompt, 6)}</Text>
              </Box>
            )}
            {/* Add more rows for commit, PR, cost, etc. */}
          </Box>
        );
      }
      ```

   f) Add rows for:
      - Commit SHA (if commit info available in metadata)
      - PR URL (if pr_created or status is 'pr-created')
      - Cost USD (if total_cost_usd available)
      - Token usage (if tokens available)
      - Execution time (calculate from started_at/completed_at if available)

   g) Use appropriate colors from theme:
      - Use `dim` for labels
      - Use `fg` for values
      - Use existing StateChip for status
      - Use `green2` for commit SHAs and PR URLs

2. **src/tui/Manage.tsx** - Check if updates needed:
   - Review how selected run is passed to PhasesPane
   - Ensure single-prompt selection works correctly
   - May need to update state management if single-prompt selection isn't handled

## Code Patterns to Follow

- Follow existing PhasesPane component structure
- Use the same Box and Text components
- Use colors from the existing theme
- Maintain the same border style and focused state
- Use existing StateChip component
- Keep the same width pattern (40 chars for phases pane)
- Use the same selection highlighting pattern

## UI Design Guidelines

- Keep the detail view compact but informative
- Use consistent spacing (marginTop on sections)
- Truncate long prompts to avoid overflow
- Use color to distinguish labels from values
- Show "—" or similar for missing values
- Keep the same border style as phases pane

## Edge Cases and Error Handling

- Selected run is null → render empty state or "No selection" message
- Selected run has neither plan_folder nor prompt → treat as plan (show phases or empty state)
- Very long prompt → truncate with ellipsis after N lines
- Missing commit SHA → don't show that row or show "—"
- Missing PR URL → don't show that row or show "—"
- Missing cost/tokens → don't show those rows
- Single-prompt not started yet → show status as "queued" or similar

## Acceptance Criteria

- [ ] Helper function `isSinglePrompt()` implemented correctly
- [ ] Helper function `formatSource()` implemented correctly
- [ ] Helper function `truncatePrompt()` implemented correctly
- [ ] Detail view renders when single-prompt selected
- [ ] Detail view shows prompt source label
- [ ] Detail view shows status with StateChip
- [ ] Detail view shows prompt text (truncated)
- [ ] Detail view shows commit SHA when available
- [ ] Detail view shows PR URL when available
- [ ] Detail view shows cost when available
- [ ] Detail view shows token usage when available
- [ ] Detail view handles missing values gracefully
- [ ] Phases list still renders when plan selected
- [ ] Empty state renders when no selection
- [ ] Border and focused state work correctly
- [ ] Colors match existing theme
- [ ] Layout fits within pane width (no overflow)
- [ ] TypeScript compilation succeeds

## References

- See existing PhasesPane implementation in `src/tui/components/PhasesPane.tsx`
- See theme colors in `src/tui/theme.ts`
- See StateChip component in `src/tui/components/StateChip.tsx`
- See Manage component in `src/tui/Manage.tsx` for selection state

## After Completion

Update PROGRESS.md to mark Phase 7 as complete with date completed.
