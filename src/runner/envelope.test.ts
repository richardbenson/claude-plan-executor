import { describe, it, expect } from 'bun:test';
import { classifyEnvelope, type ClaudeEnvelope } from './envelope.js';

function makeEnvelope(overrides: Partial<ClaudeEnvelope>): ClaudeEnvelope {
  return {
    is_error: false,
    api_error_status: null,
    terminal_reason: 'completed',
    stop_reason: 'end_turn',
    result: '',
    structured_output: null,
    session_id: 'test-session',
    total_cost_usd: 0,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    ...overrides,
  } as ClaudeEnvelope;
}

describe('classifyEnvelope', () => {
  it('returns success for is_error: false', () => {
    const outcome = classifyEnvelope(makeEnvelope({ is_error: false }));
    expect(outcome.type).toBe('success');
  });

  it('returns rate-limit for 429', () => {
    const outcome = classifyEnvelope(
      makeEnvelope({
        is_error: true,
        api_error_status: 429,
        result: "You've hit your limit · resets 4pm (Europe/London)",
      }),
    );
    expect(outcome.type).toBe('rate-limit');
  });

  it('returns transient-error for 503', () => {
    const outcome = classifyEnvelope(makeEnvelope({ is_error: true, api_error_status: 503 }));
    expect(outcome.type).toBe('transient-error');
  });

  it('returns transient-error for 502', () => {
    const outcome = classifyEnvelope(makeEnvelope({ is_error: true, api_error_status: 502 }));
    expect(outcome.type).toBe('transient-error');
  });

  it('returns auth-error for 401', () => {
    const outcome = classifyEnvelope(makeEnvelope({ is_error: true, api_error_status: 401 }));
    expect(outcome.type).toBe('auth-error');
  });

  it('returns auth-error for 400', () => {
    const outcome = classifyEnvelope(makeEnvelope({ is_error: true, api_error_status: 400 }));
    expect(outcome.type).toBe('auth-error');
  });

  it('returns phase-failure for unknown status 418', () => {
    const outcome = classifyEnvelope(makeEnvelope({ is_error: true, api_error_status: 418 }));
    expect(outcome.type).toBe('phase-failure');
  });

  it('returns phase-failure for null api_error_status', () => {
    const outcome = classifyEnvelope(makeEnvelope({ is_error: true, api_error_status: null }));
    expect(outcome.type).toBe('phase-failure');
  });
});
