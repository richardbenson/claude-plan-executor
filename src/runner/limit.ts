import { updateMeta, updatePhase } from '../storage/meta.js';
import { parseResetTime } from './reset-time.js';
import type { ClaudeEnvelope } from './envelope.js';
import type { ActivityBus } from '../events/bus.js';

export async function handleRateLimit(
  envelope: ClaudeEnvelope,
  runId: string,
  phaseNumber: number,
  bus: ActivityBus | { emit: (event: unknown) => void } = { emit: () => { } },
): Promise<{ resumeAt: Date; sessionId: string; hadWork: boolean }> {
  const resumeAt =
    parseResetTime(envelope.result) ?? new Date(Date.now() + 5 * 60 * 1000);

  const hadWork = envelope.usage.input_tokens > 0 || envelope.total_cost_usd > 0;

  // Store resume time on the run so it survives a cpe restart
  updateMeta(runId, { status: 'paused-limit', limit_resume_at: resumeAt.toISOString() });
  // Mark the phase so recovery knows which phase was interrupted (no-op for phaseNumber -1)
  updatePhase(runId, phaseNumber, { session_id: envelope.session_id, status: 'paused-limit' });

  bus.emit({
    kind: 'limit',
    timestamp: new Date(),
    runId,
    phaseNumber,
    resumeAt,
  });

  return { resumeAt, sessionId: envelope.session_id, hadWork };
}

export async function waitUntil(date: Date): Promise<void> {
  while (true) {
    const remaining = date.getTime() - Date.now();
    if (remaining <= 0) break;

    await new Promise(resolve => setTimeout(resolve, Math.min(30_000, remaining)));
  }
}
