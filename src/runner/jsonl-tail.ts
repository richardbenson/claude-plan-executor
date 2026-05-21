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
): Promise<() => void> {
  const expectedPath = getExpectedJsonlPath(uuid, worktreePath);
  const start = Date.now();

  let filePath: string | null = null;

  // Poll for expected path up to 3 seconds
  while (Date.now() - start < 3000) {
    if (fs.existsSync(expectedPath)) {
      filePath = expectedPath;
      process.stderr.write(`[jsonl-tail] using expected path: ${filePath}\n`);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Glob fallback
  if (!filePath) {
    filePath = await findJsonlByUuid(uuid);
    if (filePath) {
      process.stderr.write(`[jsonl-tail] found via glob: ${filePath}\n`);
    }
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
    process.stderr.write(`[jsonl-tail] warning: jsonl file for session ${uuid} not found after 10s\n`);
    return () => {};
  }

  const resolvedPath = filePath;
  let offset = 0;
  const pendingEdits = new Map<string, EditEvent | BashEvent>();
  let partial = '';

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
        let entry: unknown;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        const event = classifyJsonlEntry(entry, runId, phaseNumber, pendingEdits);
        if (event) bus.emit(event);
      }
    } finally {
      fs.closeSync(fd);
    }
  });

  return () => watcher.close();
}

export function classifyJsonlEntry(
  entry: unknown,
  runId: string,
  phaseNumber: number,
  pendingEdits: Map<string, EditEvent | BashEvent>,
): ActivityEvent | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;

  // Rate-limit error
  if (e['isApiErrorMessage'] === true && e['apiErrorStatus'] === 429) {
    return {
      kind: 'limit',
      timestamp: new Date(),
      runId,
      phaseNumber,
      resumeAt: new Date(Date.now() + 5 * 60 * 1000),
    };
  }

  // Tool use: assistant emitting tool calls
  if (e['type'] === 'assistant') {
    const message = e['message'] as Record<string, unknown> | undefined;
    const content = message?.['content'];
    if (!Array.isArray(content)) return null;

    let lastEvent: ActivityEvent | null = null;
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const i = item as Record<string, unknown>;
      if (i['type'] !== 'tool_use') continue;
      const id = i['id'] as string;
      const name = i['name'] as string;
      const input = (i['input'] ?? {}) as Record<string, unknown>;

      if (name === 'Edit' || name === 'Write') {
        const ev: EditEvent = {
          kind: 'edit',
          timestamp: new Date(),
          runId,
          phaseNumber,
          file: (input['file_path'] ?? input['path'] ?? '<unknown>') as string,
          additions: 0,
          deletions: 0,
          inProgress: true,
          toolUseId: id,
        };
        pendingEdits.set(id, ev);
        lastEvent = ev;
      } else if (name === 'Bash') {
        const ev: BashEvent = {
          kind: 'bash',
          timestamp: new Date(),
          runId,
          phaseNumber,
          command: (input['command'] ?? '<bash>') as string,
          toolUseId: id,
        };
        pendingEdits.set(id, ev);
        lastEvent = ev;
      }
    }
    return lastEvent;
  }

  // Tool result
  if (e['type'] === 'tool') {
    const content = e['content'];
    if (!Array.isArray(content)) return null;

    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const i = item as Record<string, unknown>;
      if (i['type'] !== 'tool_result') continue;
      const toolUseId = i['tool_use_id'] as string | undefined;
      if (!toolUseId) continue;
      const pending = pendingEdits.get(toolUseId);
      if (!pending) continue;

      pendingEdits.delete(toolUseId);

      if (pending.kind === 'edit') {
        const updated: EditEvent = { ...pending, inProgress: false, timestamp: new Date() };
        return updated;
      } else if (pending.kind === 'bash') {
        const resultContent = i['content'];
        const resultText =
          typeof resultContent === 'string'
            ? resultContent.slice(0, 120)
            : Array.isArray(resultContent)
              ? String((resultContent[0] as Record<string, unknown>)?.['text'] ?? '').slice(0, 120)
              : undefined;
        const updated: BashEvent = {
          ...pending,
          result: resultText,
          timestamp: new Date(),
        };
        return updated;
      }
    }
    return null;
  }

  return null;
}
