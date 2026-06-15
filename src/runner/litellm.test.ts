import { test, expect } from 'bun:test';
import {
  litellmGateway,
  runKeyDurationSeconds,
  generateRunKey,
  revokeRunKey,
  sumSpendRows,
  collectSpendTotals,
  settleLitellmRun,
  type LitellmGateway,
} from './litellm.js';
import type { ProviderEntry } from '../types/meta.js';

/**
 * A fake LiteLLM gateway (Bun.serve, ephemeral port) speaking the endpoints the
 * client uses, with response shapes copied from the live gateway validation
 * (2026-06-09): /key/generate -> {key}, /key/delete -> {deleted_keys},
 * /spend/logs -> bare array of rows with split prompt/completion tokens.
 */
function fakeGateway(opts?: { spendEmptyPolls?: number; spendPartialPolls?: number; failKeyGen?: boolean }) {
  const state = {
    keyGenBodies: [] as Record<string, unknown>[],
    deletedKeys: [] as string[],
    spendCalls: 0,
    lastSpendApiKey: '',
  };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/health/readiness') {
        return Response.json({ status: 'healthy', db: 'connected' });
      }
      if (url.pathname === '/key/generate') {
        state.keyGenBodies.push(await req.json() as Record<string, unknown>);
        if (opts?.failKeyGen) return new Response('boom', { status: 500 });
        return Response.json({ key: 'sk-run-ephemeral-1' });
      }
      if (url.pathname === '/key/delete') {
        const body = await req.json() as { keys: string[] };
        state.deletedKeys.push(...body.keys);
        return Response.json({ deleted_keys: body.keys });
      }
      if (url.pathname === '/spend/logs') {
        state.spendCalls += 1;
        state.lastSpendApiKey = url.searchParams.get('api_key') ?? '';
        const empty = opts?.spendEmptyPolls ?? 0;
        if (state.spendCalls <= empty) return Response.json([]);
        // 3-turn shape mirroring the real crush validation run (21312 in / 51 out).
        const rows = [
          { prompt_tokens: 10614, completion_tokens: 3 },
          { prompt_tokens: 157, completion_tokens: 8 },
          {
            prompt_tokens: 10541, completion_tokens: 40,
            metadata: { usage_object: { prompt_tokens_details: { cached_tokens: 25 } } },
          },
        ];
        // Partially-flushed batch: early polls only see the first (small) row.
        if (state.spendCalls <= empty + (opts?.spendPartialPolls ?? 0)) {
          return Response.json(rows.slice(1, 2));
        }
        return Response.json(rows);
      }
      return new Response('not found', { status: 404 });
    },
  });
  const gateway: LitellmGateway = {
    baseUrl: `http://localhost:${server.port}`,
    adminKey: 'sk-admin-test',
  };
  return { server, gateway, state };
}

test('litellmGateway resolves the admin key from env var / inline, and throws clear config errors', () => {
  const entry: ProviderEntry = {
    name: 'gw',
    type: 'litellm',
    anthropic_base_url: 'https://litellm.example/',
    admin_key_env: 'CPE_LITELLM_TEST_KEY',
  };
  process.env['CPE_LITELLM_TEST_KEY'] = 'sk-from-env';
  try {
    const gw = litellmGateway(entry);
    expect(gw.baseUrl).toBe('https://litellm.example'); // trailing slash trimmed
    expect(gw.adminKey).toBe('sk-from-env');
  } finally {
    delete process.env['CPE_LITELLM_TEST_KEY'];
  }

  // inline key wins over env
  expect(litellmGateway({ ...entry, admin_key: 'sk-inline' }).adminKey).toBe('sk-inline');
  // missing key / missing base url are loud config errors
  expect(() => litellmGateway(entry)).toThrow(/admin key/);
  expect(() => litellmGateway({ name: 'gw', type: 'litellm', admin_key: 'k' })).toThrow(/anthropic_base_url/);
});

test('runKeyDurationSeconds is 2x max runtime, with a fallback when unset', () => {
  expect(runKeyDurationSeconds(5400)).toBe(10800);
  expect(runKeyDurationSeconds(undefined)).toBe(6 * 60 * 60);
  expect(runKeyDurationSeconds(0)).toBe(6 * 60 * 60);
});

test('generateRunKey mints an ephemeral key scoped to the model, with run metadata', async () => {
  const { server, gateway, state } = fakeGateway();
  try {
    const key = await generateRunKey(gateway, {
      durationSeconds: 10800,
      model: 'gemma4-cpe:31b',
      runId: '01TEST',
    });
    expect(key).toBe('sk-run-ephemeral-1');
    expect(state.keyGenBodies[0]).toEqual({
      duration: '10800s',
      models: ['gemma4-cpe:31b'],
      metadata: { run_id: '01TEST' },
    });
  } finally {
    server.stop(true);
  }
});

test('generateRunKey returns null on gateway failure (degraded routing, never throws)', async () => {
  const { server, gateway } = fakeGateway({ failKeyGen: true });
  try {
    expect(await generateRunKey(gateway, { durationSeconds: 60 })).toBeNull();
  } finally {
    server.stop(true);
  }
  // unreachable gateway -> null too
  const dead: LitellmGateway = { baseUrl: 'http://127.0.0.1:9', adminKey: 'k' };
  expect(await generateRunKey(dead, { durationSeconds: 60 })).toBeNull();
});

test('sumSpendRows sums split in/out across rows (bare array and {data} shapes)', () => {
  const rows = [
    { prompt_tokens: 100, completion_tokens: 10 },
    { prompt_tokens: 200, completion_tokens: 20, metadata: { usage_object: { prompt_tokens_details: { cached_tokens: 50 } } } },
  ];
  for (const shape of [rows, { data: rows }]) {
    const totals = sumSpendRows(shape);
    expect(totals?.tokens.input_tokens).toBe(300);
    expect(totals?.tokens.output_tokens).toBe(30);
    expect(totals?.tokens.cache_read_input_tokens).toBe(50);
    expect(totals?.calls).toBe(2);
  }
  expect(sumSpendRows([])).toBeNull();
  expect(sumSpendRows({ data: [] })).toBeNull();
  expect(sumSpendRows('garbage')).toBeNull();
});

test('collectSpendTotals polls past the flush window and queries by the PLAINTEXT run key', async () => {
  const { server, gateway, state } = fakeGateway({ spendEmptyPolls: 2 });
  try {
    const totals = await collectSpendTotals(
      { gateway, key: 'sk-run-ephemeral-1' },
      { budgetMs: 2000, intervalMs: 5 },
    );
    expect(totals?.tokens.input_tokens).toBe(21312);
    expect(totals?.tokens.output_tokens).toBe(51);
    expect(totals?.calls).toBe(3);
    expect(state.spendCalls).toBe(4); // two empty polls, then two agreeing reads
    expect(state.lastSpendApiKey).toBe('sk-run-ephemeral-1');
  } finally {
    server.stop(true);
  }
});

test('collectSpendTotals gives up after the budget (tokens fall back to the adapter)', async () => {
  const { server, gateway } = fakeGateway({ spendEmptyPolls: 1000 });
  try {
    const totals = await collectSpendTotals(
      { gateway, key: 'sk-run-ephemeral-1' },
      { budgetMs: 30, intervalMs: 5 },
    );
    expect(totals).toBeNull();
  } finally {
    server.stop(true);
  }
});

test('collectSpendTotals waits out a partial flush instead of trusting the first rows', async () => {
  // The 2026-06-10 crush regression: the title-generation row flushed a poll
  // before the agent rows, and the first non-empty read (375 tokens) was
  // recorded as the run total (truth: 10.9k). Totals must be stable across
  // two consecutive polls before they're trusted.
  const { server, gateway } = fakeGateway({ spendPartialPolls: 1 });
  try {
    const totals = await collectSpendTotals(
      { gateway, key: 'sk-run-ephemeral-1' },
      { budgetMs: 2000, intervalMs: 5 },
    );
    expect(totals?.calls).toBe(3);
    expect(totals?.tokens.input_tokens).toBe(21312);
  } finally {
    server.stop(true);
  }
});

test('collectSpendTotals returns the best snapshot when the budget ends mid-flush', async () => {
  // Rows keep growing past the budget: better to report the last partial
  // snapshot (with its calls count) than nothing at all.
  const { server, gateway } = fakeGateway({ spendPartialPolls: 1000 });
  try {
    const totals = await collectSpendTotals(
      { gateway, key: 'sk-run-ephemeral-1' },
      { budgetMs: 30, intervalMs: 100 },
    );
    expect(totals?.calls).toBe(1);
    expect(totals?.tokens.input_tokens).toBe(157);
  } finally {
    server.stop(true);
  }
});

test('settleLitellmRun collects then revokes; collect:false revokes only; no key is a no-op', async () => {
  const { server, gateway, state } = fakeGateway();
  try {
    const totals = await settleLitellmRun(
      { gateway, key: 'sk-run-ephemeral-1' },
      { budgetMs: 2000, intervalMs: 5 },
    );
    expect(totals?.tokens.input_tokens).toBe(21312);
    expect(state.deletedKeys).toEqual(['sk-run-ephemeral-1']);

    const skipped = await settleLitellmRun(
      { gateway, key: 'sk-run-ephemeral-2' },
      { collect: false },
    );
    expect(skipped).toBeNull();
    expect(state.deletedKeys).toEqual(['sk-run-ephemeral-1', 'sk-run-ephemeral-2']);
    expect(state.spendCalls).toBe(2); // two agreeing reads; collect:false made no spend query
  } finally {
    server.stop(true);
  }
  expect(await settleLitellmRun(undefined)).toBeNull();
});

test('revokeRunKey is best-effort: false on an unreachable gateway, never throws', async () => {
  const dead: LitellmGateway = { baseUrl: 'http://127.0.0.1:9', adminKey: 'k' };
  expect(await revokeRunKey({ gateway: dead, key: 'sk-x' })).toBe(false);
});
