# Single Prompt Queue - Implementation Progress

## Branching Strategy

- Feature branch: `feature/single-prompt-queue`
- Phase branches: `feature/single-prompt-queue-phase-[x]` — branching off the feature branch
- Phase PRs target the feature branch; feature PR targets `main`

## Phase 1: Type System and Data Model Extensions
- Status: complete
- Branch: feature/single-prompt-queue-phase-1
- Dependencies: none
- Date started: 2026-05-21
- Date completed: 2026-05-21
- Notes: Added type field to QueueEntry, made plan_folder/phases optional in RunMeta, added prompt/prompt_source/github_issue_number fields. Updated all callers to use ?? [] / ?? '' fallbacks for backward compatibility.

## Phase 2: Single-Prompt Template and GitHub Issues Fetcher
- Status: complete
- Branch: feature/single-prompt-queue-phase-2
- Dependencies: Phase 1
- Date started: 2026-05-21
- Date completed: 2026-05-21
- Notes: Created single-prompt.md template with {{USER_PROMPT}} placeholder. Exported as SINGLE_PROMPT_TEMPLATE. Added GitHubIssue interface and fetchGitHubIssues() to src/vcs/github.ts.

## Phase 3: QueueWizard Single-Prompt Flow
- Status: not-started
- Branch: feature/single-prompt-queue-phase-3
- Dependencies: Phase 1, Phase 2
- Date started:
- Date completed:
- Notes:

## Phase 4: Single-Prompt Runner
- Status: not-started
- Branch: feature/single-prompt-queue-phase-4
- Dependencies: Phase 1, Phase 2
- Date started:
- Date completed:
- Notes:

## Phase 5: Queue Processor Integration
- Status: not-started
- Branch: feature/single-prompt-queue-phase-5
- Dependencies: Phase 4
- Date started:
- Date completed:
- Notes:

## Phase 6: TUI QueuePane Updates
- Status: not-started
- Branch: feature/single-prompt-queue-phase-6
- Dependencies: Phase 1
- Date started:
- Date completed:
- Notes:

## Phase 7: TUI Detail View Updates
- Status: not-started
- Branch: feature/single-prompt-queue-phase-7
- Dependencies: Phase 1, Phase 6
- Date started:
- Date completed:
- Notes:

## Phase 8: Testing and Refinement
- Status: not-started
- Branch: feature/single-prompt-queue-phase-8
- Dependencies: All previous phases
- Date started:
- Date completed:
- Notes:
