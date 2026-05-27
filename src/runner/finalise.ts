import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readMeta, updateMeta, getLogsDir } from '../storage/meta.js';
import { SUMMARISE_PROMPT } from '../prompts/index.js';
import { resolveProvider } from './provider.js';
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

  const { plan_folder: planFolder = '', worktree_path: worktreePath } = meta;
  const featureBranch = meta.feature_branch;
  const targetBranch = meta.target_branch;
  const skipPushAndPr = !meta.remote;

  const prompt = SUMMARISE_PROMPT
    .replace(/PLAN_FOLDER/g, planFolder)
    .replace(/FEATURE_BRANCH/g, featureBranch)
    .replace(/TARGET_BRANCH/g, targetBranch)
    .replace(/SKIP_PUSH_AND_PR/g, skipPushAndPr ? 'true' : 'false');

  const tmpFile = path.join(os.tmpdir(), `cpe-summarise-${runId}.md`);
  fs.writeFileSync(tmpFile, prompt);

  const logPath = path.join(getLogsDir(runId), 'finalise.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'w');

  const provider = appConfig
    ? await resolveProvider(appConfig.providers ?? [], 'phase', appConfig.provider_for_phases)
    : null;
  const providerEnv = provider?.env ?? {};
  const spawnEnv = Object.keys(providerEnv).length > 0
    ? { ...process.env, ...providerEnv }
    : undefined;
  const modelArgs = provider?.modelArgs ?? [];

  const proc = Bun.spawn(['claude', '-p', '--dangerously-skip-permissions', ...modelArgs], {
    cwd: worktreePath,
    stdin: fs.openSync(tmpFile, 'r'),
    stdout: logFd,
    stderr: logFd,
    ...(spawnEnv ? { env: spawnEnv } : {}),
  });
  const exitCode = await proc.exited;
  try { fs.closeSync(logFd); } catch { /* ignore */ }
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

  if (exitCode !== 0) {
    bus.emit({
      kind: 'error',
      timestamp: new Date(),
      runId,
      phaseNumber: -1,
      message: `claude -p exited ${exitCode} — see ${logPath}`,
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
