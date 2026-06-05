import * as fs from 'fs';
import * as path from 'path';
import { buildSummarizePrompt } from '../prompts/index.js';
import type { ClaudeEnvelope } from './envelope.js';

/*
 * Harness-neutral phase result ("PhaseReport"). claude-code maps its JSON
 * envelope's structured_output into this; opaque harnesses (which only give an
 * exit code + a git diff) produce it via a hybrid acquisition: an agent-written
 * self-report file, else a summarization pass, else git-derived. This lets the
 * phase loop and single-prompt path consume one shape regardless of harness.
 */

/** The structured result every harness must ultimately yield for a phase/task. */
export interface PhaseReport {
  /** True if the stated goal was fully achieved. */
  completed: boolean;
  /** True if a git commit was made. */
  committed: boolean;
  /** Commit message used, if any. */
  commit_message?: string | null;
  /** One–two sentence human-readable description of what changed. */
  summary: string;
  /** Info the next phase should know (multi-phase runs). */
  notes_for_next_phase?: string;
  /** Anything that prevented full completion. */
  blockers: string[];
  /** Single-prompt only: whether a PR was opened. */
  pr_created?: boolean;
  /** Single-prompt only: the opened PR URL. */
  pr_url?: string | null;
}

/** Where an opaque agent is asked to write its self-report (relative to the worktree). */
export const CPE_RESULT_REL = path.join('.cpe', 'result.json');

/** Loose shape check: the three fields every report variant requires. */
export function isReportShape(v: unknown): v is { completed: boolean; committed: boolean; summary: string } {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r['completed'] === 'boolean' &&
    typeof r['committed'] === 'boolean' &&
    typeof r['summary'] === 'string';
}

/** Coerce a validated raw object into a fully-defaulted PhaseReport. */
export function normalizeReport(raw: Record<string, unknown>): PhaseReport {
  const blockers = Array.isArray(raw['blockers'])
    ? (raw['blockers'] as unknown[]).filter((b): b is string => typeof b === 'string')
    : [];
  const report: PhaseReport = {
    completed: raw['completed'] === true,
    committed: raw['committed'] === true,
    summary: typeof raw['summary'] === 'string' ? (raw['summary'] as string) : '',
    blockers,
  };
  if (typeof raw['commit_message'] === 'string') report.commit_message = raw['commit_message'] as string;
  if (typeof raw['notes_for_next_phase'] === 'string') report.notes_for_next_phase = raw['notes_for_next_phase'] as string;
  if (typeof raw['pr_created'] === 'boolean') report.pr_created = raw['pr_created'] as boolean;
  if (typeof raw['pr_url'] === 'string') report.pr_url = raw['pr_url'] as string;
  return report;
}

/** Map a structured claude envelope's `structured_output` to a PhaseReport (null if the shape is wrong). */
export function reportFromEnvelope(envelope: ClaudeEnvelope): PhaseReport | null {
  const out = envelope.structured_output;
  if (!isReportShape(out)) return null;
  return normalizeReport(out as Record<string, unknown>);
}

/** Keep cpe's own `.cpe/` working dir out of commits/diffs (local-only exclude; mirrors aider's helper). */
export function excludeCpeArtifacts(cwd: string): void {
  try {
    const excludePath = path.join(cwd, '.git', 'info', 'exclude');
    let body = '';
    try { body = fs.readFileSync(excludePath, 'utf8'); } catch { /* not created yet */ }
    if (body.split('\n').some(l => l.trim() === '.cpe/')) return;
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    fs.appendFileSync(excludePath, `${body && !body.endsWith('\n') ? '\n' : ''}.cpe/\n`);
  } catch {
    /* best effort — for worktrees without a standard .git/info, the file is just deleted after reading */
  }
}

/**
 * Read + validate the agent's self-report at `<worktree>/.cpe/result.json`, then
 * delete it (so it never pollutes the tree). Returns null when the file is
 * missing or invalid (caller falls back to summarize/git).
 */
export function readSelfReport(worktree: string): PhaseReport | null {
  const file = path.join(worktree, CPE_RESULT_REL);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  // Always remove it once we've read it — it is a transport file, not an artifact.
  try { fs.rmSync(path.join(worktree, '.cpe'), { recursive: true, force: true }); } catch { /* ignore */ }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!isReportShape(parsed)) return null;
  return normalizeReport(parsed as Record<string, unknown>);
}

function git(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(['git', ...args], { cwd });
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : '';
}

/** True when the working tree has any change (tracked or untracked) vs HEAD. */
function hasChanges(cwd: string): boolean {
  const proc = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd });
  return proc.exitCode === 0 && proc.stdout.toString().trim().length > 0;
}

/**
 * Last-resort report derived purely from git + the exit code, for when the agent
 * wrote no self-report and summarization is unavailable/failed:
 *   completed = exit 0 AND something changed; committed = HEAD advanced.
 * Summary is the diffstat against the pre-run HEAD; blockers carries a non-zero exit.
 */
export function gitDerivedReport(worktree: string, headBefore: string, exitCode: number): PhaseReport {
  const headAfter = git(['rev-parse', 'HEAD'], worktree) || headBefore;
  const committed = headAfter !== '' && headAfter !== headBefore;
  const changed = committed || hasChanges(worktree);
  const stat = git(['diff', '--stat', headBefore], worktree);
  const lastLine = stat ? stat.split('\n').filter(Boolean).pop() ?? '' : '';
  const summary = changed
    ? (lastLine ? `Changes: ${lastLine.trim()}` : 'Working tree changed (no diffstat available).')
    : 'No changes were made.';
  return {
    completed: exitCode === 0 && changed,
    committed,
    commit_message: null,
    summary,
    blockers: exitCode === 0 ? [] : [`harness exited with code ${exitCode}`],
    notes_for_next_phase: '',
  };
}

/** Extract a PhaseReport from a model's free-text response (tolerant of fences/prose). */
export function parseSummaryReport(text: string): PhaseReport | null {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(s.slice(start, end + 1)); } catch { return null; }
  if (!isReportShape(parsed)) return null;
  return normalizeReport(parsed as Record<string, unknown>);
}

/** OpenAI-compatible chat base (`<ANTHROPIC_BASE_URL>/v1`) for the summarization call. */
function chatBaseUrl(providerEnv: Record<string, string>): string | null {
  const base = providerEnv['ANTHROPIC_BASE_URL'];
  if (!base) return null;
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/**
 * Fallback report generation: ask the configured model (via the provider's
 * OpenAI-compatible chat endpoint) to summarize the run from its git diff +
 * transcript into a PhaseReport. Used only when the agent wrote no valid
 * self-report. Returns null on any failure (caller then falls back to git).
 */
export async function summarizeReport(opts: {
  worktree: string;
  headBefore: string;
  transcriptPath: string;
  providerEnv: Record<string, string>;
  model?: string;
}): Promise<PhaseReport | null> {
  const base = chatBaseUrl(opts.providerEnv);
  if (!base || !opts.model) return null;

  const diff = git(['diff', opts.headBefore], opts.worktree);
  let transcript = '';
  try { transcript = fs.readFileSync(opts.transcriptPath, 'utf8'); } catch { /* none */ }
  const prompt = buildSummarizePrompt(diff, transcript);
  const key = opts.providerEnv['ANTHROPIC_AUTH_TOKEN'] ?? opts.providerEnv['ANTHROPIC_API_KEY'];

  // Bound the call: a slow/hung summarizer must not stall the run — on timeout we
  // abort and the caller falls back to the git-derived report. The default is
  // generous because this is the rescue path for exactly the slow/weak local
  // models that skip the self-report; override with CPE_SUMMARIZE_TIMEOUT_MS.
  const timeoutMs = Number(process.env['CPE_SUMMARIZE_TIMEOUT_MS']) || 180_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        temperature: 0,
        max_tokens: 800,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json() as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    return parseSummaryReport(content);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type ReportSource = 'self-report' | 'summarize' | 'git';

/**
 * Acquire a PhaseReport for an opaque harness run via the hybrid strategy:
 * agent self-report → summarization pass → git-derived. `summarize` is optional
 * (wired in Phase C); when omitted the order is self-report → git.
 */
export async function acquireReport(opts: {
  worktree: string;
  headBefore: string;
  exitCode: number;
  summarize?: () => Promise<PhaseReport | null> | PhaseReport | null;
}): Promise<{ report: PhaseReport; source: ReportSource }> {
  const self = readSelfReport(opts.worktree);
  if (self) return { report: self, source: 'self-report' };

  if (opts.summarize) {
    try {
      const summarized = await opts.summarize();
      if (summarized) return { report: summarized, source: 'summarize' };
    } catch {
      /* fall through to git-derived */
    }
  }

  return { report: gitDerivedReport(opts.worktree, opts.headBefore, opts.exitCode), source: 'git' };
}
