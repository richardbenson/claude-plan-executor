Read docs/claude-plan-executor/PHASE_08.md for full context before starting.

You are implementing phase 08 of the Claude Plan Executor (`cpe`) project. This phase builds the
full per-phase execution lifecycle, VCS detection + PR creation, and the finalisation step.

Working directory: /home/ubuntu/Code/claude-plan-executor
Branch: feature/claude-plan-executor-phase-8 (create it off feature/claude-plan-executor)
PR target: feature/claude-plan-executor

Before writing anything, read ALL of the following — this is the most complex phase:
- docs/000-claude-plan-executor-spec.md §7.3 (full phase execution steps 1-11)
- docs/000-claude-plan-executor-spec.md §7.3.1 (phase result schema — the structured_output shape)
- docs/000-claude-plan-executor-spec.md §7.3.2 (rate-limit restart vs resume policy)
- docs/000-claude-plan-executor-spec.md §7.4 (finalisation steps)
- docs/000-claude-plan-executor-spec.md §8.1 (envelope fields for rate-limit)
- src/runner/session.ts (runSession signature)
- src/runner/envelope.ts (ClaudeEnvelope, classifyEnvelope, EnvelopeOutcome)
- src/runner/limit.ts (handleRateLimit, waitUntil)
- src/runner/jsonl-tail.ts (startJsonlTail)
- src/events/bus.ts (activityBus, ActivityBus)
- src/storage/meta.ts (readMeta, writeMeta, updateMeta, updatePhase, getLogsDir)
- src/types/meta.ts (RunMeta, PhaseEntry)

FILE: src/runner/phase-loop.ts

The phase result schema (what Claude's structured_output must contain):
interface PhaseResult {
  completed: boolean;
  committed: boolean;
  commit_message: string | null;
  summary: string;
  blockers?: string[];
  notes_for_next_phase?: string;
}

type PhaseOutcome =
  | { outcome: 'complete'; result: PhaseResult }
  | { outcome: 'paused'; resumeAt: Date; hadWork: boolean }
  | { outcome: 'failed'; reason: string };

Export:
- runPhase(runId: string, phaseNumber: number, appConfig: AppConfig, bus: ActivityBus): Promise<PhaseOutcome>

Full implementation following spec §7.3 step by step:

STEP 1 — LIMIT CHECK: readMeta(runId). If meta.status === 'paused-limit', the caller should have
already waited; assert we're not calling runPhase in a paused state. (The queue processor in
Phase 09 handles the wait; runPhase assumes the window is open.)

STEP 2 — UPDATE STATE: Find the phase entry for phaseNumber. Set its status to 'executing',
set started_at to new Date().toISOString(). updateMeta to persist. Emit a PhaseEvent on bus:
activityBus.emit({ kind: 'phase', timestamp: new Date(), runId, phaseNumber,
  phaseName: phaseEntry.prompt_file.replace('PHASE_', '').replace('.prompt.md', '') })

STEP 3 — CAPTURE HEAD BEFORE: getHead(meta.worktree_path) → store as headBefore on the phase
entry (call it locally; updatePhase writes it). Use getHead from src/git/repo.ts.

STEP 4 — PRE-ALLOCATE SESSION UUID: ulid() → write session_id onto the phase entry via
updatePhase(runId, phaseNumber, { session_id: uuid }).

STEP 5 — START JSONL TAIL: call startJsonlTail(uuid, meta.worktree_path, runId, phaseNumber, bus).
Store the returned stop() function.

STEP 6 — SPAWN SESSION:
  promptFile = path.join(meta.worktree_path, 'docs', meta.plan_folder, phaseEntry.prompt_file)
  logPath = path.join(getLogsDir(runId), 'phase-' + String(phaseNumber).padStart(2,'0') + '.log')
  schemaPath = PHASE_RESULT_SCHEMA_PATH (from src/prompts/index.ts)
  result = await runSession({ worktreePath: meta.worktree_path, promptFile, sessionId: uuid,
    logPath, schemaPath })

STEP 7 — STOP JSONL TAIL: call the stop function.

STEP 8 — CLASSIFY ENVELOPE: outcome = classifyEnvelope(result.envelope). Switch:

  'rate-limit':
    const { resumeAt, hadWork } = await handleRateLimit(result.envelope, runId, phaseNumber, bus)
    return { outcome: 'paused', resumeAt, hadWork }

  'transient-error':
    phaseEntry.retry_count += 1
    if phaseEntry.retry_count > appConfig.max_retries:
      await markPhaseFailed(runId, phaseNumber, 'transient API error', bus)
      return { outcome: 'failed', reason: 'transient API error after retries' }
    await updatePhase(runId, phaseNumber, { status: 'retrying', retry_count: phaseEntry.retry_count })
    await Bun.sleep(30_000) // 30s delay before retry
    return runPhase(runId, phaseNumber, appConfig, bus) // tail-recursive retry

  'auth-error':
    await markPhaseFailed(runId, phaseNumber, 'auth error: ' + result.envelope.api_error_status, bus)
    return { outcome: 'failed', reason: 'auth error' }

  'phase-failure':
    phaseEntry.retry_count += 1
    if phaseEntry.retry_count > appConfig.max_retries:
      await markPhaseFailed(runId, phaseNumber, outcome.reason, bus)
      return { outcome: 'failed', reason: outcome.reason }
    await updatePhase(runId, phaseNumber, { status: 'retrying', retry_count: phaseEntry.retry_count })
    return runPhase(runId, phaseNumber, appConfig, bus)

  'success': continue to STEP 9.

STEP 9 — CROSS-CHECK HEAD:
  const headAfter = getHead(meta.worktree_path)
  const phaseResult = result.envelope.structured_output as PhaseResult (validate shape — at minimum
  check completed and committed are booleans and summary is a string)
  if phaseResult.committed && headAfter === headBefore:
    // Claude misreported — treat as failure
    phaseEntry.retry_count += 1
    if retry exhausted: markPhaseFailed, return failed
    else: updatePhase status 'retrying', return runPhase(...)
  if phaseResult.committed && headAfter !== headBefore:
    commitSha = headAfter

STEP 10 — MARK COMPLETE:
  await updatePhase(runId, phaseNumber, {
    status: 'complete',
    completed_at: new Date().toISOString(),
    commit_sha: commitSha,
    summary: phaseResult.summary,
    commit_message: phaseResult.commit_message ?? null,
    notes_for_next_phase: phaseResult.notes_for_next_phase ?? '',
    blockers: phaseResult.blockers ?? [],
    cost_usd: result.envelope.total_cost_usd,
    tokens: result.envelope.usage,
  })
  // Update run total cost
  const freshMeta = readMeta(runId);
  const totalCost = freshMeta.phases.reduce((sum, p) => sum + (p.cost_usd ?? 0), 0);
  await updateMeta(runId, { total_cost_usd: totalCost });
  // Emit ok event
  activityBus.emit({ kind: 'ok', timestamp: new Date(), runId, phaseNumber,
    summary: phaseResult.summary, costUsd: result.envelope.total_cost_usd })
  return { outcome: 'complete', result: phaseResult }

Helper — markPhaseFailed(runId, phaseNumber, reason, bus):
  updatePhase(runId, phaseNumber, { status: 'failed' })
  updateMeta(runId, { status: 'failed' })
  activityBus.emit({ kind: 'error', timestamp: new Date(), runId, phaseNumber, message: reason })

Also export:
- resumeOrRestart(runId: string, phaseNumber: number, appConfig: AppConfig, bus: ActivityBus): Promise<PhaseOutcome>
  Reads the phase entry. If hadWork (tokens.input_tokens > 0 || cost_usd > 0): spawn
  `claude --resume <session_id> -p --output-format json --json-schema <schemaPath>` with the
  continuation prompt piped via stdin:
    "You were interrupted by a rate limit. Continue from where you left off. Some tool calls may
    have completed partially — verify the state of the working tree before re-running anything.
    When done, emit your final JSON per the schema."
  Write continuation prompt to a temp file; pipe it as stdin.
  If not hadWork: call runPhase fresh (new session UUID).

FILE: src/vcs/detect.ts

Re-export ParsedRemote from src/git/repo.ts.
Export helper functions:
- isGitHub(remote: ParsedRemote): boolean — remote.type === 'github'
- isGitea(remote: ParsedRemote): boolean — remote.type === 'gitea'

FILE: src/vcs/github.ts

interface PrResult {
  url: string;
}

Export:
- createGitHubPr(worktreePath: string, featureBranch: string, targetBranch: string): Promise<PrResult>
  Run: gh pr create --base <targetBranch> --head <featureBranch> --fill --json url
  with cwd: worktreePath. Parse JSON output, return { url: data.url }.
  Throw with stderr content if gh exits non-zero.

FILE: src/vcs/gitea.ts

Export:
- createGiteaPr(worktreePath: string, featureBranch: string, targetBranch: string,
    remote: ParsedRemote): Promise<PrResult>
  Attempt: tea pr create --base <targetBranch> --head <featureBranch> with cwd: worktreePath.
  Parse stdout to extract the PR URL (look for a line containing 'https://').
  If tea is not found (ENOENT), fall back to Gitea REST API:
    Read token from env GITEA_TOKEN ?? run `git config --get gitea.token`.
    POST to https://<remote.host>/api/v1/repos/<remote.owner>/<remote.repo>/pulls with JSON body:
      { head: featureBranch, base: targetBranch, title: featureBranch }
    Bearer auth header. Return { url: response.html_url }.
  If no token found and tea not found: throw new Error('No Gitea auth: set GITEA_TOKEN or
    configure tea CLI')

FILE: src/runner/finalise.ts

interface FinaliseResult {
  prUrl: string;
}

Export:
- finaliseRun(runId: string, bus: ActivityBus): Promise<FinaliseResult>

Implementation (spec §7.4):
1. updateMeta(runId, { status: 'finalising' }). Emit a PhaseEvent-like event on bus.
2. Read meta. Inject plan_folder into summarise.md: replace 'PLAN_FOLDER' with meta.plan_folder.
   Write to a temp file.
3. Spawn: claude -p < <tempFile> in meta.worktree_path (interactive-style but headless, no
   --output-format=json — this is a plain prose session). Use Bun.spawn with stdin: tempFileHandle,
   stdout: 'inherit', stderr: 'inherit'. Wait for exit. If non-zero exit: log warning but continue.
4. Delete the temp file.
5. Verify: fs.existsSync(path.join(worktreePath, 'docs', planFolder + '.md')) — warn if missing.
   fs.existsSync(path.join(worktreePath, 'docs', planFolder)) — warn if still exists.
6. Commit: Bun.spawnSync(['git', 'add', '-A'], { cwd: worktreePath }).
   Bun.spawnSync(['git', 'commit', '-m', 'docs: summarise ' + planFolder], { cwd: worktreePath }).
   On non-zero exit: log error but continue (don't abort the PR creation).
7. Push: Bun.spawnSync(['git', 'push', '-u', 'origin', meta.feature_branch], { cwd: worktreePath }).
   Throw if push fails (we need the branch on remote to create a PR).
8. Detect VCS and create PR:
   if isGitHub(meta.remote): prResult = await createGitHubPr(...)
   else if isGitea(meta.remote): prResult = await createGiteaPr(...)
   else: throw new Error('Unsupported VCS host: ' + meta.remote?.host ?? 'unknown')
9. updateMeta(runId, { status: 'pr-created' })
10. Emit OkEvent with summary: 'PR opened: ' + prResult.url, costUsd: meta.total_cost_usd
11. Return { prUrl: prResult.url }

VERIFY before committing:
1. bun run typecheck passes
2. runPhase returns { outcome: 'paused' } when classifyEnvelope returns 'rate-limit'
3. runPhase marks phase + run 'failed' when retries are exhausted
4. resumeOrRestart calls runPhase fresh when hadWork is false
5. HEAD cross-check: structured_output.committed === true but HEAD unchanged → phase failure

After all criteria pass:
1. git add src/runner/phase-loop.ts src/runner/finalise.ts src/vcs/
2. git commit -m "feat: phase 08 — phase execution loop, VCS, and finalisation"
3. git push -u origin feature/claude-plan-executor-phase-8
4. Create PR targeting feature/claude-plan-executor

Update docs/claude-plan-executor/PROGRESS.md on start and completion.

Your final message in this conversation must be a JSON object matching the schema you have been
given. Do all your work using tools first, then emit only the JSON as your closing message.
