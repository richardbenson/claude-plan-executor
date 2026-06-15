import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { RunMeta, TokenUsage, TokenSource } from '../types/meta.js';
import type { HarnessResult } from '../harness/types.js';

/** Base dir for captured bench results, alongside the worktree/clone convention. */
export const RESULTS_BASE: string = path.join(
  os.homedir(),
  '.local',
  'state',
  'cpe',
  'results',
);

/** Slugify a model id so it is filesystem- and git-ref-safe (`:` and `/` -> `-`). */
export function slugifyModel(model: string): string {
  return model.replace(/[:/]/g, '-');
}

/** The `<harness>__<model>` combo key used for result dirs and branch names. */
export function comboName(harness: string, model: string): string {
  return `${harness}__${slugifyModel(model)}`;
}

export function getResultsDir(combo: string): string {
  return path.join(RESULTS_BASE, combo);
}

function git(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(['git', ...args], { cwd });
  return {
    ok: proc.exitCode === 0,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString().trim(),
  };
}

export interface CaptureInput {
  runId: string;
  meta: RunMeta;
  /** The clone (or worktree) the run executed in. */
  cwd: string;
  /** Commit the clone started at; diffs are computed against this. */
  baseRef: string;
  result: HarnessResult;
  outcome: RunMeta['run_outcome'];
  outcomeReason?: string;
  durationMs: number;
  /** Path to the run transcript/log to archive. */
  transcriptPath?: string;
  /** Gateway-collected token totals; override the adapter's own (LiteLLM spend logs). */
  tokens?: TokenUsage;
  /** Where the recorded tokens came from (litellm vs adapter parsing). */
  tokenSource?: TokenSource;
}

export interface CaptureResult {
  resultsDir: string;
  pushed: boolean;
  branch?: string;
}

/**
 * Capture a finished run: compute the diff against the baseline, archive the
 * transcript, write a structured meta.json, and — if the baseline repo has a
 * remote — commit and push a `harnesstests/<combo>` branch. With no remote, we
 * capture locally and skip the push (never error).
 */
export function captureRun(input: CaptureInput): CaptureResult {
  const { meta, cwd, baseRef, result } = input;
  const harness = meta.harness ?? 'claude-code';
  const model = meta.model ?? 'unknown';
  const combo = comboName(harness, model);
  const resultsDir = getResultsDir(combo);
  fs.mkdirSync(resultsDir, { recursive: true });

  // Stage everything (the clone is disposable) so new/untracked files show in the
  // diff too, then compute the full diff + stat against the baseline commit.
  git(['add', '-A'], cwd);
  const diff = git(['diff', '--cached', baseRef], cwd);
  const stat = git(['diff', '--cached', '--stat', baseRef], cwd);
  fs.writeFileSync(path.join(resultsDir, 'diff'), diff.ok ? diff.stdout : `(git diff failed: ${diff.stderr})\n`);

  // Archive the transcript if present.
  let transcript = '';
  if (input.transcriptPath && fs.existsSync(input.transcriptPath)) {
    try {
      transcript = fs.readFileSync(input.transcriptPath, 'utf8');
    } catch { /* ignore */ }
  }
  fs.writeFileSync(path.join(resultsDir, 'transcript'), transcript);

  // Optionally push a harnesstests branch to the baseline repo's remote.
  let pushed = false;
  let branch: string | undefined;
  if (meta.remote) {
    branch = `harnesstests/${combo}`;
    pushed = pushHarnessBranch(cwd, meta.bench_repo, branch);
  }

  const summary = {
    run_id: input.runId,
    harness,
    model,
    provider: meta.provider,
    isolation: meta.isolation ?? 'worktree',
    baseline: {
      repo: meta.bench_repo,
      branch: meta.bench_branch,
      base_ref: baseRef,
    },
    outcome: input.outcome,
    outcome_reason: input.outcomeReason,
    duration_ms: input.durationMs,
    exit_code: result.exitCode,
    tokens: input.tokens ?? result.tokens,
    token_source: input.tokenSource ?? (input.tokens ? 'litellm' : result.tokens ? 'adapter' : undefined),
    cost_usd: result.costUsd,
    diffstat: stat.ok ? stat.stdout.trim() : null,
    branch_pushed: pushed ? branch : null,
    captured_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(resultsDir, 'meta.json'), JSON.stringify(summary, null, 2) + '\n');

  return { resultsDir, pushed, branch };
}

/**
 * Commit the clone's current state onto `branch` and push it to the baseline
 * repo's remote. The clone's `origin` is the local source repo, so we resolve
 * the *real* remote URL from the baseline repo and push there. Returns false
 * (without throwing) if anything is missing — push is best-effort.
 */
function pushHarnessBranch(clonePath: string, benchRepo: string | undefined, branch: string): boolean {
  if (!benchRepo) return false;
  const remoteUrl = git(['remote', 'get-url', 'origin'], benchRepo);
  if (!remoteUrl.ok) return false;
  const url = remoteUrl.stdout.trim();
  if (!url) return false;

  // Create/replace the branch at the clone's current state and stage any work.
  if (!git(['checkout', '-B', branch], clonePath).ok) return false;
  git(['add', '-A'], clonePath);
  // Commit if there's anything to commit (ignore "nothing to commit").
  git(['commit', '-m', `bench: ${branch}`, '--allow-empty'], clonePath);

  // Point a dedicated remote at the real host and push.
  git(['remote', 'remove', 'bench-origin'], clonePath); // ignore if absent
  if (!git(['remote', 'add', 'bench-origin', url], clonePath).ok) return false;
  const push = git(['push', '--force', '-u', 'bench-origin', branch], clonePath);
  return push.ok;
}
