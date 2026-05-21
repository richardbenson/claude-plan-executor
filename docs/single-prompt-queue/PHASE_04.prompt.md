Read PHASE_04.md for full context on this phase.

## Your Task

Implement the single-prompt execution logic that runs a single Claude session with the standardized template, handles completion, detects commits, and creates a PR.

## Files to Modify

1. **src/prompts/single-prompt-result-schema.json** - NEW FILE:
   - Create a JSON schema for single-prompt completion result
   - Include fields: `completed`, `committed`, `commit_message`, `summary`, `pr_created`, `pr_url`, `blockers`
   - Follow the same structure as `phase-result-schema.json`
   - Ensure all required fields are marked as required

2. **src/prompts/index.ts** - Export the new schema:
   - Import the new schema file (using Bun JSON import, like existing schemas)
   - Export it as `SINGLE_PROMPT_RESULT_SCHEMA`
   - Create a function `getSinglePromptResultSchemaPath()` that writes to temp directory
   - Follow the same pattern as `getPhaseResultSchemaPath()`

3. **src/runner/single-prompt.ts** - NEW FILE:
   - Import dependencies:
     - `readMeta`, `updateMeta`, `getLogsDir` from `../storage/meta.js`
     - `runSession` from `./session.js`
     - `classifyEnvelope` from `./envelope.js`
     - `handleRateLimit` from `./limit.js`
     - `startJsonlTail` from `./jsonl-tail.js`
     - `getHead` from `../git/repo.js`
     - `SINGLE_PROMPT_TEMPLATE`, `SINGLE_PROMPT_RESULT_SCHEMA` from `../prompts/index.js`
     - `isGitHub`, `isGitea` from `../vcs/detect.js`
     - `createGitHubPr` from `../vcs/github.js`
     - `createGiteaPr` from `../vcs/gitea.js`
     - `ActivityBus` from `../events/bus.js`
     - `AppConfig` from `../types/meta.js`

   - Define interfaces:
     - `SinglePromptResult` matching the schema
     - `SinglePromptOutcome` similar to `PhaseOutcome`

   - Implement validation function `isSinglePromptResult(v: unknown)`

   - Implement `runSinglePrompt(runId, appConfig, bus)`:
     a) Read metadata to get prompt and worktree path
     b) Inject user prompt into template (replace placeholder)
     c) Write combined prompt to temp file in os.tmpdir()
     d) Set status to 'executing'
     e) Emit 'phase' event with phaseNumber: -1 (special value for single-prompt)
     f) Capture HEAD before execution
     g) Generate session UUID and update metadata
     h) Spawn session with `runSession()` using temp prompt file
     i) Start JSONL tail for activity feed
     j) Await session completion, then stop tail
     k) Classify envelope using existing error handling
     l) Handle rate limits, transient errors, auth errors (reuse logic from phase-loop.ts)
     m) For success path:
        - Parse structured output
        - Validate with `isSinglePromptResult()`
        - Detect commit (compare HEAD before/after)
        - Update metadata with completion status, commit info, summary
        - Emit 'ok' event
     n) Push to remote (if remote configured)
     o) Create PR (if remote configured)
     p) Update metadata with PR URL
     q) Update status to 'pr-created' or 'complete'
     r) Emit final 'ok' event with PR URL

   - Handle errors appropriately:
     - Rate limit → return pause outcome
     - Transient error → retry up to max_retries
     - Auth error → mark failed
     - Invalid output → retry up to max_retries
     - Push/PR failure → mark failed with error message

## Code Patterns to Follow

- Follow the exact structure of `src/runner/phase-loop.ts` for consistency
- Use the same session spawning pattern
- Use the same JSONL tail pattern
- Use the same error classification and handling
- Use the same metadata update pattern
- Use the same activity event emission pattern
- Reuse existing commit detection logic
- Reuse existing PR creation logic from `src/runner/finalise.ts`

## Edge Cases and Error Handling

- No commit made despite completed=true → retry or fail
- Push fails (no remote or auth issue) → mark as failed, emit error event
- PR creation fails → mark as failed, emit error event
- Rate limited → return pause outcome with resume time
- No remote configured → skip push/PR, mark as complete
- Structured output invalid → retry up to max_retries
- HEAD unchanged despite committed=true → retry up to max_retries
- Template injection fails → mark as failed

## Acceptance Criteria

- [ ] `src/prompts/single-prompt-result-schema.json` created with correct structure
- [ ] Schema exported as `SINGLE_PROMPT_RESULT_SCHEMA` in index.ts
- [ ] `getSinglePromptResultSchemaPath()` function implemented
- [ ] `src/runner/single-prompt.ts` file created with all imports
- [ ] `SinglePromptResult` interface defined
- [ ] `isSinglePromptResult()` validation function implemented
- [ ] `runSinglePrompt()` function implemented
- [ ] User prompt injected into template correctly (placeholder replacement)
- [ ] Claude session spawned with combined prompt
- [ ] JSONL tail started and stopped correctly
- [ ] Activity events emitted (phase event with phaseNumber: -1)
- [ ] Commit detection works (HEAD before/after comparison)
- [ ] Error classification works (rate limit, transient, auth)
- [ ] Retry logic respects max_retries from config
- [ ] Push to remote works when remote configured
- [ ] PR creation works using existing VCS integration
- [ ] Metadata updated with completion status
- [ ] Metadata updated with commit SHA and message
- [ ] Metadata updated with PR URL
- [ ] Handles no remote case gracefully (skips push/PR)
- [ ] TypeScript compilation succeeds

## References

- See `src/runner/phase-loop.ts` for the pattern to follow
- See `src/runner/finalise.ts` for push/PR pattern
- See `src/prompts/phase-result-schema.json` for schema structure
- See `src/prompts/index.ts` for schema export pattern
- See `src/runner/session.ts` for session spawning
- See `src/vcs/github.ts` and `src/vcs/gitea.ts` for PR creation

## After Completion

Update PROGRESS.md to mark Phase 4 as complete with date completed.
