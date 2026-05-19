# Phase 08 — Phase Execution Loop + VCS + Finalisation

## Summary

Implement the full per-phase lifecycle (spec §7.3), the VCS detection + PR creation module (spec
§7.4), and the finalisation step. After this phase, the queue processor in Phase 09 can call into
a complete `runPhase()` function and a `finaliseRun()` function.

## Context

### Phase execution loop (src/runner/phase-loop.ts)
`runPhase(runId, phaseNumber, appConfig, bus)` implements spec §7.3 step by step:

1. **Limit check** — check if run is `paused-limit` in meta.json; if so, call `waitForReset()`
   then continue
2. **Update state** — set `phases[n].status = 'executing'`, `started_at = now`, write meta.json;
   emit `PhaseEvent` on bus
3. **Capture HEAD** — `git rev-parse HEAD` in the worktree; store on the phase entry as
   `head_before`
4. **Pre-allocate session UUID** — `ulid()` → write as `session_id` on the phase entry in
   meta.json (so it's persisted before Claude starts)
5. **Compute jsonl path** — call `startJsonlTail(uuid, worktreePath, runId, phaseNumber, bus)`
6. **Spawn session** — `runSession({ worktreePath, promptFile, sessionId, logPath, schema })`
   where `schema` is the path to `src/prompts/phase-result-schema.json` bundled in the binary.
   Log path: `~/.local/state/cpe/runs/<runId>/logs/phase-NN.log`
7. **Stop jsonl tail** — call the stop function returned by `startJsonlTail`
8. **Parse envelope** — call `classifyEnvelope(envelope)`. Switch on outcome:
   - `rate-limit`: call `handleRateLimit(envelope, runId, phaseNumber)` which marks the run
     `paused-limit` and returns `{ resumeAt, sessionId, hadWork }`. Return `{ outcome: 'paused' }`
     to the caller; the queue processor will sleep and retry.
   - `transient-error`: increment retry_count, delay 30s, retry (counts toward `max_retries`)
   - `auth-error`: mark phase `failed`, mark run `failed`, emit `ErrorEvent`. Return.
   - `phase-failure` or envelope unparseable: increment retry_count; if ≤ max_retries, retry
     (status `retrying`); else mark phase `failed`, mark run `failed`. Return.
   - `success`: continue to step 9.
9. **Cross-check HEAD** — `git rev-parse HEAD` in the worktree:
   - `structured_output.committed: true` AND head changed → record new head as `commit_sha`
   - `structured_output.committed: true` but head unchanged → log discrepancy, treat as
     phase-failure (Claude misreported); retry/fail per usual rules
   - `structured_output.committed: false` → accept (some phases legitimately don't commit)
10. **Mark complete** — set `completed_at`, `status: 'complete'`, store `summary`,
    `notes_for_next_phase`, `cost_usd`, `tokens`, `commit_sha` from envelope; update
    `total_cost_usd` on the run; write meta.json. Emit `OkEvent` on bus.
11. Return `{ outcome: 'complete' }`

Rate-limit recovery (restart vs resume, §7.3.2):
`resumeOrRestart(phaseEntry, appConfig, bus)`:
- `hadWork` = `phaseEntry.tokens.input > 0 || phaseEntry.cost_usd > 0`
- If not hadWork: spawn a fresh `runSession` (new session UUID)
- If hadWork: `claude --resume <session_id> -p --output-format=json --json-schema <schema>` with
  the continuation prompt: "You were interrupted by a rate limit. Continue from where you left
  off. Some tool calls may have completed partially — verify the state of the working tree before
  re-running anything. When done, emit your final JSON per the schema."

### VCS detection (src/vcs/detect.ts)
`detectVcsHost(remote)` — already computed by `getRemote()` in Phase 04; this module re-exports
the type and provides `isGitHub(remote)` and `isGitea(remote)` helpers.

### GitHub PR (src/vcs/github.ts)
`createGitHubPr(worktreePath, featureBranch, targetBranch)`:
Run `gh pr create --base <targetBranch> --head <featureBranch> --fill --json url` in the
worktree. Parse the JSON output to get the PR URL. Return `{ url: string }`.

### Gitea PR (src/vcs/gitea.ts)
`createGiteaPr(worktreePath, featureBranch, targetBranch, remote)`:
Attempt `tea pr create --base <targetBranch> --head <featureBranch>` first. If `tea` is not found,
fall back to Gitea REST API: `POST /api/v1/repos/<owner>/<repo>/pulls` with a Bearer token from
`git config --get gitea.token` or the `GITEA_TOKEN` env var.

### Finalisation (src/runner/finalise.ts)
`finaliseRun(runId, bus)` implements spec §7.4:

1. Set run status to `finalising`, write meta.json; emit appropriate bus event
2. Read the plan folder from meta.json; spawn headless summarise:
   `claude -p < <(inject planFolder into summarise.md)` in the worktree
3. Verify `docs/<folder>.md` was created and `docs/<folder>/` was deleted (list the worktree fs)
4. If either check fails, log error but don't abort — the PR should still be created
5. Commit: `git add -A && git commit -m "docs: summarise <folder>"` in the worktree
6. Push: `git push -u origin <featureBranch>` in the worktree
7. Detect VCS host from `meta.json.remote.type`; call `createGitHubPr` or `createGiteaPr`
8. Capture PR URL; set run status to `pr-created`; write meta.json
9. Emit a `CommitEvent` (for the summary commit) then an `OkEvent` with the PR URL
10. Return `{ prUrl: string }`

## Files Expected to Change

- `src/runner/phase-loop.ts` — created
- `src/runner/finalise.ts` — created
- `src/vcs/detect.ts` — created
- `src/vcs/github.ts` — created
- `src/vcs/gitea.ts` — created

## Acceptance Criteria

1. `tsc --noEmit` passes
2. `runPhase` returns `{ outcome: 'paused' }` when `classifyEnvelope` returns `rate-limit`
3. `runPhase` marks the phase `failed` and run `failed` when retries are exhausted
4. `runPhase` emits an `OkEvent` on the bus when a phase completes cleanly
5. HEAD cross-check: if `committed: true` but HEAD unchanged, the phase is treated as a failure
6. `finaliseRun` sets run status `pr-created` and returns a PR URL

## Dependencies

Phase 07 (event bus, jsonl tail, session runner available).
