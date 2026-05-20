export interface ClaudeEnvelope {
  is_error: boolean;
  api_error_status: number | null;
  terminal_reason: string;
  stop_reason: string;
  result: string;
  structured_output: unknown;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  permission_denials?: unknown[];
}

export type EnvelopeOutcome =
  | { type: 'success'; envelope: ClaudeEnvelope }
  | { type: 'rate-limit'; envelope: ClaudeEnvelope }
  | { type: 'transient-error'; envelope: ClaudeEnvelope }
  | { type: 'auth-error'; envelope: ClaudeEnvelope }
  | { type: 'phase-failure'; envelope: ClaudeEnvelope; reason: string };

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

export function parseEnvelope(stdout: string): ClaudeEnvelope {
  try {
    return JSON.parse(stdout) as ClaudeEnvelope;
  } catch {
    throw new ParseError('Failed to parse claude envelope JSON', stdout);
  }
}

export function classifyEnvelope(envelope: ClaudeEnvelope): EnvelopeOutcome {
  if (!envelope.is_error) {
    return { type: 'success', envelope };
  }

  const status = envelope.api_error_status;

  if (status === 429) {
    return { type: 'rate-limit', envelope };
  }

  if (status === 500 || status === 502 || status === 503) {
    return { type: 'transient-error', envelope };
  }

  if (status === 400 || status === 401 || status === 403) {
    return { type: 'auth-error', envelope };
  }

  if (typeof status === 'number' || status === null) {
    return { type: 'phase-failure', envelope, reason: `unknown api error: ${status}` };
  }

  return { type: 'phase-failure', envelope, reason: 'unclassifiable envelope' };
}
