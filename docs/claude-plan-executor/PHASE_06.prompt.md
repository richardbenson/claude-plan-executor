Read docs/claude-plan-executor/PHASE_06.md for full context before starting.

You are implementing phase 06 of the Claude Plan Executor (`cpe`) project. This phase builds the
claude -p session invocation, JSON envelope parsing, error classification, and rate-limit
detection. It includes unit tests for the pure-function logic.

Working directory: /home/ubuntu/Code/claude-plan-executor
Branch: feature/claude-plan-executor-phase-6 (create it off feature/claude-plan-executor)
PR target: feature/claude-plan-executor

Before writing anything, read:
- docs/000-claude-plan-executor-spec.md §7.3 (phase execution steps, especially steps 4-8)
- docs/000-claude-plan-executor-spec.md §8.1 (envelope-based limit detection with example JSON)
- docs/000-claude-plan-executor-spec.md §8.2 (reset-time parser algorithm)
- docs/000-claude-plan-executor-spec.md §7.3.2 (restart vs resume logic)
- src/types/meta.ts (PhaseEntry, RunMeta, TokenUsage interfaces)
- src/storage/meta.ts (updateMeta, updatePhase)

FILE: src/runner/envelope.ts

The ClaudeEnvelope interface (what claude -p --output-format=json returns on stdout):

interface ClaudeEnvelope {
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

type EnvelopeOutcome =
  | { type: 'success'; envelope: ClaudeEnvelope }
  | { type: 'rate-limit'; envelope: ClaudeEnvelope }
  | { type: 'transient-error'; envelope: ClaudeEnvelope }
  | { type: 'auth-error'; envelope: ClaudeEnvelope }
  | { type: 'phase-failure'; envelope: ClaudeEnvelope; reason: string };

Export:
- ClaudeEnvelope interface
- EnvelopeOutcome type
- parseEnvelope(stdout: string): ClaudeEnvelope — parses JSON; throws ParseError with the raw
  stdout if unparseable (caller catches and synthesises a phase-failure outcome)
- classifyEnvelope(envelope: ClaudeEnvelope): EnvelopeOutcome:
  - is_error: false → 'success'
  - is_error: true, api_error_status: 429 → 'rate-limit'
  - is_error: true, api_error_status in [500, 502, 503] → 'transient-error'
  - is_error: true, api_error_status in [400, 401, 403] → 'auth-error'
  - is_error: true, api_error_status is any other number or null → 'phase-failure' with
    reason: 'unknown api error: ' + api_error_status
  - Anything else (envelope has required fields but doesn't match any case) → 'phase-failure'
    with reason: 'unclassifiable envelope'

FILE: src/runner/reset-time.ts

Implements spec §8.2 algorithm.

Export:
- parseResetTime(limitMessage: string, now?: Date): Date | null

Algorithm:
1. Match the regex: /You've hit your limit · resets (?<reset>.+?)$/ (the · is U+00B7 middle dot)
   If no match, return null.
2. Parse the capture group with: /^(\d{1,2})(?::(\d{2}))?(am|pm)\s+\(([^)]+)\)$/i
   Groups: hour digits, optional minute digits, am/pm, IANA timezone name.
   If no match, return null.
3. Convert hour to 24-hour: if pm and hour < 12, add 12. If am and hour === 12, set to 0.
4. Use Intl.DateTimeFormat to get the current date components in the target timezone:
   const formatter = new Intl.DateTimeFormat('en-GB', {
     timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
     hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
   });
   Parse the formatted string to get year, month, day.
5. Construct reset_dt as a Date at that year/month/day, hour:minute:00 in the timezone. The
   safest approach: construct ISO string with offset. Use:
   const offsetMs = getTimezoneOffsetMs(timeZone, new Date());
   const resetUtc = new Date(Date.UTC(year, month-1, day, hour24, minutes) - offsetMs);
   Where getTimezoneOffsetMs computes the UTC offset for that timezone at the approximate time.
   Alternatively, use the simpler approach of computing `now` in the timezone, replacing time,
   and adjusting for the offset. If timezone offset computation is complex, fall back to:
   new Date(new Date().toLocaleDateString('en-CA', {timeZone}) + 'T' + padTime + ':00' +
   getOffset(timeZone)) — whichever is cleaner and correct.
6. If reset_dt <= now (already passed today), add 86400000ms (24 hours).
7. Return reset_dt as a UTC Date.

Edge case: if the IANA timezone is invalid/unrecognised (Intl throws), catch and return null.

FILE: src/runner/session.ts

interface SessionOpts {
  worktreePath: string;
  promptFile: string;  // absolute path to the PHASE_NN.prompt.md file in the worktree
  sessionId: string;   // pre-allocated UUID
  logPath: string;     // absolute path to phase-NN.log
  schemaPath: string;  // absolute path to phase-result-schema.json
}

interface SessionResult {
  envelope: ClaudeEnvelope;
  exitCode: number;
}

Export:
- runSession(opts: SessionOpts): Promise<SessionResult>

Implementation:
1. Guard: both schemaPath and --output-format=json must be used together. If schemaPath is
   falsy, throw new Error('runSession: schemaPath is required — --json-schema and
   --output-format=json are mandatory together');
2. Create log file parent directory if needed (fs.mkdirSync with recursive).
3. Open a write stream to logPath.
4. Spawn Claude:
   Bun.spawn(
     ['claude', '-p',
      '--session-id', sessionId,
      '--output-format', 'json',
      '--json-schema', schemaPath,
      '--input-format', 'text'],
     { cwd: worktreePath, stdin: Bun.file(promptFile),
       stdout: 'pipe', stderr: 'pipe' }
   )
   Note: stdin is the prompt file (not interactive). stdout is captured. stderr is streamed to log.
5. Stream stderr to the log file as it arrives (use async iteration on proc.stderr).
6. Capture stdout as a complete buffer (await proc.stdout.arrayBuffer(), then decode as UTF-8).
7. Await proc.exited to get the exit code.
8. Close the log stream.
9. Try parseEnvelope(stdout). If it throws (unparseable), synthesise:
   const fakeEnvelope: ClaudeEnvelope = { is_error: true, api_error_status: null,
     terminal_reason: 'parse-error', stop_reason: 'unknown', result: stdout.slice(0, 500),
     structured_output: null, session_id: sessionId, total_cost_usd: 0,
     usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0,
       cache_creation_input_tokens: 0 } };
   return { envelope: fakeEnvelope, exitCode };
10. Return { envelope, exitCode }.

FILE: src/runner/limit.ts

Export:
- handleRateLimit(envelope: ClaudeEnvelope, runId: string, phaseNumber: number,
    bus: { emit: (event: unknown) => void }): Promise<{
    resumeAt: Date;
    sessionId: string;
    hadWork: boolean;
  }>

Implementation:
1. Capture envelope.session_id → update the phase entry in meta.json (updatePhase)
2. Parse reset time: parseResetTime(envelope.result). If null, fall back to 5 minutes from now:
   new Date(Date.now() + 5 * 60 * 1000)
3. hadWork = envelope.usage.input_tokens > 0 || envelope.total_cost_usd > 0
4. updateMeta(runId, { status: 'paused-limit' })
5. Emit a limit event on the bus. Since the bus module (Phase 07) doesn't exist yet, accept bus
   as a parameter typed as { emit: (event: unknown) => void }. Pass a null-bus stub for now:
   const nullBus = { emit: () => {} } and document that Phase 07 wires the real bus.
6. Print to stderr: "Rate limit hit. Window resets at " + resumeAt.toISOString()
7. Return { resumeAt, sessionId: envelope.session_id, hadWork }

Also export:
- waitUntil(date: Date): Promise<void> — sleeps until the given date, polling every 30 seconds.
  Print "Waiting for rate limit reset..." to stderr. On each poll cycle print remaining time.

FILE: src/runner/reset-time.test.ts

Test 'parseResetTime':
- '4pm (Europe/London)' with a fixed `now` before 4pm UK time → returns a Date with getHours()
  == 16 in the UTC equivalent for that timezone (compute the expected UTC time manually)
- '11:30am (America/New_York)' → correct hour in that timezone
- Time that has already passed today (now = 5pm, reset = 4pm) → adds 24 hours
- 'No hit message here' (no regex match) → returns null
- 'hit · resets 4pm (Invalid/Zone)' with bad timezone → returns null (no throw)
- '4pm (Europe/London)' with no `now` arg → returns a Date (smoke test, just assert non-null)

FILE: src/runner/envelope.test.ts

Test 'classifyEnvelope':
- { is_error: false, ... } → outcome.type === 'success'
- { is_error: true, api_error_status: 429, result: "You've hit your limit · resets 4pm (Europe/London)" } → 'rate-limit'
- { is_error: true, api_error_status: 503 } → 'transient-error'
- { is_error: true, api_error_status: 502 } → 'transient-error'
- { is_error: true, api_error_status: 401 } → 'auth-error'
- { is_error: true, api_error_status: 400 } → 'auth-error'
- { is_error: true, api_error_status: 418 } → 'phase-failure'
- { is_error: true, api_error_status: null } → 'phase-failure'

Construct minimal envelope fixtures with just the fields classifyEnvelope reads (use `as
ClaudeEnvelope` cast for the test fixtures).

VERIFY before committing:
1. bun test passes (all new tests plus existing)
2. bun run typecheck passes
3. parseResetTime('You\'ve hit your limit · resets 4pm (Europe/London)') returns a non-null Date
4. runSession throws if schemaPath is not provided

After all criteria pass:
1. git add src/runner/envelope.ts src/runner/session.ts src/runner/reset-time.ts
   src/runner/limit.ts src/runner/reset-time.test.ts src/runner/envelope.test.ts
2. git commit -m "feat: phase 06 — session runner and rate-limit handling"
3. git push -u origin feature/claude-plan-executor-phase-6
4. Create PR targeting feature/claude-plan-executor

Update docs/claude-plan-executor/PROGRESS.md on start and completion.

Your final message in this conversation must be a JSON object matching the schema you have been
given. Do all your work using tools first, then emit only the JSON as your closing message.
