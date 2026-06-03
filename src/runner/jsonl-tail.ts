import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ActivityBus } from '../events/bus.js';
import type { ActivityEvent, BashEvent, EditEvent } from '../events/types.js';

export function encodeWorktreePath(worktreePath: string): string {
  return worktreePath.replace(/[/.]/g, '-');
}

export function getExpectedJsonlPath(uuid: string, worktreePath: string): string {
  return path.join(
    os.homedir(),
    '.claude',
    'projects',
    encodeWorktreePath(worktreePath),
    uuid + '.jsonl',
  );
}

export async function findJsonlByUuid(uuid: string): Promise<string | null> {
  const pattern = path.join(os.homedir(), '.claude', 'projects', '**', uuid + '.jsonl');
  const glob = new Bun.Glob(pattern);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    for await (const match of glob.scan('/')) {
      return match.startsWith('/') ? match : '/' + match;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return null;
}

export async function startJsonlTail(
  uuid: string,
  worktreePath: string,
  runId: string,
  phaseNumber: number,
  bus: ActivityBus,
  logPath?: string,
  onActivity?: (signature: string) => void,
): Promise<() => void> {
  const expectedPath = getExpectedJsonlPath(uuid, worktreePath);
  const start = Date.now();

  let filePath: string | null = null;

  // Poll for expected path up to 3 seconds
  while (Date.now() - start < 3000) {
    if (fs.existsSync(expectedPath)) {
      filePath = expectedPath;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Glob fallback
  if (!filePath) {
    filePath = await findJsonlByUuid(uuid);
  }

  // Total timeout check (10 seconds from start)
  if (!filePath && Date.now() - start < 10000) {
    const remaining = 10000 - (Date.now() - start);
    const deadline = Date.now() + remaining;
    while (Date.now() < deadline && !filePath) {
      if (fs.existsSync(expectedPath)) {
        filePath = expectedPath;
      } else {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }

  if (!filePath) {
    bus.emit({
      kind: 'error',
      timestamp: new Date(),
      runId,
      phaseNumber,
      message: `jsonl file for session ${uuid} not found after 10s`,
    });
    return () => { };
  }

  const resolvedPath = filePath;
  let offset = 0;
  const pendingEdits = new Map<string, EditEvent | BashEvent>();
  const logPending = new Map<string, { name: string; cmd: string }>();
  let partial = '';

  let logStream: fs.WriteStream | null = null;
  if (logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
  }

  const watcher = fs.watch(resolvedPath, () => {
    let fd: number;
    try {
      fd = fs.openSync(resolvedPath, 'r');
    } catch {
      return;
    }
    try {
      const stat = fs.fstatSync(fd);
      const newBytes = stat.size - offset;
      if (newBytes <= 0) return;
      const buf = Buffer.allocUnsafe(newBytes);
      fs.readSync(fd, buf, 0, newBytes, offset);
      offset = stat.size;
      const text = partial + buf.toString('utf8');
      const lines = text.split('\n');
      // Last element may be partial — retain it
      partial = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        // Every new raw line is harness activity (the same stream the live tail
        // consumes). This is the granular signal the activity-timeout uses, so a
        // run that is making progress — even setup/snapshot lines between model
        // turns — is not killed. RunGuard suppresses identical repeats.
        onActivity?.(line);
        let entry: unknown;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        for (const event of classifyJsonlEntry(entry, runId, phaseNumber, pendingEdits, worktreePath)) {
          bus.emit(event);
        }
        if (logStream) {
          writeEntryToLog(entry, logStream, logPending);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  });

  return () => {
    watcher.close();
    logStream?.end();
  };
}

function logTs(): string {
  return new Date().toISOString().slice(11, 19);
}

function writeEntryToLog(
  entry: unknown,
  stream: fs.WriteStream,
  pending: Map<string, { name: string; cmd: string }>,
): void {
  if (!entry || typeof entry !== 'object') return;
  const e = entry as Record<string, unknown>;
  const ts = logTs();

  if (e['type'] === 'assistant') {
    const content = (e['message'] as Record<string, unknown> | undefined)?.['content'];
    if (!Array.isArray(content)) return;
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const i = item as Record<string, unknown>;
      if (i['type'] === 'text') {
        const text = String(i['text'] ?? '').trim();
        if (text) {
          const firstLine = text.split('\n')[0]!.slice(0, 200);
          stream.write(`${ts} TEXT  ${firstLine}\n`);
        }
      } else if (i['type'] === 'tool_use') {
        const id = String(i['id'] ?? '');
        const name = String(i['name'] ?? '');
        const input = (i['input'] ?? {}) as Record<string, unknown>;
        if (name === 'Bash') {
          const cmd = String(input['command'] ?? '');
          pending.set(id, { name, cmd });
          stream.write(`${ts} BASH  ${cmd.slice(0, 200)}\n`);
        } else if (name === 'Edit' || name === 'Write') {
          const fp = String(input['file_path'] ?? input['path'] ?? '<unknown>');
          pending.set(id, { name, cmd: fp });
          stream.write(`${ts} EDIT  ${fp}\n`);
        } else if (name === 'Read') {
          const fp = String(input['file_path'] ?? input['path'] ?? '<unknown>');
          stream.write(`${ts} READ  ${fp}\n`);
        }
      }
    }
    return;
  }

  if (e['type'] === 'attachment') {
    const att = e['attachment'] as Record<string, unknown> | undefined;
    if (att?.['type'] === 'hook_success') {
      const stdout = String(att['stdout'] ?? '');
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        const hso = parsed['hookSpecificOutput'] as Record<string, unknown> | undefined;
        const updated = hso?.['updatedInput'] as Record<string, unknown> | undefined;
        const rewritten = updated?.['command'] as string | undefined;
        if (rewritten) {
          stream.write(`${ts} RTK   ${rewritten.slice(0, 200)}\n`);
        }
      } catch { /* not RTK output */ }
    }
    return;
  }

  if (e['type'] === 'user') {
    const content = (e['message'] as Record<string, unknown> | undefined)?.['content'];
    if (!Array.isArray(content)) return;
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const i = item as Record<string, unknown>;
      if (i['type'] !== 'tool_result') continue;
      const toolUseId = String(i['tool_use_id'] ?? '');
      pending.delete(toolUseId);
      const resultText = extractResultText(i['content']).trim();
      const firstLine = resultText.split('\n')[0]?.slice(0, 200) ?? '';
      if (firstLine) {
        stream.write(`${ts} OUT   ${firstLine}\n`);
      }
    }
  }
}

// Git commit output: "[branch-or-sha] message" on the first line
const GIT_COMMIT_RE = /^\[(\S+)\s+([0-9a-f]{7,40})\]\s+(.+)/m;

function extractResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content) && content.length > 0) {
    return String((content[0] as Record<string, unknown>)?.['text'] ?? '');
  }
  return '';
}

export function classifyJsonlEntry(
  entry: unknown,
  runId: string,
  phaseNumber: number,
  pendingEdits: Map<string, EditEvent | BashEvent>,
  worktreePath?: string,
): ActivityEvent[] {
  if (!entry || typeof entry !== 'object') return [];
  const e = entry as Record<string, unknown>;

  // Rate-limit error
  if (e['isApiErrorMessage'] === true && e['apiErrorStatus'] === 429) {
    return [{
      kind: 'limit',
      timestamp: new Date(),
      runId,
      phaseNumber,
      resumeAt: new Date(Date.now() + 5 * 60 * 1000),
    }];
  }

  // Assistant turn: text narration + tool calls
  if (e['type'] === 'assistant') {
    const message = e['message'] as Record<string, unknown> | undefined;
    const content = message?.['content'];
    if (!Array.isArray(content)) return [];

    const events: ActivityEvent[] = [];
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const i = item as Record<string, unknown>;

      if (i['type'] === 'text') {
        const text = (i['text'] as string ?? '').trim();
        if (text) {
          events.push({ kind: 'text', timestamp: new Date(), runId, phaseNumber, text });
        }
      } else if (i['type'] === 'tool_use') {
        const id = i['id'] as string;
        const name = i['name'] as string;
        const input = (i['input'] ?? {}) as Record<string, unknown>;

        if (name === 'Edit' || name === 'Write') {
          let filePath = (input['file_path'] ?? input['path'] ?? '<unknown>') as string;
          if (worktreePath && filePath.startsWith(worktreePath)) {
            filePath = filePath.slice(worktreePath.length).replace(/^\//, '');
          }
          const ev: EditEvent = {
            kind: 'edit', timestamp: new Date(), runId, phaseNumber,
            file: filePath,
            additions: 0, deletions: 0, inProgress: true, toolUseId: id,
          };
          pendingEdits.set(id, ev);
          events.push(ev);
        } else if (name === 'Bash') {
          const ev: BashEvent = {
            kind: 'bash', timestamp: new Date(), runId, phaseNumber,
            command: (input['command'] ?? '<bash>') as string,
            toolUseId: id,
          };
          pendingEdits.set(id, ev);
          events.push(ev);
        }
      }
    }
    return events;
  }

  // Tool results arrive as user messages in the JSONL format
  if (e['type'] === 'user') {
    const message = e['message'] as Record<string, unknown> | undefined;
    const content = message?.['content'];
    if (!Array.isArray(content)) return [];

    const events: ActivityEvent[] = [];
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const i = item as Record<string, unknown>;
      if (i['type'] !== 'tool_result') continue;

      const toolUseId = i['tool_use_id'] as string | undefined;
      if (!toolUseId) continue;
      const pending = pendingEdits.get(toolUseId);
      if (!pending) continue;
      pendingEdits.delete(toolUseId);

      const resultText = extractResultText(i['content']).slice(0, 200);

      if (pending.kind === 'edit') {
        events.push({ ...pending, inProgress: false, timestamp: new Date() });
      } else if (pending.kind === 'bash') {
        const commitMatch = GIT_COMMIT_RE.exec(resultText);
        if (commitMatch) {
          // Promote to a commit event
          events.push({
            kind: 'commit', timestamp: new Date(), runId, phaseNumber,
            sha: commitMatch[2]!,
            message: commitMatch[3]!.slice(0, 72),
          });
        } else {
          events.push({ ...pending, result: resultText.slice(0, 120), timestamp: new Date() });
        }
      }
    }
    return events;
  }

  return [];
}
