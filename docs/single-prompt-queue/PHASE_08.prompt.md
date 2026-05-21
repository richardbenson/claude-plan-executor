Read PHASE_08.md for full context on this phase.

## Your Task

Test the complete single-prompt queue feature end-to-end, fix any bugs discovered during testing, refine the template, and ensure all phases integrate correctly.

## Testing Approach

1. **Build the project**:
   - Run `bun run build` (or equivalent build command)
   - Ensure TypeScript compilation succeeds
   - Fix any compilation errors

2. **Test QueueWizard flow**:
   - Run `cpe start` to launch TUI
   - Press appropriate key to open QueueWizard
   - Select "Single Prompt"
   - Test each prompt source:
     - Free text: enter a simple task (e.g., "Add a comment to the README")
     - GitHub issue: select an issue from the list
   - Verify confirmation screen shows prompt preview
   - Confirm queue creation
   - Verify entry appears in queue with correct display

3. **Test execution**:
   - Let the queue processor pick up the single-prompt entry
   - Watch the activity feed for session progress
   - Verify commit is created
   - Verify PR is created (if remote configured)
   - Verify status updates to 'pr-created' or 'complete'

4. **Test TUI display**:
   - Verify single-prompt entry shows with visual distinction
   - Verify detail view shows when single-prompt selected
   - Verify detail view shows correct information
   - Verify phases list still works for plan entries

5. **Test edge cases**:
   - Empty prompt (should show validation error)
   - Very long prompt (should truncate correctly)
   - No remote configured (should skip PR, mark complete)
   - GitHub issues list empty (should show message)
   - GitHub API auth failure (should show error)

## Bug Fix Process

For each bug discovered:
1. Identify the root cause
2. Fix in the appropriate file
3. Rebuild and retest
4. Verify fix resolves the issue
5. Check for regressions

## Template Refinement

Test the `single-prompt.md` template:
1. Use it for a real task
2. Review the Claude session output
3. Check if instructions were followed correctly
4. Identify any ambiguities or missing instructions
5. Refine the template in `src/prompts/single-prompt.md`
6. Retest with the refined template

## Documentation Review

Review and update documentation:
1. Read through `docs/single-prompt-queue/README.md`
2. Verify it matches the actual implementation
3. Add any discovered limitations or caveats
4. Add troubleshooting tips if issues were found during testing
5. Ensure accuracy of all descriptions

## Files That May Need Updates

- Any implementation files with bugs
- `src/prompts/single-prompt.md` - template refinements
- `docs/single-prompt-queue/README.md` - documentation updates
- Any test files if test infrastructure exists

## Acceptance Criteria

- [ ] Project builds successfully with no TypeScript errors
- [ ] QueueWizard single-prompt flow works end-to-end
- [ ] Free text prompt source works
- [ ] GitHub issue prompt source works
- [ ] Queue entry created with correct metadata
- [ ] QueuePane displays single-prompt entries distinctly
- [ ] Execution completes successfully
- [ ] Commit created and detected
- [ ] PR created when remote configured
- [ ] PR skipped gracefully when no remote
- [ ] Detail view shows correct information when single-prompt selected
- [ ] Phases list still works for plan entries
- [ ] Edge cases handled correctly (empty prompt, no remote, API failures)
- [ ] Template produces good results in real usage
- [ ] Documentation is accurate and complete
- [ ] No regressions in existing plan-based flow

## References

- See all previous phase documentation for implementation details
- See DESIGN.md for TUI design guidelines
- See existing codebase for patterns to follow

## After Completion

Update PROGRESS.md to mark Phase 8 as complete with date completed.
Update README.md Definition of Done section to mark all items complete.
