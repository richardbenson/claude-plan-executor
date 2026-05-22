# Single Prompt Queue — Plan Summary

## Original Requirements

Add support for queuing single prompts as a distinct execution type from multi-phase plans. Users needed a way to queue GitHub issues or ad-hoc tasks for overnight processing, where Claude would complete the task, commit the changes, and open a PR — all in one session with no plan folder or phase structure.

Key requirements:
- New `type: 'single-prompt'` field on `QueueEntry` (alongside existing `'plan'`)
- Multiple prompt sources: free text, GitHub issue selection, clipboard
- A standardised template (`single-prompt.md`) that instructs Claude to commit and PR when done
- A `runSinglePrompt()` runner analogous to the existing phase loop
- Queue processor routing: plan entries → phase loop; single-prompt entries → new runner
- TUI changes: QueuePane visual distinction (★ prefix, source label), PhasesPane replaced with a detail view for single-prompt selections
- Backward compatibility with all existing plan-based queue entries

## What Was Built

### Phase 1 — Type System and Data Model Extensions
Extended `QueueEntry` with a `type: 'plan' | 'single-prompt'` field and made `plan_folder` and `phases` optional in `RunMeta`. Added `prompt`, `prompt_source`, and `github_issue_number` fields. Old queue entries without a `type` field default to `'plan'`. All callers updated to use `?? []` / `?? ''` fallbacks.

### Phase 2 — Single-Prompt Template and GitHub Issues Fetcher
Created `src/prompts/single-prompt.md` with a `{{USER_PROMPT}}` placeholder and instructions for task completion and structured JSON output. Added `GitHubIssue` interface and `fetchGitHubIssues()` (backed by `gh issue list`) to `src/vcs/github.ts`. Exported `SINGLE_PROMPT_TEMPLATE` from `src/prompts/index.ts`.

> **Note:** Only phases 1 and 2 are reflected in the git log (`f78f9da`, `f971ac8`). Phases 3–8 are fully implemented in the working tree but not yet committed to the feature branch.

### Phase 3 — QueueWizard Single-Prompt Flow
Extended `QueueWizard.tsx` with five new wizard step kinds: `entry-type-choice`, `prompt-source-choice`, `github-issue-select` (with loading/error/retry), `free-text-input` (with validation), `single-prompt-confirm`, and a `running-single` effect that writes metadata and enqueues with `type: 'single-prompt'`. The existing plan flow now enters through `entry-type-choice` first. All steps have full keyboard navigation and escape-to-back.

### Phase 4 — Single-Prompt Runner
Created `src/runner/single-prompt.ts` and `src/prompts/single-prompt-result-schema.json` (fields: `completed`, `committed`, `commit_message`, `summary`, `pr_created`, `pr_url`, `blockers`). `runSinglePrompt()` follows the `phase-loop.ts` patterns: template injection, Claude session spawn, JSONL tail, envelope classification, retry logic, HEAD-before/after commit detection, remote push, VCS PR creation (GitHub + Gitea), and metadata updates. No-remote case skips push/PR gracefully. `phaseNumber: -1` used throughout for bus events.

### Phase 5 — Queue Processor Integration
Updated `src/commands/start.ts` to detect single-prompt entries via `!meta.plan_folder && meta.prompt` and route them to `runSinglePrompt()` wrapped in try/catch. Plan entries continue through the existing phase loop and finalise step unchanged. Pause/resume logic kept inside the plan branch only (single-prompt runs are single-shot).

### Phase 6 — TUI QueuePane Updates
Added `isSinglePrompt()` and `getSourceLabel()` helpers to `QueuePane.tsx`. Single-prompt entries display: "★" prefix on row 1, magenta source label (`GH` / `TXT` / `CLIP`) on row 2, status chip only (no phase count) on row 3, and a magenta progress bar when executing. Plan entries and the 4-row layout are unchanged.

### Phase 7 — TUI Detail View
Updated `PhasesPane.tsx` to detect single-prompt runs and render a DETAIL view instead of the phases list. Shows source label, status via `StateChip`, cost when non-zero, PR URL in green when set, and truncated prompt text. Commit SHA was intentionally omitted as it is not persisted to `RunMeta` by the runner. Plan runs continue to show the phases list.

### Phase 8 — Testing and Refinement
Fixed a critical template bug where `single-prompt.md` instructed Claude to push and create a PR itself (causing double-push failures) and corrected mismatched JSON output fields vs the schema. Fixed `WatchHero` to show a "★ single-prompt" label and prompt preview instead of "phase ?/0" for active single-prompt runs. Fixed `WatchBottomStrip` UP NEXT label for single-prompt entries. Fixed pre-existing test failures: `jsonl-tail.test.ts` (array-returning `classifyJsonlEntry` API, correct `tool_result` JSONL format) and `meta.test.ts` (11 states expected after `archived` was added). Updated README with accurate DoD, known limitations, and troubleshooting tips.

## Lessons Learned

**Template must not duplicate runner responsibilities.** The most impactful bug was the template instructing Claude to push and open a PR, while the runner also does this — resulting in a double-push error. The template should only instruct Claude to commit; all remote operations belong to the runner.

**Schema/output field mismatches are silent failures.** The initial result schema had field names that didn't match what the template asked Claude to emit. This caused retry exhaustion with no obvious error message. Keeping the schema and the template's output instructions in sync — and testing with a real Claude session early — would have caught this in phase 2.

**`phaseNumber: -1` is a useful convention for non-phase bus events.** Using `-1` as a sentinel let the single-prompt runner reuse all existing bus event infrastructure without needing to introduce new event types for a one-shot run.

**Pause/resume is non-trivial for single-shot runs.** The phase loop's pause/resume checkpoint naturally sits between phases. Single-prompt runs have no such checkpoint, so pause support was deliberately omitted. This is an acceptable limitation for overnight tasks but worth revisiting if interactive control of single-prompt runs becomes important.

**WatchHero and WatchBottomStrip assume phase-based runs.** Both components had hardcoded assumptions (`phase X/Y`, ETA based on remaining phases) that produced misleading output for single-prompt runs. Any new run type requires auditing every TUI component that displays per-run state, not just the primary display panes.

**Known limitations documented at close:**
- TODAY stats panel (phases complete, commits pushed, PRs opened) does not count single-prompt runs — stats are phase-based.
- Queue ETA estimate contributes 0 minutes per single-prompt entry (no phases to estimate from).
- Completed single-prompt runs sort below plan runs in the queue list because the sort key uses `phase.completed_at`.

## Final PR

PR not recorded.
