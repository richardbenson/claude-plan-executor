import * as fs from 'fs';
import * as path from 'path';
import { ulid } from 'ulid';
import { getPrimaryRepo, getCurrentBranch, getRemote } from '../git/repo.js';
import { readConfig } from '../storage/config.js';
import { writeMeta } from '../storage/meta.js';
import { enqueue } from '../storage/queue.js';
import * as harnessRegistry from '../harness/registry.js';
import { ensureHarnessDetection, assertHarnessInstalled } from '../harness/detect.js';
import { comboName, getResultsDir, RESULTS_BASE } from '../runner/capture.js';
import type { RunMeta } from '../types/meta.js';

export interface BenchOptions {
  harness?: string;
  model?: string;
  provider?: string;
  repo?: string;
  branch?: string;
  promptFile?: string;
  force?: boolean;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function splitList(s?: string): string[] {
  return (s ?? '').split(',').map(x => x.trim()).filter(Boolean);
}

const GAP = '  ';
function pad(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)),
  );
  const fmt = (cells: string[]) => cells.map((c, i) => pad(c, widths[i]!)).join(GAP).trimEnd();
  console.log(fmt(headers));
  console.log('-'.repeat(widths.reduce((s, w) => s + w + GAP.length, 0) - GAP.length));
  for (const r of rows) console.log(fmt(r));
}

/**
 * `cpe bench` — enqueue the harness×model cross-product of one prompt as
 * clone-isolated single-prompt runs. Baseline defaults to the CWD repo at its
 * current branch (overridable via --repo/--branch). Validates all harnesses up
 * front and enqueues nothing if any is unknown.
 */
export async function benchCommand(text: string[], options?: BenchOptions): Promise<void> {
  // 1 — resolve the prompt (args, --prompt-file, or stdin), mirroring `cpe prompt`.
  let prompt: string;
  if (options?.promptFile) {
    try {
      prompt = fs.readFileSync(options.promptFile, 'utf8').trim();
    } catch (err) {
      console.error(`Cannot read --prompt-file: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else if (text.length > 0) {
    prompt = text.join(' ').trim();
  } else if (!process.stdin.isTTY) {
    prompt = await readStdin();
  } else {
    console.error('Provide a prompt as arguments, --prompt-file <path>, or via stdin.');
    process.exit(1);
  }
  if (!prompt) {
    console.error('Prompt cannot be empty.');
    process.exit(1);
  }

  // 2 — harness list (default claude-code); validate ALL before enqueueing anything:
  // registered AND installed (detect once if the cache is absent — first-launch hook).
  const harnesses = splitList(options?.harness);
  if (harnesses.length === 0) harnesses.push('claude-code');
  const benchConfig = ensureHarnessDetection(readConfig());
  for (const h of harnesses) {
    try {
      harnessRegistry.get(h);
      assertHarnessInstalled(benchConfig, h);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      console.error('No runs enqueued.');
      process.exit(1);
    }
  }

  // 3 — model list (required, comma-separated).
  const models = splitList(options?.model);
  if (models.length === 0) {
    console.error('At least one --model is required (comma-separated).');
    process.exit(1);
  }

  // 4 — baseline: CWD repo at current branch unless overridden. Nothing hardcoded.
  let repo: string;
  try {
    repo = options?.repo ?? getPrimaryRepo();
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }
  let branch: string;
  try {
    branch = options?.branch ?? getCurrentBranch(repo);
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  const config = readConfig();
  let remote: RunMeta['remote'];
  try {
    remote = getRemote(repo, config.gitea_host);
  } catch {
    remote = undefined;
  }

  // 5 — build the combo list, harness-major then model, de-duplicated.
  const combos: { harness: string; model: string; combo: string }[] = [];
  const seen = new Set<string>();
  for (const h of harnesses) {
    for (const m of models) {
      const combo = comboName(h, m);
      if (seen.has(combo)) continue;
      seen.add(combo);
      combos.push({ harness: h, model: m, combo });
    }
  }

  // 6 — print the planned matrix before enqueueing.
  console.log(`Baseline:  ${repo} @ ${branch}`);
  console.log(`Provider:  ${options?.provider ?? '(config default)'}`);
  console.log(`Remote:    ${remote ? `${remote.host}/${remote.owner}/${remote.repo}` : '(none — push skipped)'}`);
  console.log(`Matrix (${combos.length} run${combos.length === 1 ? '' : 's'}):`);
  for (const c of combos) console.log(`  - ${c.combo}`);
  console.log('');

  // 7 — enqueue each combo; skip ones with existing results unless --force.
  let enqueued = 0;
  let skipped = 0;
  for (const c of combos) {
    if (!options?.force && fs.existsSync(path.join(getResultsDir(c.combo), 'meta.json'))) {
      console.log(`skip   ${c.combo} — results already exist (use --force to re-run)`);
      skipped++;
      continue;
    }
    const runId = ulid();
    const meta: RunMeta = {
      id: runId,
      primary_repo_path: repo,
      worktree_path: '', // set to the clone path at run time by the bench dispatch
      feature_branch: `harnesstests/${c.combo}`,
      target_branch: branch,
      remote,
      status: 'queued',
      total_cost_usd: 0,
      prompt,
      prompt_source: 'free-text',
      harness: c.harness,
      model: c.model,
      isolation: 'clone',
      bench_repo: repo,
      bench_branch: branch,
      ...(options?.provider ? { provider: options.provider } : {}),
    };
    writeMeta(runId, meta);
    enqueue(runId, undefined, 'single-prompt');
    enqueued++;
    console.log(`queued ${c.combo} — ${runId.slice(0, 8)}…`);
  }

  console.log('');
  console.log(`Enqueued ${enqueued} run${enqueued === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}.`);
  if (enqueued > 0) console.log('Run `cpe start` to execute (sequential, with the configured inter-run pause).');
}

function fmtDuration(ms: unknown): string {
  if (typeof ms !== 'number' || ms <= 0) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/** Parse the trailing summary line of `git diff --stat` for files / +- counts. */
function parseDiffstat(diffstat: unknown): { files: string; lines: string } {
  if (typeof diffstat !== 'string' || !diffstat.trim()) return { files: '0', lines: '-' };
  const last = diffstat.trim().split('\n').pop() ?? '';
  const files = last.match(/(\d+) files? changed/)?.[1] ?? '0';
  const ins = last.match(/(\d+) insertion/)?.[1] ?? '0';
  const del = last.match(/(\d+) deletion/)?.[1] ?? '0';
  return { files, lines: `+${ins}/-${del}` };
}

/**
 * `cpe bench summary` — tabulate every captured results/<combo>/meta.json.
 * Tolerates missing/partial/unreadable meta (timed-out or crashed runs): such a
 * row shows the problem rather than throwing.
 */
export async function benchSummaryCommand(): Promise<void> {
  let combos: string[];
  try {
    combos = fs.readdirSync(RESULTS_BASE)
      .filter(d => fs.existsSync(path.join(RESULTS_BASE, d, 'meta.json')))
      .sort();
  } catch {
    combos = [];
  }

  if (combos.length === 0) {
    console.log('No bench results found. Run `cpe bench ...` then `cpe start`.');
    return;
  }

  const headers = ['HARNESS', 'MODEL', 'OUTCOME', 'DURATION', 'FILES', 'LINES', 'TOKENS', 'COST', 'BRANCH'];
  const rows: string[][] = [];

  for (const combo of combos) {
    const metaPath = path.join(RESULTS_BASE, combo, 'meta.json');
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    } catch {
      rows.push([combo, '', '(unreadable meta.json)', '-', '-', '-', '-', '-', '-']);
      continue;
    }
    const { files, lines } = parseDiffstat(m['diffstat']);
    const tokens = m['tokens'] as { input_tokens?: number; output_tokens?: number } | undefined;
    const totalTokens = tokens ? (tokens.input_tokens ?? 0) + (tokens.output_tokens ?? 0) : 0;
    const cost = typeof m['cost_usd'] === 'number' ? `$${(m['cost_usd'] as number).toFixed(4)}` : '-';
    rows.push([
      String(m['harness'] ?? combo.split('__')[0] ?? ''),
      String(m['model'] ?? ''),
      String(m['outcome'] ?? '?'),
      fmtDuration(m['duration_ms']),
      files,
      lines,
      totalTokens ? String(totalTokens) : '-',
      cost,
      m['branch_pushed'] ? String(m['branch_pushed']) : '-',
    ]);
  }

  printTable(headers, rows);
}
