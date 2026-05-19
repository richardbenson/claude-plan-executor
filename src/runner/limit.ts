import { updateMeta, updatePhase } from '../storage/meta.js';
import { parseResetTime } from './reset-time.js';
import type { ClaudeEnvelope } from './envelope.js';

export async function handleRateLimit(
  envelope: ClaudeEnvelope,
  runId: string,
  phaseNumber: number,
  bus: { emit: (event: unknown) => void } = { emit: () => {} },
): Promise<{ resumeAt: Date; sessionId: string; hadWork: boolean }> {
  updatePhase(runId, phaseNumber, { session_id: envelope.session_id });

  const resumeAt =
    parseResetTime(envelope.result) ?? new Date(Date.now() + 5 * 60 * 1000);

  const hadWork = envelope.usage.input_tokens > 0 || envelope.total_cost_usd > 0;

  updateMeta(runId, { status: 'paused-limit' });

  bus.emit({ type: 'rate-limit', runId, phaseNumber, resumeAt, hadWork });

  process.stderr.write(`Rate limit hit. Window resets at ${resumeAt.toISOString()}\n`);

  return { resumeAt, sessionId: envelope.session_id, hadWork };
}

export async function waitUntil(date: Date): Promise<void> {
  process.stderr.write('Waiting for rate limit reset...\n');

  while (true) {
    const remaining = date.getTime() - Date.now();
    if (remaining <= 0) break;

    const mins = Math.ceil(remaining / 60_000);
    process.stderr.write(`  ${mins} minute(s) remaining\n`);

    await new Promise(resolve => setTimeout(resolve, Math.min(30_000, remaining)));
  }
}
