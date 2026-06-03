import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readMeta, updateMeta, getLogsDir } from '../storage/meta.js';
import { resolveProvider } from './provider.js';
import * as harnessRegistry from '../harness/registry.js';
import { classifyEnvelope } from './envelope.js';
import { handleRateLimit } from './limit.js';
import { startJsonlTail } from './jsonl-tail.js';
import { getHead } from '../git/repo.js';
import { SINGLE_PROMPT_TEMPLATE, SINGLE_PROMPT_RESULT_SCHEMA } from '../prompts/index.js';
import { createClone, removeClone } from '../git/clone.js';
import { captureRun } from './capture.js';
import { RunGuard, registerGuard, unregisterGuard } from './run-guard.js';
import type { ActivityBus } from '../events/bus.js';
import type { ActivityEvent } from '../events/types.js';
import type { AppConfig, RunMeta } from '../types/meta.js';
import type { Harness } from '../harness/types.js';

export interface SinglePromptResult {
  completed: boolean;
  committed: boolean;
  commit_message: string | null;
  summary: string;
  pr_created: boolean;
  pr_url: string | null;
  blockers?: string[];
}

export type SinglePromptOutcome =
  | { outcome: 'complete'; result: SinglePromptResult }
  | { outcome: 'paused'; resumeAt: Date; hadWork: boolean }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'bench'; runOutcome: NonNullable<RunMeta['run_outcome']>; resultsDir: string };

function isSinglePromptResult(v: unknown): v is SinglePromptResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['completed'] === 'boolean' &&
    typeof r['committed'] === 'boolean' &&
    typeof r['summary'] === 'string' &&
    typeof r['pr_created'] === 'boolean'
  );
}

async function markFailed(runId: string, reason: string, bus: ActivityBus): Promise<void> {
  updateMeta(runId, { status: 'failed' });
  bus.emit({
    kind: 'error',
    timestamp: new Date(),
    runId,
    phaseNumber: -1,
    message: reason,
  });
}

export async function runSinglePrompt(
  runId: string,
  appConfig: AppConfig,
  bus: ActivityBus,
  _retryCount = 0,
): Promise<SinglePromptOutcome> {
  // STEP 1 — read metadata and validate prompt exists
  const meta = readMeta(runId);
  if (!meta.prompt) {
    await markFailed(runId, 'no prompt found in metadata', bus);
    return { outcome: 'failed', reason: 'no prompt found in metadata' };
  }

  // Resolve the harness adapter up front so an unknown harness fails fast,
  // before any execution. Defaults to claude-code, preserving current behaviour.
  const harnessName = meta.harness ?? appConfig.harness_for_phases ?? 'claude-code';
  let adapter;
  try {
    adapter = harnessRegistry.get(harnessName);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await markFailed(runId, reason, bus);
    return { outcome: 'failed', reason };
  }

  // Bench / clone-isolation runs take a distinct, simpler path: a fresh clone of
  // the baseline as cwd, an activity-based timeout + bail guard, and post-run
  // capture — no envelope-classification/retry/PR ceremony. Default worktree
  // single-prompt runs fall through to the unchanged path below.
  const isolation = meta.isolation ?? appConfig.isolation ?? 'worktree';
  if (isolation === 'clone') {
    return runBenchSinglePrompt(runId, meta, adapter, appConfig, bus);
  }

  // STEP 2 — inject user prompt and optional GitHub issue section into template
  const githubIssueSection = meta.github_issue_number
    ? `Include \`Closes #${meta.github_issue_number}\` in the PR body so GitHub automatically closes the issue when the PR is merged.`
    : '';
  const combined = SINGLE_PROMPT_TEMPLATE
    .replace('{{USER_PROMPT}}', meta.prompt)
    .replace('{{GITHUB_ISSUE_SECTION}}', githubIssueSection);

  // STEP 3 — write combined prompt to temp file
  const tmpFile = path.join(os.tmpdir(), `cpe-single-prompt-${runId}.md`);
  try {
    fs.writeFileSync(tmpFile, combined);
  } catch (err) {
    await markFailed(runId, `failed to write prompt temp file: ${String(err)}`, bus);
    return { outcome: 'failed', reason: 'template injection failed' };
  }

  // STEP 4 — set status to executing
  updateMeta(runId, { status: 'executing' });

  // STEP 5 — emit phase event (phaseNumber: -1 for single-prompt)
  bus.emit({
    kind: 'phase',
    timestamp: new Date(),
    runId,
    phaseNumber: -1,
    phaseName: 'single-prompt',
  });

  // STEP 6 — capture HEAD before execution
  const headBefore = getHead(meta.worktree_path);

  // STEP 7 — pre-allocate session UUID
  const uuid = crypto.randomUUID();

  // STEP 8 — spawn session with combined prompt
  const logPath = path.join(getLogsDir(runId), 'single-prompt.log');
  const provider = await resolveProvider(
    appConfig.providers ?? [],
    'phase',
    appConfig.provider_for_phases,
  );
  const sessionPromise = adapter.run({
    cwd: meta.worktree_path,
    promptFile: tmpFile,
    sessionId: uuid,
    logPath,
    schema: SINGLE_PROMPT_RESULT_SCHEMA,
    dangerouslySkipPermissions: appConfig.dangerously_skip_permissions,
    providerEnv: provider?.env ?? {},
    modelArgs: provider?.modelArgs ?? [],
  });

  // STEP 9 — start JSONL tail for activity feed
  const stopTail = await startJsonlTail(uuid, meta.worktree_path, runId, -1, bus, logPath);

  // STEP 10 — await session completion then stop tail
  const harnessResult = await sessionPromise;
  stopTail();
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

  // Structured adapters (claude-code) carry the parsed envelope; the downstream
  // classification path consumes it exactly as the SessionResult did before.
  if (!harnessResult.envelope) {
    await markFailed(
      runId,
      `harness '${adapter.name}' did not return a structured result (single-prompt requires structured mode)`,
      bus,
    );
    return { outcome: 'failed', reason: 'harness returned no structured envelope' };
  }
  const result = { envelope: harnessResult.envelope, exitCode: harnessResult.exitCode };

  // STEP 11 — classify envelope
  const classified = classifyEnvelope(result.envelope);

  if (classified.type === 'rate-limit') {
    // handleRateLimit calls updatePhase(runId, -1, ...) which is a no-op for single-prompt runs
    const { resumeAt, hadWork } = await handleRateLimit(result.envelope, runId, -1, bus);
    return { outcome: 'paused', resumeAt, hadWork };
  }

  if (classified.type === 'transient-error') {
    const retryCount = _retryCount + 1;
    if (retryCount > appConfig.max_retries) {
      await markFailed(runId, 'transient API error', bus);
      return { outcome: 'failed', reason: 'transient API error after retries' };
    }
    updateMeta(runId, { status: 'retrying' });
    await Bun.sleep(30_000);
    return runSinglePrompt(runId, appConfig, bus, retryCount);
  }

  if (classified.type === 'auth-error') {
    await markFailed(runId, 'auth error: ' + result.envelope.api_error_status, bus);
    return { outcome: 'failed', reason: 'auth error' };
  }

  if (classified.type === 'phase-failure') {
    const retryCount = _retryCount + 1;
    if (retryCount > appConfig.max_retries) {
      await markFailed(runId, classified.reason, bus);
      return { outcome: 'failed', reason: classified.reason };
    }
    updateMeta(runId, { status: 'retrying' });
    return runSinglePrompt(runId, appConfig, bus, retryCount);
  }

  // STEP 12 — success path: validate structured output
  const headAfter = getHead(meta.worktree_path);
  const promptResult = result.envelope.structured_output;

  if (!isSinglePromptResult(promptResult)) {
    const retryCount = _retryCount + 1;
    if (retryCount > appConfig.max_retries) {
      await markFailed(runId, 'invalid structured_output shape', bus);
      return { outcome: 'failed', reason: 'invalid structured_output shape' };
    }
    updateMeta(runId, { status: 'retrying' });
    return runSinglePrompt(runId, appConfig, bus, retryCount);
  }

  // STEP 13 — detect commit (compare HEAD before/after)
  let commitSha: string | undefined;
  if (promptResult.committed && headAfter === headBefore) {
    bus.emit({
      kind: 'error',
      timestamp: new Date(),
      runId,
      phaseNumber: -1,
      message: 'HEAD unchanged despite committed:true',
    });
    const retryCount = _retryCount + 1;
    if (retryCount > appConfig.max_retries) {
      await markFailed(runId, 'committed:true but HEAD unchanged', bus);
      return { outcome: 'failed', reason: 'committed:true but HEAD unchanged' };
    }
    updateMeta(runId, { status: 'retrying' });
    return runSinglePrompt(runId, appConfig, bus, retryCount);
  }
  if (promptResult.committed && headAfter !== headBefore) {
    commitSha = headAfter;
  }

  // STEP 14 — update metadata and emit result
  const status = promptResult.pr_created ? 'pr-created' : 'complete';
  updateMeta(runId, {
    status,
    total_cost_usd: result.envelope.total_cost_usd,
    ...(promptResult.pr_url ? { pr_url: promptResult.pr_url } : {}),
  });

  const okSummary = promptResult.pr_url
    ? 'PR opened: ' + promptResult.pr_url
    : promptResult.summary;

  bus.emit({
    kind: 'ok',
    timestamp: new Date(),
    runId,
    phaseNumber: -1,
    summary: okSummary,
    costUsd: result.envelope.total_cost_usd,
  });

  for (const blocker of promptResult.blockers ?? []) {
    bus.emit({ kind: 'error', timestamp: new Date(), runId, phaseNumber: -1, message: blocker });
  }

  void commitSha;

  return { outcome: 'complete', result: promptResult };
}

/** Build a stable signature for an activity event so repeats can be detected. */
function activitySignature(e: ActivityEvent): string {
  const r = e as unknown as Record<string, unknown>;
  const detail =
    (r['file'] as string) ??
    (r['command'] as string) ??
    (r['message'] as string) ??
    (r['text'] as string) ??
    (r['summary'] as string) ??
    (r['phaseName'] as string) ??
    '';
  return `${e.kind}:${detail}`;
}

/**
 * Bench path: run a single prompt against a fresh clone of the baseline, under an
 * activity-based timeout + manual-bail guard, then capture the result. No
 * retries, no structured-output requirement, no PR — the diff and outcome are
 * what matter. Clone is removed only on a clean completion; kept otherwise for
 * debugging.
 */
async function runBenchSinglePrompt(
  runId: string,
  meta: RunMeta,
  adapter: Harness,
  appConfig: AppConfig,
  bus: ActivityBus,
): Promise<SinglePromptOutcome> {
  const startTime = Date.now();

  // 1 — fresh clone of the baseline (CWD repo + current branch by default).
  let clone;
  try {
    clone = createClone(runId, { repo: meta.bench_repo, branch: meta.bench_branch });
  } catch (err) {
    const reason = `clone failed: ${err instanceof Error ? err.message : String(err)}`;
    await markFailed(runId, reason, bus);
    return { outcome: 'failed', reason };
  }

  updateMeta(runId, {
    isolation: 'clone',
    worktree_path: clone.path,
    bench_repo: clone.baseline.repo,
    bench_branch: clone.baseline.branch,
    base_ref: clone.baseRef,
    status: 'executing',
  });
  bus.emit({ kind: 'phase', timestamp: new Date(), runId, phaseNumber: -1, phaseName: 'bench' });

  // 2 — prompt file (reuse the single-prompt template + schema).
  const combined = SINGLE_PROMPT_TEMPLATE
    .replace('{{USER_PROMPT}}', meta.prompt ?? '')
    .replace('{{GITHUB_ISSUE_SECTION}}', '');
  const tmpFile = path.join(os.tmpdir(), `cpe-bench-${runId}.md`);
  fs.writeFileSync(tmpFile, combined);

  // 3 — provider env + model args.
  const provider = await resolveProvider(appConfig.providers ?? [], 'phase', appConfig.provider_for_phases);

  // 4 — activity-based timeout + bail guard; activity comes from the bus (the
  // same stream the live tail consumes), with repeat suppression in RunGuard.
  const guard = new RunGuard({
    inactivityMs: (appConfig.inactivity_timeout_seconds ?? 0) * 1000,
    maxRuntimeMs: (appConfig.max_runtime_seconds ?? 0) * 1000,
  });
  registerGuard(runId, guard);
  const unsub = bus.subscribe(e => {
    if (e.runId === runId) guard.noteActivity(activitySignature(e));
  });

  const logPath = path.join(getLogsDir(runId), 'bench.log');
  const uuid = crypto.randomUUID();

  // Kick off the harness first, then start the JSONL tail (it polls for the
  // session file the harness is creating) — same ordering as the non-bench
  // path. The guard's inactivity timer starts with the run.
  guard.start();
  const runPromise = adapter.run({
    cwd: clone.path,
    promptFile: tmpFile,
    sessionId: uuid,
    logPath,
    schema: SINGLE_PROMPT_RESULT_SCHEMA,
    dangerouslySkipPermissions: appConfig.dangerously_skip_permissions,
    providerEnv: provider?.env ?? {},
    modelArgs: provider?.modelArgs ?? [],
    signal: guard.signal,
  });
  const stopTail = await startJsonlTail(
    uuid, clone.path, runId, -1, bus, logPath,
    sig => guard.noteActivity(sig),
  );

  let result;
  try {
    result = await runPromise;
  } finally {
    stopTail();
    guard.dispose();
    unsub();
    unregisterGuard(runId);
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }

  const durationMs = Date.now() - startTime;
  const runOutcome = guard.outcome ?? result?.outcome ?? 'error';
  const outcomeReason =
    guard.reason === 'timeout-inactivity' ? 'no new output within inactivity window'
    : guard.reason === 'timeout-maxruntime' ? 'exceeded max runtime'
    : guard.reason === 'bailed' ? 'manually bailed'
    : undefined;

  // 5 — capture (diff/transcript/meta + optional harnesstests push) on any outcome.
  const cap = captureRun({
    runId,
    meta: readMeta(runId),
    cwd: clone.path,
    baseRef: clone.baseRef,
    result: result ?? { exitCode: -1, outcome: 'error' },
    outcome: runOutcome,
    outcomeReason,
    durationMs,
    transcriptPath: logPath,
  });

  const status =
    runOutcome === 'completed' ? 'complete'
    : runOutcome === 'timeout' ? 'timeout'
    : runOutcome === 'bailed' ? 'bailed'
    : 'failed';
  updateMeta(runId, {
    status,
    run_outcome: runOutcome,
    ...(outcomeReason ? { outcome_reason: outcomeReason } : {}),
    duration_ms: durationMs,
    results_dir: cap.resultsDir,
    total_cost_usd: result?.costUsd ?? 0,
  });

  if (runOutcome === 'timeout' || runOutcome === 'bailed' || runOutcome === 'error') {
    bus.emit({
      kind: 'error', timestamp: new Date(), runId, phaseNumber: -1,
      message: `bench ${runOutcome}${outcomeReason ? ': ' + outcomeReason : ''} (results: ${cap.resultsDir})`,
    });
  } else {
    bus.emit({
      kind: 'ok', timestamp: new Date(), runId, phaseNumber: -1,
      summary: `bench complete${cap.pushed ? ` — pushed ${cap.branch}` : ''} (results: ${cap.resultsDir})`,
      costUsd: result?.costUsd ?? 0,
    });
  }

  // 6 — keep the clone on failure/timeout/bail for debugging; remove on success.
  if (runOutcome === 'completed') {
    try { removeClone(clone.path); } catch { /* ignore */ }
  }

  return { outcome: 'bench', runOutcome, resultsDir: cap.resultsDir };
}
