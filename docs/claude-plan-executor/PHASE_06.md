# Phase 06 — Session Runner + Rate-Limit Handling

## Summary

Implement the `claude -p` session invocation, JSON envelope parsing, error classification, and the
rate-limit detection and recovery machinery. Unit tests cover the reset-time parser and the
envelope classifier — both are pure functions with no external dependencies.

## Context

### The claude -p envelope (src/runner/envelope.ts)
When invoked with `--output-format=json`, `claude -p` returns a single JSON object on stdout when
the session ends. Key fields (from spec §7.3 and §8.1):

```
is_error: boolean
api_error_status: number | null
terminal_reason: string        // "completed" for clean exit
stop_reason: string            // "end_turn" (clean) or "stop_sequence" (limit/error)
result: string                 // prose result (empty when schema in use)
structured_output: object      // schema-validated phase result (our PhaseResult)
session_id: string
total_cost_usd: number
usage: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }
permission_denials: array
```

Define the `ClaudeEnvelope` TypeScript interface matching all these fields. Define `EnvelopeOutcome`
as a discriminated union: `success | rate-limit | transient-error | auth-error | phase-failure`.
Implement `classifyEnvelope(envelope: ClaudeEnvelope): EnvelopeOutcome` with this logic:
- `is_error: false` → `success`
- `is_error: true, api_error_status: 429` → `rate-limit`
- `is_error: true, api_error_status` in [500, 502, 503] → `transient-error` (retry quickly)
- `is_error: true, api_error_status` in [400, 401, 403] → `auth-error` (fail the phase)
- Anything else (unparseable, missing required fields, `structured_output` absent when expected)
  → `phase-failure`

### Session spawner (src/runner/session.ts)
`runSession(opts)` where opts contains: worktreePath, promptFile, sessionId, logPath, schema.

Steps:
1. Validate that `--output-format=json` and `--json-schema` will both be used; throw if either
   is missing (per spec: "The runner errors out at startup if asked to run without both").
2. Spawn: `claude -p --session-id <sessionId> --output-format json --json-schema <schemaFile>
   < <promptFile>` with `cwd: worktreePath`.
3. Stream stderr to the log file in real time.
4. Capture stdout as a buffer (the JSON envelope arrives at session end).
5. On exit: parse stdout as JSON → `ClaudeEnvelope`. If stdout is empty or unparseable, synthesise
   a `phase-failure` envelope.
6. Return `{ envelope, exitCode }`.

The session-id and jsonl path are pre-allocated by the phase loop (Phase 08), not computed here.

### Reset-time parser (src/runner/reset-time.ts)
Parses the human-readable reset string from the envelope `result` field or from stdout on the
non-JSON path. Spec §8.2 algorithm:

`parseResetTime(limitMessage: string, now?: Date): Date | null`
1. Match regex: `/You've hit your limit · resets (?<reset>.+?)$/`
2. If no match, return null (caller falls back to polling every 5 minutes)
3. Split capture group into time portion and parenthesised timezone:
   regex `/^(\d{1,2}(?::\d{2})?(?:am|pm))\s+\(([^)]+)\)$/i`
4. Parse time as hour (e.g. "4pm" → 16, "4:30pm" → 16:30); if minutes absent assume :00
5. Get `now` in the named IANA timezone (use `Intl.DateTimeFormat` — no third-party date library)
6. Build `reset_dt` = today at that hour:minute in the named timezone
7. If `reset_dt <= now` (time already passed today), add 24 hours
8. Return `reset_dt` as a JS Date (UTC-equivalent)

### Limit detector (src/runner/limit.ts)
`handleRateLimit(envelope, runId, phaseNumber)`:
1. Capture `envelope.session_id` onto the phase entry in meta.json
2. Parse reset time using `parseResetTime(envelope.result)`; if null, fall back to 5-minute poll
3. Log the event to the activity bus (imported from Phase 07 — use a stub/null bus in this phase)
4. Update run status to `paused-limit` in meta.json
5. Return `{ resumeAt: Date, sessionId: string, hadWork: boolean }` where `hadWork` is
   `envelope.usage.input_tokens > 0 || envelope.total_cost_usd > 0`

### Unit tests (src/runner/reset-time.test.ts, src/runner/envelope.test.ts)

reset-time.test.ts:
- "4pm (Europe/London)" parses to 16:00 in Europe/London timezone
- "11:30am (America/New_York)" parses to 11:30 in America/New_York
- If the parsed time is in the past, adds 24 hours
- Unrecognised format returns null
- Malformed timezone returns null (don't throw)

envelope.test.ts:
- is_error: false → 'success'
- is_error: true, api_error_status: 429 → 'rate-limit'
- is_error: true, api_error_status: 503 → 'transient-error'
- is_error: true, api_error_status: 401 → 'auth-error'
- Completely missing structured_output when it's required → 'phase-failure'
- stdout unparseable as JSON → 'phase-failure' (handled upstream, test the classifier on the
  synthesised failure envelope)

## Files Expected to Change

- `src/runner/envelope.ts` — created
- `src/runner/session.ts` — created
- `src/runner/reset-time.ts` — created
- `src/runner/limit.ts` — created
- `src/runner/reset-time.test.ts` — created
- `src/runner/envelope.test.ts` — created

## Acceptance Criteria

1. `bun test` passes including all new tests
2. `tsc --noEmit` passes
3. `parseResetTime` correctly converts "4pm (Europe/London)" to a future Date in UTC
4. `classifyEnvelope` correctly identifies all five outcome types
5. `runSession` throws (not returns null) if `--output-format=json` or `--json-schema` is omitted

## Dependencies

Phase 05 (meta.ts storage available; AppConfig type defined).
