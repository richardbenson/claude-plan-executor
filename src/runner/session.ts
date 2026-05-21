import * as fs from 'fs';
import * as path from 'path';
import { parseEnvelope, type ClaudeEnvelope } from './envelope.js';

export interface SessionOpts {
  worktreePath: string;
  promptFile: string;
  sessionId: string;
  logPath: string;
  schema: string;
  dangerouslySkipPermissions?: boolean;
}

export interface SessionResult {
  envelope: ClaudeEnvelope;
  exitCode: number;
}

export async function runSession(opts: SessionOpts): Promise<SessionResult> {
  if (!opts.schema) {
    throw new Error(
      'runSession: schema is required — --json-schema and --output-format=json are mandatory together',
    );
  }

  fs.mkdirSync(path.dirname(opts.logPath), { recursive: true });

  const logStream = fs.createWriteStream(opts.logPath, { flags: 'a' });

  const args = [
    'claude',
    '-p',
    '--session-id',
    opts.sessionId,
    '--output-format',
    'json',
    '--json-schema',
    opts.schema,
    '--input-format',
    'text',
  ];
  if (opts.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  const proc = Bun.spawn(args,
    {
      cwd: opts.worktreePath,
      stdin: Bun.file(opts.promptFile),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  // Stream stderr to log file
  const stderrDone = (async () => {
    for await (const chunk of proc.stderr) {
      logStream.write(chunk);
    }
  })();

  const stdoutBuffer = await new Response(proc.stdout).arrayBuffer();
  const exitCode = await proc.exited;
  await stderrDone;

  await new Promise<void>((resolve, reject) => {
    logStream.close(err => (err ? reject(err) : resolve()));
  });

  const stdout = new TextDecoder().decode(stdoutBuffer);

  try {
    const envelope = parseEnvelope(stdout);
    return { envelope, exitCode };
  } catch {
    const fakeEnvelope: ClaudeEnvelope = {
      is_error: true,
      api_error_status: null,
      terminal_reason: 'parse-error',
      stop_reason: 'unknown',
      result: stdout.slice(0, 500),
      structured_output: null,
      session_id: opts.sessionId,
      total_cost_usd: 0,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    };
    return { envelope: fakeEnvelope, exitCode };
  }
}
