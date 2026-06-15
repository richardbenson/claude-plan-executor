import * as fs from 'fs';
import * as path from 'path';
import { parseEnvelope, type ClaudeEnvelope } from './envelope.js';
import type { ResolvedProvider } from './provider.js';
import { groupWrap, killTree } from './proc-tree.js';

export interface SessionOpts {
  worktreePath: string;
  promptFile: string;
  sessionId: string;
  logPath: string;
  schema: string;
  dangerouslySkipPermissions?: boolean;
  provider?: ResolvedProvider | null;
  /**
   * Optional abort signal. When provided, the claude process is started in its
   * own process group and the whole tree is killed if the signal fires (used for
   * activity timeout / manual bail in bench runs). When omitted, behaviour is
   * unchanged from before — same spawn, no process group.
   */
  signal?: AbortSignal;
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

  const promptContent = fs.readFileSync(opts.promptFile, 'utf-8');

  const providerEnvVars: Record<string, string> = opts.provider?.env ?? {};
  const env = Object.keys(providerEnvVars).length > 0
    ? { ...process.env, ...providerEnvVars }
    : undefined;

  const args = [
    'claude',
    '-p',
    promptContent,
    '--session-id',
    opts.sessionId,
    '--output-format',
    'json',
    '--json-schema',
    opts.schema,
    ...(opts.provider?.modelArgs ?? []),
  ];
  if (opts.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  // For bench runs (signal provided) start claude in its own process group so a
  // timeout/bail can kill the whole tree. Default path is unchanged.
  const spawnArgs = opts.signal ? groupWrap(args) : args;

  const proc = Bun.spawn(spawnArgs, {
    cwd: opts.worktreePath,
    stdin: null,
    stdout: 'pipe',
    stderr: 'pipe',
    ...(env ? { env } : {}),
  });

  let onAbort: (() => void) | undefined;
  if (opts.signal) {
    onAbort = () => killTree(proc.pid);
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }

  // Stream stderr to log file
  const stderrDone = (async () => {
    for await (const chunk of proc.stderr) {
      logStream.write(chunk);
    }
  })();

  const stdoutBuffer = await new Response(proc.stdout).arrayBuffer();
  const exitCode = await proc.exited;
  await stderrDone;

  if (opts.signal && onAbort) opts.signal.removeEventListener('abort', onAbort);

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
