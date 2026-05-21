Read PHASE_03.md for full context on this phase.

## Your Task

Extend the QueueWizard component to support single-prompt creation flow. This adds UI for users to create single-prompt queue entries with multiple prompt sources.

## Files to Modify

1. **src/tui/components/QueueWizard.tsx** - Major extension:

   a) Add imports:
      - Import `fetchGitHubIssues` and `GitHubIssue` from `src/vcs/github.ts`
      - Keep all existing imports

   b) Extend the `WizardStep` union type with new step types:
      ```typescript
      type WizardStep =
        | { kind: 'entry-type-choice'; repoPath: string; repoConfig: RepoConfig; sel: number }
        | { kind: 'prompt-source-choice'; repoPath: string; repoConfig: RepoConfig; sel: number }
        | { kind: 'github-issue-select'; repoPath: string; repoConfig: RepoConfig; issues: GitHubIssue[]; sel: number; loading?: boolean; error?: string }
        | { kind: 'free-text-input'; repoPath: string; repoConfig: RepoConfig; value: string; error?: string }
        | { kind: 'single-prompt-confirm'; repoPath: string; repoConfig: RepoConfig; prompt: string; source: string; runId: string; worktreePath: string }
        // ... keep all existing step types
      ```

   c) Add new state variables for GitHub issues loading:
      ```typescript
      const [githubIssues, setGithubIssues] = useState<GitHubIssue[]>([]);
      ```

   d) Extend the main render function to handle new step kinds:
      - Add cases for each new step type in the switch statement
      - Each case should render appropriate UI components

   e) Implement keyboard input handlers for new steps:
      - For choice steps: arrow keys to move selection, enter to confirm, escape to cancel
      - For github-issue-select: trigger issues fetch on step entry, handle selection
      - For free-text-input: capture text input, validate on submit
      - For single-prompt-confirm: trigger queue creation on confirm

   f) Implement GitHub issues fetching effect:
      - Use `useEffect` to fetch issues when entering `github-issue-select` step
      - Set loading state during fetch
      - Handle errors and set error state
      - Update `githubIssues` state on success

   g) Implement single-prompt queue creation:
      - Generate runId with `ulid()`
      - Create worktree and branch (reuse existing `createWorktree` logic)
      - Write metadata with single-prompt fields:
        - `prompt`: the user's prompt
        - `prompt_source`: the source type
        - `github_issue_number`: if from GitHub issue
        - `plan_folder`: undefined
        - `phases`: undefined
      - Enqueue with `enqueue(runId)`
      - Move to 'running' then 'done' step (reuse existing pattern)

   h) Update the initial step to start with 'entry-type-choice' instead of 'repo':
      - Or add entry-type-choice after repo step
      - Ensure plan flow still works when user selects "Plan"

## Code Patterns to Follow

- Follow existing wizard step patterns in the file
- Use the same UI component patterns (Box, Text, etc.)
- Use the same state management patterns (useState, useEffect)
- Follow existing keyboard input handling pattern with `useInput`
- Reuse existing worktree creation and metadata writing logic
- Match the visual style of existing wizard steps
- Use the same error handling pattern (error field in step state)

## UI Design Guidelines

- Keep the card layout (CARD_W, CARD_H)
- Use the same color scheme from the theme
- Display choices with arrow indicators
- Show loading spinner during GitHub issues fetch
- Show error messages in red when failures occur
- Confirmation screen should show prompt preview (truncated if long)

## Edge Cases and Error Handling

- GitHub issues fetch fails: show error message, allow retry with enter key
- Empty prompt in free-text: show validation error, prevent submission
- Worktree creation fails: show error message, allow cancel
- User cancels at any step: close wizard (call `onClose()`)
- User presses escape: go back to previous step or cancel
- GitHub issues list is empty: show "No issues found" message

## Acceptance Criteria

- [ ] `WizardStep` type includes all new step types
- [ ] Entry-type-choice step renders with "Plan" and "Single Prompt" options
- [ ] Prompt-source-choice step renders with "Free text", "GitHub issue", "Clipboard" options
- [ ] GitHub-issue-select step fetches and displays issues
- [ ] GitHub-issue-select shows loading state during fetch
- [ ] GitHub-issue-select shows error message on fetch failure
- [ ] Free-text-input step captures and displays user input
- [ ] Free-text-input validates non-empty before submission
- [ ] Single-prompt-confirm shows prompt preview
- [ ] Confirming creates queue entry with `type: 'single-prompt'`
- [ ] Metadata includes prompt, prompt_source, and github_issue_number
- [ ] Worktree and branch are created for single-prompt
- [ ] Existing plan flow still works when user selects "Plan"
- [ ] Cancel works at any step (escape key or explicit cancel)
- [ ] TypeScript compilation succeeds

## References

- See existing wizard step implementations in `src/tui/components/QueueWizard.tsx`
- See existing worktree creation in `src/git/worktree.ts`
- See existing metadata writing in `src/storage/meta.ts`
- See `fetchGitHubIssues` from Phase 2 in `src/vcs/github.ts`
- See theme colors in `src/tui/theme.ts`

## After Completion

Update PROGRESS.md to mark Phase 3 as complete with date completed.
