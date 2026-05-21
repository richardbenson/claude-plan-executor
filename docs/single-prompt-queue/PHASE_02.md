# Phase 2: Single-Prompt Template and GitHub Issues Fetcher

## Summary

Create the standardized single-prompt template and implement GitHub issues fetching functionality. This phase provides the foundational building blocks for single-prompt creation and execution.

## Context

Single prompts need a standardized template (like `planbot.md`) that instructs Claude to complete the task, commit changes, and create a PR. We also need the ability to fetch GitHub issues so users can select them as prompt sources.

## Files Expected to Change

- `src/prompts/single-prompt.md` - NEW: Single-prompt template
- `src/prompts/index.ts` - Export the new template
- `src/vcs/github.ts` - Add `fetchGitHubIssues()` function
- `src/vcs/github.test.ts` - NEW: Tests for GitHub issues fetcher (if testing infrastructure exists)

## Key Changes

### Single-Prompt Template
Create a markdown template that:
- Accepts a user prompt variable
- Instructs Claude to:
  - Complete the described task
  - Commit changes with a conventional commit message
  - Push to remote
  - Create a PR with descriptive title and body
  - Emit structured output for CPE tracking
- Uses placeholder syntax for variable injection (e.g., `{{USER_PROMPT}}`)
- Is similar in structure to `planbot.md` for consistency

### GitHub Issues Fetcher
Add function to `src/vcs/github.ts`:
```typescript
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
}

export async function fetchGitHubIssues(
  repoPath: string,
  state: 'open' | 'closed' = 'open',
  limit: number = 20
): Promise<GitHubIssue[]>
```

Implementation should:
- Use `gh issue list` command
- Parse JSON output
- Handle authentication errors gracefully
- Handle rate limiting gracefully
- Return structured issue data

## Edge Cases and Error Handling

- Template injection: Handle cases where user prompt is empty or very long
- GitHub API: Handle missing `gh` CLI, authentication failures, rate limits
- Repository detection: Determine correct repo from worktree path
- Empty issue list: Handle gracefully in UI

## Acceptance Criteria

- [ ] `src/prompts/single-prompt.md` template created with clear instructions
- [ ] Template includes variable placeholder for user prompt
- [ ] Template instructs commit, push, and PR creation
- [ ] Template exported in `src/prompts/index.ts`
- [ ] `fetchGitHubIssues()` function implemented in `src/vcs/github.ts`
- [ ] Function uses `gh issue list --json number,title,body,state`
- [ ] Function handles authentication errors (throws meaningful error)
- [ ] Function handles rate limiting (throws meaningful error)
- [ ] Function returns structured GitHubIssue array
- [ ] TypeScript compilation succeeds
