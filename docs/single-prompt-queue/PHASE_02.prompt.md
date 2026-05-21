Read PHASE_02.md for full context on this phase.

## Your Task

Create the standardized single-prompt template and implement GitHub issues fetching functionality. This phase provides foundational building blocks for single-prompt creation and execution.

## Files to Modify

1. **src/prompts/single-prompt.md** - NEW FILE:
   - Create a markdown template for single-prompt execution
   - Include a placeholder variable for the user's prompt (use `{{USER_PROMPT}}` or similar)
   - Instruct Claude to:
     - Complete the task described in the user prompt
     - Commit changes with a conventional commit message
     - Push changes to the remote repository
     - Create a pull request with a descriptive title and body
     - Emit structured output when complete (for CPE tracking)
   - Follow the style and structure of existing templates in `src/prompts/` (see `planbot.md` for reference)
   - Keep it concise but clear

2. **src/prompts/index.ts** - Export the new template:
   - Import the new template file (using Bun text import, like existing templates)
   - Export it as `SINGLE_PROMPT_TEMPLATE`
   - Follow the same pattern as `PLANBOT_PROMPT`, `SUMMARISE_PROMPT`, etc.

3. **src/vcs/github.ts** - Add GitHub issues fetcher:
   - Add `GitHubIssue` interface with fields: `number`, `title`, `body`, `state`
   - Implement `fetchGitHubIssues(repoPath, state, limit)` function
   - Use `gh issue list --json number,title,body,state --state <state> --limit <limit>` command
   - Execute the command in the repoPath directory
   - Parse the JSON output
   - Return array of `GitHubIssue` objects
   - Handle errors:
     - If `gh` CLI not found, throw meaningful error
     - If authentication fails, throw meaningful error
     - If rate limited, throw meaningful error
     - If command fails, throw meaningful error with stderr

## Code Patterns to Follow

- For template imports, use the same Bun text import pattern as existing templates:
  ```typescript
  // @ts-expect-error — Bun text import
  import _singlePrompt from './single-prompt.md' with { type: 'text' };
  export const SINGLE_PROMPT_TEMPLATE: string = _singlePrompt as unknown as string;
  ```

- For CLI commands, use `Bun.spawnSync()` pattern from existing code
- Follow existing error handling patterns in `src/vcs/github.ts`
- Use TypeScript interfaces for type safety
- Keep functions focused and single-purpose

## Edge Cases and Error Handling

- Template should handle empty user prompts gracefully
- GitHub fetcher should handle:
  - Missing `gh` CLI → throw error instructing user to install
  - Authentication failure → throw error with clear message
  - Rate limiting → throw error with retry guidance
  - Empty result set → return empty array (not an error)
  - Invalid JSON output → throw error
- Repository path should be validated before running command

## Acceptance Criteria

- [ ] `src/prompts/single-prompt.md` file created
- [ ] Template has clear instructions for task completion
- [ ] Template has placeholder for user prompt (e.g., `{{USER_PROMPT}}`)
- [ ] Template instructs commit, push, and PR creation
- [ ] Template exported as `SINGLE_PROMPT_TEMPLATE` in `src/prompts/index.ts`
- [ ] `GitHubIssue` interface defined with correct fields
- [ ] `fetchGitHubIssues()` function implemented
- [ ] Function uses `gh issue list` with correct flags
- [ ] Function parses JSON output correctly
- [ ] Function throws meaningful errors for auth/rate-limit failures
- [ ] Function returns empty array for no issues (not an error)
- [ ] TypeScript compilation succeeds
- [ ] No existing tests broken (if test infrastructure exists)

## References

- See existing template pattern in `src/prompts/index.ts` lines 1-18
- See existing GitHub integration in `src/vcs/github.ts`
- See `gh issue list` documentation for JSON output format

## After Completion

Update PROGRESS.md to mark Phase 2 as complete with date completed.
