# Single Prompt Queue Feature

## Overview

Add support for queuing single prompts (distinct from multi-phase plans) that execute with a standard template instructing Claude to commit work and create a PR when complete. This enables users to queue up GitHub issues or ad-hoc tasks for overnight processing.

## Requirements

### Functional Requirements

1. **New Queue Entry Type**
   - Add `type` field to `QueueEntry` with values `'plan' | 'single-prompt'`
   - Single-prompt entries are distinct from plan-based entries in processing and display

2. **Multiple Prompt Sources**
   - Support free text input
   - Support GitHub issue selection (list issues, user chooses, issue title/body becomes prompt)
   - Support clipboard as a source (future extensibility)
   - Source should be tracked in metadata

3. **QueueWizard UI Flow**
   - Add initial choice: "Plan" vs "Single Prompt"
   - For Single Prompt:
     - Select prompt source (free text, GitHub issue, clipboard)
     - If GitHub issue: fetch and display list, user selects one
     - If free text: multiline input field
     - Confirmation screen with prompt preview
   - Maintain existing plan flow unchanged

4. **Execution Path**
   - Create worktree and feature branch (same as plans)
   - Run single prompt with standardized template instructions
   - Template should instruct Claude to:
     - Complete the task described in the prompt
     - Commit changes when done
     - Create a PR against target branch
   - Skip plan folder structure (no docs/plan-folder/, no PHASE_*.prompt.md files)
   - Execute in one session (no phase loop)
   - After completion, detect commit and push to remote
   - Create PR using existing VCS integration

5. **Prompt Template**
   - Create `src/prompts/single-prompt.md` as standardized template
   - Template should be configurable and tweakable (like planbot.md)
   - Include instructions for:
     - Task completion
     - Git commit with conventional message
     - PR creation with descriptive title/body
     - Structured output for CPE to track completion

6. **TUI Display**
   - QueuePane: Display single-prompt entries differently from plans
     - Use visual distinction (e.g., "★" prefix, different color)
     - Show prompt source indicator
     - No phase count (single shot)
   - When single-prompt selected in left column:
     - Center column shows detail view (not phases list)
     - Detail view shows: prompt text, source, status, commit info, PR URL
   - Maintain existing plan selection behavior unchanged

### Technical Requirements

1. **Type System Extensions**
   - Extend `QueueEntry` interface with `type` field
   - Extend `RunMeta` interface for single-prompt support:
     - `prompt?: string` (the user's prompt)
     - `prompt_source?: 'free-text' | 'github-issue' | 'clipboard'`
     - `plan_folder?: string` (optional, null for single-prompt)
     - `phases?: PhaseEntry[]` (optional, null for single-prompt)
   - Update queue storage to handle new type field
   - Ensure backward compatibility with existing plan entries

2. **GitHub Issues Integration**
   - Add `fetchGitHubIssues()` function to `src/vcs/github.ts`
   - Use `gh issue list` to fetch open issues
   - Parse and return structured issue data (number, title, body)
   - Handle authentication errors gracefully
   - Handle rate limiting gracefully

3. **Single-Prompt Runner**
   - Create `src/runner/single-prompt.ts` module
   - Implement `runSinglePrompt()` function analogous to `runPhase()`
   - Should:
     - Inject user prompt into template
     - Spawn Claude session with template + prompt
     - Track session similar to phase execution
     - Detect commit after completion
     - Push to remote
     - Create PR
     - Update metadata with completion status
   - Handle rate limits, auth errors, transient errors (reuse existing error handling)

4. **Queue Processor Integration**
   - Update `src/commands/start.ts` queue processor loop
   - Detect entry type from metadata
   - Route to appropriate execution path:
     - Plan entries → existing phase loop
     - Single-prompt entries → new single-prompt runner
   - Maintain existing pause/resume behavior for both types

5. **QueueWizard Extension**
   - Update `src/tui/components/QueueWizard.tsx`
   - Add new wizard step types:
     - `{ kind: 'entry-type-choice', repoPath, repoConfig, sel }`
     - `{ kind: 'prompt-source-choice', repoPath, repoConfig, sel }`
     - `{ kind: 'github-issue-select', repoPath, repoConfig, issues, sel }`
     - `{ kind: 'free-text-input', repoPath, repoConfig, value, error }`
     - `{ kind: 'single-prompt-confirm', repoPath, repoConfig, prompt, source, runId, worktreePath }`
   - Implement keyboard navigation for new steps
   - Maintain existing plan wizard flow unchanged

6. **TUI Component Updates**
   - Update `src/tui/components/QueuePane.tsx`:
     - Check `run.plan_folder` to distinguish single-prompt vs plan
     - Apply visual distinction for single-prompt entries
     - Display prompt source indicator
   - Update `src/tui/components/PhasesPane.tsx`:
     - Detect single-prompt selection
     - Show detail view instead of phases list
     - Display: prompt, source, status, commit SHA, PR URL
   - Update TUI state management to handle single-prompt selection

7. **Metadata Storage**
   - Update `src/storage/meta.ts` functions to handle optional fields
   - Ensure `writeMeta()` and `readMeta()` support single-prompt metadata shape
   - Add validation for single-prompt metadata
   - Maintain backward compatibility with plan metadata

## Scope

### In Scope
- New queue entry type and data model extensions
- Single-prompt template creation
- GitHub issues fetcher integration
- QueueWizard single-prompt flow
- Single-prompt runner implementation
- Queue processor routing
- TUI display updates
- Basic error handling and edge cases

### Out of Scope
- Clipboard integration (future enhancement)
- Prompt history/favorites
- Single-prompt editing after queuing
- Advanced prompt source integrations (Jira, Linear, etc.)
- Single-prompt retry logic (beyond basic error handling)
- Single-prompt template customization per repo

## Definition of Done

- [ ] Users can create single-prompt queue entries via QueueWizard
- [ ] Users can select prompt from multiple sources (free text, GitHub issues)
- [ ] Single-prompt entries display distinctly in TUI queue
- [ ] Single-prompt execution completes with commit and PR
- [ ] Single-prompt entries can be selected in TUI to show detail view
- [ ] GitHub issues list fetches successfully with error handling
- [ ] Queue processor correctly routes entry types to appropriate execution paths
- [ ] Existing plan-based flow remains unchanged and functional
- [ ] Backward compatibility maintained for existing queue entries
- [ ] Error handling covers: GitHub API failures, Claude session failures, commit detection failures
- [ ] TUI updates follow DESIGN.md color and layout guidelines
