import type { ProviderEntry, TokenUsage } from '../types/meta.js';

/*
 * LiteLLM gateway client — per-run virtual keys + spend-log token collection.
 *
 * A provider entry with `type: 'litellm'` points cpe at a LiteLLM proxy (see
 * docs/litellm-integration-spec.md). For each run we mint an ephemeral virtual
 * key (`POST /key/generate`), inject it as the harness's API key, and afterwards
 * sum the run's split input/output tokens from `GET /spend/logs?api_key=<key>`
 * — attribution is by key, so the totals cover every request the harness made,
 * across all turns, regardless of how (or whether) the harness reports usage
 * itself. The key is revoked at the end (best-effort; it also auto-expires).
 *
 * Everything here is fail-safe: any network/parse error returns null/false and
 * the caller falls back to adapter-reported tokens. A token-collection failure
 * is never a run failure.
 *
 * Validated against a live gateway (2026-06-09): /key/generate accepts
 * duration + models + metadata; /spend/logs accepts the PLAINTEXT key as the
 * api_key filter (rows store its sha256); rows carry split prompt/completion
 * tokens per request and flush ~1-2 min after the call, hence the polling.
 */

/** Env var the admin key is read from when the entry doesn't name one. */
export const DEFAULT_ADMIN_KEY_ENV = 'CPE_LITELLM_KEY';

/** Spend logs flush to the DB ~1-2 min after a request; poll up to this long. */
export const DEFAULT_COLLECT_BUDGET_MS = 180_000;
export const DEFAULT_COLLECT_INTERVAL_MS = 10_000;

/** Per-run key lifetime when max_runtime_seconds is not configured. */
const FALLBACK_KEY_SECONDS = 6 * 60 * 60;

export interface LitellmGateway {
  /** Gateway root URL (no trailing slash). */
  baseUrl: string;
  adminKey: string;
}

export interface LitellmRunKey {
  gateway: LitellmGateway;
  /** The ephemeral virtual key this run's harness traffic authenticates with. */
  key: string;
}

/**
 * Resolve a `type: 'litellm'` provider entry into a gateway handle. Throws a
 * descriptive error on misconfiguration (missing base URL / unresolvable admin
 * key) — these are config mistakes the user must fix, not runtime conditions.
 */
export function litellmGateway(entry: ProviderEntry): LitellmGateway {
  const baseUrl = (entry.anthropic_base_url ?? '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error(
      `LiteLLM provider '${entry.name}' has no anthropic_base_url (the gateway root URL)`,
    );
  }
  const envVar = entry.admin_key_env ?? DEFAULT_ADMIN_KEY_ENV;
  const adminKey = entry.admin_key ?? process.env[envVar];
  if (!adminKey) {
    throw new Error(
      `LiteLLM provider '${entry.name}' has no admin key: set $${envVar} ` +
      `(or admin_key_env/admin_key on the provider entry)`,
    );
  }
  return { baseUrl, adminKey };
}

/** Per-run key lifetime: 2x the configured max runtime (can't expire mid-run; a crash's orphaned key still dies). */
export function runKeyDurationSeconds(maxRuntimeSeconds?: number): number {
  return maxRuntimeSeconds && maxRuntimeSeconds > 0
    ? maxRuntimeSeconds * 2
    : FALLBACK_KEY_SECONDS;
}

function authHeaders(key: string): Record<string, string> {
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
}

/**
 * Mint an ephemeral virtual key for one run. Returns null on any failure —
 * the caller routes with the admin key instead (degraded: no token collection,
 * since admin-key spend logs include unrelated traffic).
 */
export async function generateRunKey(
  gateway: LitellmGateway,
  opts: { durationSeconds: number; model?: string; runId?: string },
): Promise<string | null> {
  try {
    const body: Record<string, unknown> = { duration: `${Math.round(opts.durationSeconds)}s` };
    if (opts.model) body['models'] = [opts.model];
    if (opts.runId) body['metadata'] = { run_id: opts.runId };
    const res = await fetch(`${gateway.baseUrl}/key/generate`, {
      method: 'POST',
      headers: authHeaders(gateway.adminKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { key?: unknown };
    return typeof json.key === 'string' && json.key.length > 0 ? json.key : null;
  } catch {
    return null;
  }
}

/** Revoke a run key (best-effort — it auto-expires anyway). */
export async function revokeRunKey(runKey: LitellmRunKey): Promise<boolean> {
  try {
    const res = await fetch(`${runKey.gateway.baseUrl}/key/delete`, {
      method: 'POST',
      headers: authHeaders(runKey.gateway.adminKey),
      body: JSON.stringify({ keys: [runKey.key] }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface SpendTotals {
  tokens: TokenUsage;
  /** Number of model requests (spend-log rows) the run made. */
  calls: number;
}

/**
 * Sum split token totals from a /spend/logs response (a bare array or `{data}`).
 * Cache-read tokens are picked up opportunistically from the per-row
 * usage_object when the provider reports them; local Ollama never does.
 * Returns null when there are no rows (not yet flushed, or no traffic).
 */
export function sumSpendRows(json: unknown): SpendTotals | null {
  const rows = Array.isArray(json)
    ? json
    : (json && typeof json === 'object' && Array.isArray((json as { data?: unknown }).data))
      ? (json as { data: unknown[] }).data
      : null;
  if (!rows || rows.length === 0) return null;

  const tokens: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  let calls = 0;
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    tokens.input_tokens += Number(row['prompt_tokens']) || 0;
    tokens.output_tokens += Number(row['completion_tokens']) || 0;
    const usage = (row['metadata'] as Record<string, unknown> | undefined)?.['usage_object'] as
      | Record<string, unknown>
      | undefined;
    const promptDetails = usage?.['prompt_tokens_details'] as Record<string, unknown> | undefined;
    tokens.cache_read_input_tokens += Number(promptDetails?.['cached_tokens']) || 0;
    calls += 1;
  }
  if (calls === 0) return null;
  return { tokens, calls };
}

/** One spend-logs fetch for a run key. Null on error or no rows yet. */
export async function fetchSpendTotals(runKey: LitellmRunKey): Promise<SpendTotals | null> {
  try {
    const url = `${runKey.gateway.baseUrl}/spend/logs?api_key=${encodeURIComponent(runKey.key)}`;
    const res = await fetch(url, {
      headers: authHeaders(runKey.gateway.adminKey),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return sumSpendRows(await res.json());
  } catch {
    return null;
  }
}

/** True when two spend snapshots carry the same rows (count + summed tokens). */
function sameTotals(a: SpendTotals, b: SpendTotals): boolean {
  return a.calls === b.calls
    && a.tokens.input_tokens === b.tokens.input_tokens
    && a.tokens.output_tokens === b.tokens.output_tokens;
}

/**
 * Poll /spend/logs until the run's rows have flushed (or the budget runs out).
 * Rows flush in batches, so the first non-empty read can be PARTIAL — a short
 * run's title-generation row landed a poll before its main agent rows, under-
 * reporting 10.9k tokens as 375 (observed 2026-06-10, crush). A result is only
 * trusted once two consecutive polls agree; on budget exhaustion the best
 * snapshot seen is returned rather than nothing.
 */
export async function collectSpendTotals(
  runKey: LitellmRunKey,
  opts?: { budgetMs?: number; intervalMs?: number },
): Promise<SpendTotals | null> {
  const budgetMs = opts?.budgetMs ?? DEFAULT_COLLECT_BUDGET_MS;
  const intervalMs = opts?.intervalMs ?? DEFAULT_COLLECT_INTERVAL_MS;
  const deadline = Date.now() + budgetMs;
  let last: SpendTotals | null = null;
  for (;;) {
    const totals = await fetchSpendTotals(runKey);
    if (totals && last && sameTotals(totals, last)) return totals;
    if (totals) last = totals;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return last;
    await Bun.sleep(Math.min(intervalMs, remaining));
  }
}

/**
 * End-of-run settlement: collect the run's token totals from spend logs (unless
 * `collect: false` — early-failure paths just revoke), then revoke the key.
 * Returns the totals, or null when there's no run key / nothing collected —
 * callers fall back to adapter-reported tokens.
 */
export async function settleLitellmRun(
  runKey: LitellmRunKey | undefined,
  opts?: { collect?: boolean; budgetMs?: number; intervalMs?: number },
): Promise<SpendTotals | null> {
  if (!runKey) return null;
  let totals: SpendTotals | null = null;
  if (opts?.collect !== false) {
    const collectOpts: { budgetMs?: number; intervalMs?: number } = {};
    if (opts?.budgetMs !== undefined) collectOpts.budgetMs = opts.budgetMs;
    if (opts?.intervalMs !== undefined) collectOpts.intervalMs = opts.intervalMs;
    totals = await collectSpendTotals(runKey, collectOpts);
  }
  await revokeRunKey(runKey);
  return totals;
}
