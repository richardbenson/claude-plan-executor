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
  | { type: 'context-overflow'; envelope: ClaudeEnvelope; reason: string }
  | { type: 'phase-failure'; envelope: ClaudeEnvelope; reason: string };

/** The error-bearing text fields of an envelope, lowercased, for signature matching. */
function errorText(e: ClaudeEnvelope): string {
  return `${e.terminal_reason ?? ''} ${e.result ?? ''}`.toLowerCase();
}

/**
 * A context-length overflow (e.g. LiteLLM/OpenAI "request (N tokens) exceeds the
 * available context size"). Terminal: retrying the same prompt hits the same wall,
 * so the fix is a bigger model context window, not a retry.
 */
export function isContextOverflow(e: ClaudeEnvelope): boolean {
  const t = errorText(e);
  return t.includes('context size')
    || t.includes('context length')
    || t.includes('context_length_exceeded')
    || t.includes('exceeds the available context')
    || t.includes('maximum context')
    || t.includes('too many tokens');
}

/** A request timeout (transient — the backend stalled; a retry may succeed). */
export function isTimeout(e: ClaudeEnvelope): boolean {
  const t = errorText(e);
  return t.includes('timed out') || t.includes('timeout');
}

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

  // Content-based signatures first — these matter regardless of status code
  // (LiteLLM surfaces a context overflow as a 400; a timeout may carry no status).
  if (isContextOverflow(envelope)) {
    return { type: 'context-overflow', envelope, reason: 'model context window exceeded (raise the model context size; not retryable)' };
  }
  if (isTimeout(envelope)) {
    return { type: 'transient-error', envelope };
  }

  if (status === 429) {
    return { type: 'rate-limit', envelope };
  }

  if (status === 500 || status === 502 || status === 503) {
    return { type: 'transient-error', envelope };
  }

  // 401/403 are genuine auth failures; 400 is a bad request (NOT auth — it was
  // previously mislabelled "auth error", masking context overflows like the one
  // above before the signature check existed).
  if (status === 401 || status === 403) {
    return { type: 'auth-error', envelope };
  }

  if (status === 400) {
    return { type: 'phase-failure', envelope, reason: 'bad request (HTTP 400)' };
  }

  if (typeof status === 'number' || status === null) {
    return { type: 'phase-failure', envelope, reason: `unknown api error: ${status}` };
  }

  return { type: 'phase-failure', envelope, reason: 'unclassifiable envelope' };
}
