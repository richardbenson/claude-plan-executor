import * as path from 'path';
import { readMeta, updateMeta, updatePhase, getLogsDir } from '../storage/meta.js';
import { runSession } from './session.js';
import { classifyEnvelope } from './envelope.js';
import { handleRateLimit } from './limit.js';
import { startJsonlTail } from './jsonl-tail.js';
import { getHead } from '../git/repo.js';
import { PHASE_RESULT_SCHEMA } from '../prompts/index.js';
import type { ActivityBus } from '../events/bus.js';
import type { AppConfig, PhaseEntry } from '../types/meta.js';

export interface PhaseResult {
  completed: boolean;
  committed: boolean;
  commit_message: string | null;
  summary: string;
  blockers?: string[];
  notes_for_next_phase?: string;
}

export type PhaseOutcome =
  | { outcome: 'complete'; result: PhaseResult }
  | { outcome: 'paused'; resumeAt: Date; hadWork: boolean }
  | { outcome: 'failed'; reason: string };

function isPhaseResult(v: unknown): v is PhaseResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r['completed'] === 'boolean' &&
    typeof r['committed'] === 'boolean' &&
    typeof r['summary'] === 'string';
}

async function markPhaseFailed(
  runId: string,
  phaseNumber: number,
  reason: string,
  bus: ActivityBus,
): Promise<void> {
  updatePhase(runId, phaseNumber, { status: 'failed' });
  updateMeta(runId, { status: 'failed' });
  bus.emit({
    kind: 'error',
    timestamp: new Date(),
    runId,
    phaseNumber,
    message: reason,
  });
}

export async function runPhase(
  runId: string,
  phaseNumber: number,
  appConfig: AppConfig,
  bus: ActivityBus,
): Promise<PhaseOutcome> {
  // STEP 1 — assert not in paused state
  const meta = readMeta(runId);
  if (meta.status === 'paused-limit') {
    throw new Error('runPhase called while run is paused-limit; caller must wait first');
  }

  // STEP 2 — set phase + run executing
  const phaseEntry = (meta.phases ?? []).find(p => p.number === phaseNumber);
  if (!phaseEntry) {
    throw new Error(`Phase ${phaseNumber} not found in run ${runId}`);
  }
  updateMeta(runId, { status: 'executing' });
  updatePhase(runId, phaseNumber, { status: 'executing', started_at: new Date().toISOString() });
  bus.emit({
    kind: 'phase',
    timestamp: new Date(),
    runId,
    phaseNumber,
    phaseName: phaseEntry.prompt_file.replace('PHASE_', '').replace('.prompt.md', ''),
  });

  // STEP 3 — capture HEAD before
  const headBefore = getHead(meta.worktree_path);
  updatePhase(runId, phaseNumber, { head_before: headBefore });

  // STEP 4 — pre-allocate session UUID
  const uuid = crypto.randomUUID();
  updatePhase(runId, phaseNumber, { session_id: uuid });

  // STEP 5 — spawn session and start JSONL tail concurrently so the tail
  // finds the file shortly after Claude creates it, not before
  const promptFile = path.join(meta.worktree_path, 'docs', meta.plan_folder ?? '', phaseEntry.prompt_file);
  const logPath = path.join(getLogsDir(runId), 'phase-' + String(phaseNumber).padStart(2, '0') + '.log');
  const sessionPromise = runSession({
    worktreePath: meta.worktree_path,
    promptFile,
    sessionId: uuid,
    logPath,
    schema: PHASE_RESULT_SCHEMA,
    dangerouslySkipPermissions: appConfig.dangerously_skip_permissions,
  });

  // STEP 6 — start JSONL tail (Claude is already starting; file appears within seconds)
  const stopTail = await startJsonlTail(uuid, meta.worktree_path, runId, phaseNumber, bus);

  // STEP 7 — await session completion then stop tail
  const result = await sessionPromise;
  stopTail();

  // STEP 8 — classify envelope
  const classified = classifyEnvelope(result.envelope);

  if (classified.type === 'rate-limit') {
    const { resumeAt, hadWork } = await handleRateLimit(result.envelope, runId, phaseNumber, bus);
    return { outcome: 'paused', resumeAt, hadWork };
  }

  if (classified.type === 'transient-error') {
    const fresh = readMeta(runId);
    const entry = (fresh.phases ?? []).find(p => p.number === phaseNumber)!;
    const retryCount = entry.retry_count + 1;
    if (retryCount > appConfig.max_retries) {
      await markPhaseFailed(runId, phaseNumber, 'transient API error', bus);
      return { outcome: 'failed', reason: 'transient API error after retries' };
    }
    await updatePhase(runId, phaseNumber, { status: 'retrying', retry_count: retryCount });
    await Bun.sleep(30_000);
    return runPhase(runId, phaseNumber, appConfig, bus);
  }

  if (classified.type === 'auth-error') {
    await markPhaseFailed(runId, phaseNumber, 'auth error: ' + result.envelope.api_error_status, bus);
    return { outcome: 'failed', reason: 'auth error' };
  }

  if (classified.type === 'phase-failure') {
    const fresh = readMeta(runId);
    const entry = (fresh.phases ?? []).find(p => p.number === phaseNumber)!;
    const retryCount = entry.retry_count + 1;
    if (retryCount > appConfig.max_retries) {
      await markPhaseFailed(runId, phaseNumber, classified.reason, bus);
      return { outcome: 'failed', reason: classified.reason };
    }
    await updatePhase(runId, phaseNumber, { status: 'retrying', retry_count: retryCount });
    return runPhase(runId, phaseNumber, appConfig, bus);
  }

  // STEP 9 — cross-check HEAD (success path)
  const headAfter = getHead(meta.worktree_path);
  const phaseResult = result.envelope.structured_output;

  if (!isPhaseResult(phaseResult)) {
    const fresh = readMeta(runId);
    const entry = (fresh.phases ?? []).find(p => p.number === phaseNumber)!;
    const retryCount = entry.retry_count + 1;
    if (retryCount > appConfig.max_retries) {
      await markPhaseFailed(runId, phaseNumber, 'invalid structured_output shape', bus);
      return { outcome: 'failed', reason: 'invalid structured_output shape' };
    }
    await updatePhase(runId, phaseNumber, { status: 'retrying', retry_count: retryCount });
    return runPhase(runId, phaseNumber, appConfig, bus);
  }

  let commitSha: string | undefined;
  if (phaseResult.committed && headAfter === headBefore) {
    // Claude misreported committed:true but HEAD didn't change
    const fresh = readMeta(runId);
    const entry = (fresh.phases ?? []).find(p => p.number === phaseNumber)!;
    const retryCount = entry.retry_count + 1;
    bus.emit({
      kind: 'error',
      timestamp: new Date(),
      runId,
      phaseNumber,
      message: `HEAD unchanged despite committed:true for phase ${phaseNumber}`,
    });
    if (retryCount > appConfig.max_retries) {
      await markPhaseFailed(runId, phaseNumber, 'committed:true but HEAD unchanged', bus);
      return { outcome: 'failed', reason: 'committed:true but HEAD unchanged' };
    }
    await updatePhase(runId, phaseNumber, { status: 'retrying', retry_count: retryCount });
    return runPhase(runId, phaseNumber, appConfig, bus);
  }
  if (phaseResult.committed && headAfter !== headBefore) {
    commitSha = headAfter;
  }

  // STEP 10 — mark complete
  await updatePhase(runId, phaseNumber, {
    status: 'complete',
    completed_at: new Date().toISOString(),
    commit_sha: commitSha,
    summary: phaseResult.summary,
    commit_message: phaseResult.commit_message ?? undefined,
    notes_for_next_phase: phaseResult.notes_for_next_phase ?? '',
    blockers: phaseResult.blockers ?? [],
    cost_usd: result.envelope.total_cost_usd,
    tokens: result.envelope.usage,
  });

  const freshMeta = readMeta(runId);
  const totalCost = (freshMeta.phases ?? []).reduce((sum, p) => sum + (p.cost_usd ?? 0), 0);
  await updateMeta(runId, { total_cost_usd: totalCost });

  bus.emit({
    kind: 'ok',
    timestamp: new Date(),
    runId,
    phaseNumber,
    summary: phaseResult.summary,
    costUsd: result.envelope.total_cost_usd,
  });

  return { outcome: 'complete', result: phaseResult };
}

export async function resumeOrRestart(
  runId: string,
  phaseNumber: number,
  appConfig: AppConfig,
  bus: ActivityBus,
): Promise<PhaseOutcome> {
  const meta = readMeta(runId);
  const entry = (meta.phases ?? []).find(p => p.number === phaseNumber);
  if (!entry) {
    throw new Error(`Phase ${phaseNumber} not found in run ${runId}`);
  }

  // Clear paused-limit status since we're past the limit window
  if (meta.status === 'paused-limit') {
    updateMeta(runId, { status: 'executing' });
  }

  const hadWork = (entry.tokens?.input_tokens ?? 0) > 0 || (entry.cost_usd ?? 0) > 0;

  if (!hadWork) {
    return runPhase(runId, phaseNumber, appConfig, bus);
  }

  // Resume the captured session
  const schema = PHASE_RESULT_SCHEMA;
  const continuationPrompt =
    'You were interrupted by a rate limit. Continue from where you left off. ' +
    'Some tool calls may have completed partially — verify the state of the working tree before ' +
    're-running anything. When done, emit your final JSON per the schema.';

  const tmpFile = path.join(import.meta.dir, '..', '..', 'tmp', `resume-${runId}-${phaseNumber}.txt`);
  const tmpDir = path.dirname(tmpFile);
  const { mkdirSync, writeFileSync, unlinkSync } = await import('fs');
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpFile, continuationPrompt);

  const logPath = path.join(
    getLogsDir(runId),
    'phase-' + String(phaseNumber).padStart(2, '0') + '-resume.log',
  );
  const { createWriteStream } = await import('fs');
  const logStream = createWriteStream(logPath, { flags: 'a' });

  const proc = Bun.spawn(
    [
      'claude',
      '--resume',
      entry.session_id!,
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      schema,
    ],
    {
      cwd: meta.worktree_path,
      stdin: Bun.file(tmpFile),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  const stderrDone = (async () => {
    for await (const chunk of proc.stderr) {
      logStream.write(chunk);
    }
  })();

  const stdoutBuffer = await new Response(proc.stdout).arrayBuffer();
  const exitCode = await proc.exited;
  await stderrDone;

  await new Promise<void>((resolve, reject) => {
    logStream.close(err => (err ? reject(err) : resolve()));
  });

  try { unlinkSync(tmpFile); } catch { /* ignore */ }

  const stdout = new TextDecoder().decode(stdoutBuffer);
  const { parseEnvelope } = await import('./envelope.js');
  let envelope;
  try {
    envelope = parseEnvelope(stdout);
  } catch {
    envelope = {
      is_error: true,
      api_error_status: null,
      terminal_reason: 'parse-error',
      stop_reason: 'unknown',
      result: stdout.slice(0, 500),
      structured_output: null,
      session_id: entry.session_id!,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };
  }

  // Temporarily store resume result and delegate to the normal classify path
  // by injecting a fake session result into runPhase logic inline
  const classified = classifyEnvelope(envelope);

  if (classified.type === 'rate-limit') {
    const { handleRateLimit: rl } = await import('./limit.js');
    const { resumeAt, hadWork: hw } = await rl(envelope, runId, phaseNumber, bus);
    return { outcome: 'paused', resumeAt, hadWork: hw };
  }

  if (classified.type === 'auth-error') {
    await markPhaseFailed(runId, phaseNumber, 'auth error: ' + envelope.api_error_status, bus);
    return { outcome: 'failed', reason: 'auth error' };
  }

  if (classified.type === 'transient-error' || classified.type === 'phase-failure') {
    const freshMeta = readMeta(runId);
    const freshEntry = (freshMeta.phases ?? []).find(p => p.number === phaseNumber)!;
    const retryCount = freshEntry.retry_count + 1;
    const reason = classified.type === 'phase-failure' ? classified.reason : 'transient API error';
    if (retryCount > appConfig.max_retries) {
      await markPhaseFailed(runId, phaseNumber, reason, bus);
      return { outcome: 'failed', reason };
    }
    await updatePhase(runId, phaseNumber, { status: 'retrying', retry_count: retryCount });
    if (classified.type === 'transient-error') await Bun.sleep(30_000);
    return runPhase(runId, phaseNumber, appConfig, bus);
  }

  // success — process same as runPhase step 9-10
  const headBefore = ((readMeta(runId).phases ?? []).find(p => p.number === phaseNumber)?.head_before) ?? '';
  const headAfter = getHead(meta.worktree_path);
  const phaseResult = envelope.structured_output;

  if (!isPhaseResult(phaseResult)) {
    await markPhaseFailed(runId, phaseNumber, 'invalid structured_output shape after resume', bus);
    return { outcome: 'failed', reason: 'invalid structured_output shape after resume' };
  }

  let commitSha: string | undefined;
  if (phaseResult.committed && headAfter === headBefore) {
    await markPhaseFailed(runId, phaseNumber, 'committed:true but HEAD unchanged after resume', bus);
    return { outcome: 'failed', reason: 'committed:true but HEAD unchanged after resume' };
  }
  if (phaseResult.committed && headAfter !== headBefore) {
    commitSha = headAfter;
  }

  await updatePhase(runId, phaseNumber, {
    status: 'complete',
    completed_at: new Date().toISOString(),
    commit_sha: commitSha,
    summary: phaseResult.summary,
    commit_message: phaseResult.commit_message ?? undefined,
    notes_for_next_phase: phaseResult.notes_for_next_phase ?? '',
    blockers: phaseResult.blockers ?? [],
    cost_usd: envelope.total_cost_usd,
    tokens: envelope.usage,
  });

  const freshMetaFinal = readMeta(runId);
  const totalCost = (freshMetaFinal.phases ?? []).reduce((s, p) => s + (p.cost_usd ?? 0), 0);
  await updateMeta(runId, { total_cost_usd: totalCost });

  bus.emit({
    kind: 'ok',
    timestamp: new Date(),
    runId,
    phaseNumber,
    summary: phaseResult.summary,
    costUsd: envelope.total_cost_usd,
  });

  return { outcome: 'complete', result: phaseResult };
}

// Fix for issue #23: resumeOrRestart now clears paused-limit status before attempting
// to run the phase. This ensures that when a run resumes after the rate limit window
// opens, it doesn't fail with "runPhase called while run is paused-limit".
