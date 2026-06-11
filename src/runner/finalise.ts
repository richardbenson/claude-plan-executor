import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readMeta, updateMeta, getLogsDir } from '../storage/meta.js';
import { SUMMARISE_PROMPT } from '../prompts/index.js';
import { startOutputTail } from './output-tail.js';
import { resolveProvider } from './provider.js';
import { excludeCpeArtifacts } from './report.js';
import * as harnessRegistry from '../harness/registry.js';
import type { ActivityBus } from '../events/bus.js';
import type { AppConfig } from '../types/meta.js';

export interface FinaliseResult {
  prUrl: string;
}

export async function finaliseRun(runId: string, bus: ActivityBus, appConfig?: AppConfig): Promise<FinaliseResult> {
  updateMeta(runId, { status: 'finalising' });
  const meta = readMeta(runId);

  bus.emit({
    kind: 'phase',
    timestamp: new Date(),
    runId,
    phaseNumber: -1,
    phaseName: 'finalise',
  });

  // The summarise step writes docs/<plan>.md, deletes the plan folder, and (with
  // a remote) pushes + opens a PR. It runs through the SELECTED harness:
  //  - structured (claude-code): the existing schema-less `claude -p` spawn,
  //    kept byte-for-byte for the regression gate.
  //  - opaque: routed through the adapter (adapter.run with the raw prompt) so any
  //    harness/model can finalise. Success is verified from the filesystem below
  //    (summary doc present, plan folder gone), not a structured result.
  const harnessName = meta.harness ?? appConfig?.harness_for_phases ?? 'claude-code';
  const adapter = harnessRegistry.get(harnessName);

  const { plan_folder: planFolder = '', worktree_path: worktreePath } = meta;
  const featureBranch = meta.feature_branch;
  const targetBranch = meta.target_branch;
  const skipPushAndPr = !meta.remote;

  const prompt = SUMMARISE_PROMPT
    .replace(/PLAN_FOLDER/g, planFolder)
    .replace(/FEATURE_BRANCH/g, featureBranch)
    .replace(/TARGET_BRANCH/g, targetBranch)
    .replace(/SKIP_PUSH_AND_PR/g, skipPushAndPr ? 'true' : 'false');

  const logPath = path.join(getLogsDir(runId), 'finalise.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  const provider = appConfig
    ? await resolveProvider(appConfig.providers ?? [], 'phase', meta.provider ?? appConfig.provider_for_phases, meta.model)
    : null;

  let exitCode: number;
  if (adapter.completionMode === 'structured') {
    const tmpFile = path.join(os.tmpdir(), `cpe-summarise-${runId}.md`);
    fs.writeFileSync(tmpFile, prompt);
    const logFd = fs.openSync(logPath, 'w');
    const providerEnv = provider?.env ?? {};
    const spawnEnv = Object.keys(providerEnv).length > 0 ? { ...process.env, ...providerEnv } : undefined;
    const modelArgs = provider?.modelArgs ?? [];
    const proc = Bun.spawn(['claude', '-p', '--dangerously-skip-permissions', ...modelArgs], {
      cwd: worktreePath,
      stdin: fs.openSync(tmpFile, 'r'),
      stdout: logFd,
      stderr: logFd,
      ...(spawnEnv ? { env: spawnEnv } : {}),
    });
    exitCode = await proc.exited;
    try { fs.closeSync(logFd); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  } else {
    // Route the summarise step through the opaque harness. Tail the log into
    // the activity bus like phases do — without this the TUI goes silent for
    // the whole finalise even though the harness is working (observed on a pi
    // 31b run, 2026-06-11).
    excludeCpeArtifacts(worktreePath);
    const stopTail = startOutputTail(logPath, runId, -1, bus);
    try {
      const result = await adapter.run({
        cwd: worktreePath,
        prompt,
        sessionId: crypto.randomUUID(),
        logPath,
        dangerouslySkipPermissions: appConfig?.dangerously_skip_permissions,
        providerEnv: provider?.env ?? {},
        model: provider?.model ?? meta.model,
        modelArgs: provider?.modelArgs ?? [],
      });
      exitCode = result.exitCode;
    } finally {
      stopTail();
    }
  }

  if (exitCode !== 0) {
    bus.emit({
      kind: 'error',
      timestamp: new Date(),
      runId,
      phaseNumber: -1,
      message: `summarise (${adapter.name}) exited ${exitCode} — see ${logPath}`,
    });
  }

  const summaryFile = path.join(worktreePath, 'docs', planFolder + '.md');
  if (!fs.existsSync(summaryFile)) {
    bus.emit({
      kind: 'error',
      timestamp: new Date(),
      runId,
      phaseNumber: -1,
      message: `expected summary ${summaryFile} not found`,
    });
  }

  const planDir = path.join(worktreePath, 'docs', planFolder);
  if (fs.existsSync(planDir)) {
    bus.emit({
      kind: 'error',
      timestamp: new Date(),
      runId,
      phaseNumber: -1,
      message: `plan folder ${planDir} still exists after finalise`,
    });
  }

  const status = skipPushAndPr ? 'complete' : 'pr-created';
  updateMeta(runId, { status });

  bus.emit({
    kind: 'ok',
    timestamp: new Date(),
    runId,
    phaseNumber: -1,
    summary: skipPushAndPr ? 'run complete (no remote — skipped push/PR)' : 'finalise complete — see log for PR URL',
    costUsd: meta.total_cost_usd,
  });

  return { prUrl: '' };
}
