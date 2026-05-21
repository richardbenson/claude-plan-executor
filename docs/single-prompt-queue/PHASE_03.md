# Phase 3: QueueWizard Single-Prompt Flow

## Summary

Extend the QueueWizard component to support single-prompt creation flow. This adds the UI for users to create single-prompt queue entries with multiple prompt sources.

## Context

The QueueWizard currently only handles plan-based queue creation. We need to add a parallel flow for single-prompt creation that includes:
- Initial choice between Plan and Single Prompt
- Prompt source selection (free text, GitHub issue, clipboard)
- GitHub issue list and selection
- Free text input
- Confirmation screen
- Queue entry creation with appropriate metadata

## Files Expected to Change

- `src/tui/components/QueueWizard.tsx` - Major extension with new wizard steps

## Key Changes

### New Wizard Step Types

Add to the `WizardStep` union type:
- `{ kind: 'entry-type-choice', repoPath: string, repoConfig: RepoConfig, sel: number }`
- `{ kind: 'prompt-source-choice', repoPath: string, repoConfig: RepoConfig, sel: number }`
- `{ kind: 'github-issue-select', repoPath: string, repoConfig: RepoConfig, issues: GitHubIssue[], sel: number, loading?: boolean, error?: string }`
- `{ kind: 'free-text-input', repoPath: string, repoConfig: RepoConfig, value: string, error?: string }`
- `{ kind: 'single-prompt-confirm', repoPath: string, repoConfig: RepoConfig, prompt: string, source: string, runId: string, worktreePath: string }`

### Step Flow

1. **entry-type-choice**: User chooses "Plan" (existing flow) or "Single Prompt"
2. **prompt-source-choice**: User chooses "Free text", "GitHub issue", or "Clipboard"
3. **github-issue-select**: Fetch and display issues, user selects one
4. **free-text-input**: Multiline text input for user prompt
5. **single-prompt-confirm**: Show prompt preview, confirm queue creation
6. **running/complete**: Reuse existing confirmation states

### Keyboard Navigation

- Arrow keys for selection in choice steps
- Enter to confirm selection
- Escape to cancel/go back
- Text input for free-text step
- Loading state while fetching GitHub issues

### Queue Entry Creation

When confirming single-prompt:
- Generate runId with `ulid()`
- Create worktree and branch (reuse existing logic)
- Write metadata with single-prompt specific fields
- Enqueue entry with `type: 'single-prompt'`

## Edge Cases and Error Handling

- GitHub issues fetch failures → show error message, allow retry
- Empty prompt text → show validation error
- Worktree creation failures → show error message
- Cancel at any step → close wizard
- Back navigation → return to previous step

## Acceptance Criteria

- [ ] User can choose between Plan and Single Prompt at wizard start
- [ ] User can select prompt source (free text, GitHub issue, clipboard)
- [ ] GitHub issues fetch and display in list
- [ ] User can select GitHub issue from list
- [ ] User can input free text prompt
- [ ] Confirmation screen shows prompt preview
- [ ] Single-prompt entry created in queue with correct metadata
- [ ] Worktree and branch created for single-prompt
- [ ] Error handling covers GitHub API failures
- [ ] Cancel works at any step
- [ ] TypeScript compilation succeeds
