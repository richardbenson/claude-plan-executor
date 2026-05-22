import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readMeta, updateMeta, getLogsDir } from '../storage/meta.js';
import { runSession } from './session.js';
import { classifyEnvelope } from './envelope.js';
import { handleRateLimit } from './limit.js';
import { startJsonlTail } from './jsonl-tail.js';
import { getHead } from '../git/repo.js';
import { SINGLE_PROMPT_TEMPLATE, SINGLE_PROMPT_RESULT_SCHEMA } from '../prompts/index.js';
import { isGitHub, isGitea } from '../vcs/detect.js';
import { createGitHubPr } from '../vcs/github.js';
import { createGiteaPr } from '../vcs/gitea.js';
import type { ActivityBus } from '../events/bus.js';
import type { AppConfig } from '../types/meta.js';

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
  | { outcome: 'failed'; reason: string };

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

  // STEP 2 — inject user prompt into template
  const combined = SINGLE_PROMPT_TEMPLATE.replace('{{USER_PROMPT}}', meta.prompt);

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
  const sessionPromise = runSession({
    worktreePath: meta.worktree_path,
    promptFile: tmpFile,
    sessionId: uuid,
    logPath,
    schema: SINGLE_PROMPT_RESULT_SCHEMA,
    dangerouslySkipPermissions: appConfig.dangerously_skip_permissions,
  });

  // STEP 9 — start JSONL tail for activity feed
  const stopTail = await startJsonlTail(uuid, meta.worktree_path, runId, -1, bus);

  // STEP 10 — await session completion then stop tail
  const result = await sessionPromise;
  stopTail();
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

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

  // STEP 14 — update metadata with completion status
  updateMeta(runId, {
    status: 'complete',
    total_cost_usd: result.envelope.total_cost_usd,
  });

  bus.emit({
    kind: 'ok',
    timestamp: new Date(),
    runId,
    phaseNumber: -1,
    summary: promptResult.summary,
    costUsd: result.envelope.total_cost_usd,
  });

  // STEP 15 — skip push/PR if no remote configured
  if (!meta.remote) {
    return { outcome: 'complete', result: promptResult };
  }

  // STEP 16 — push to remote
  const pushProc = Bun.spawnSync(
    ['git', 'push', '-u', 'origin', meta.feature_branch],
    { cwd: meta.worktree_path },
  );
  if (pushProc.exitCode !== 0) {
    await markFailed(runId, `git push failed: ${pushProc.stderr.toString().trim()}`, bus);
    return { outcome: 'failed', reason: 'push failed' };
  }

  // STEP 17 — create PR using existing VCS integration
  let prResult: { url: string };
  try {
    if (isGitHub(meta.remote)) {
      prResult = await createGitHubPr(meta.worktree_path, meta.feature_branch, meta.target_branch);
    } else if (isGitea(meta.remote)) {
      prResult = await createGiteaPr(
        meta.worktree_path,
        meta.feature_branch,
        meta.target_branch,
        meta.remote,
      );
    } else {
      throw new Error('Unsupported VCS host: ' + (meta.remote.host ?? 'unknown'));
    }
  } catch (err) {
    await markFailed(runId, `PR creation failed: ${String(err)}`, bus);
    return { outcome: 'failed', reason: 'PR creation failed' };
  }

  // STEP 18 — update metadata with PR URL
  updateMeta(runId, { status: 'pr-created', pr_url: prResult.url });

  // STEP 19 — emit final ok event with PR URL
  bus.emit({
    kind: 'ok',
    timestamp: new Date(),
    runId,
    phaseNumber: -1,
    summary: 'PR opened: ' + prResult.url,
    costUsd: result.envelope.total_cost_usd,
  });

  // commitSha unused for now — available for future phases to surface in TUI
  void commitSha;

  return {
    outcome: 'complete',
    result: { ...promptResult, pr_url: prResult.url, pr_created: true },
  };
}
