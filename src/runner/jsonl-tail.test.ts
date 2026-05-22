import { describe, expect, test } from 'bun:test';
import { classifyJsonlEntry, encodeWorktreePath } from './jsonl-tail.js';
import type { BashEvent, EditEvent, LimitEvent } from '../events/types.js';

describe('encodeWorktreePath', () => {
  test('produces leading dash (matches Claude Code path encoding)', () => {
    expect(encodeWorktreePath('/home/ubuntu/Code/x')).toBe('-home-ubuntu-Code-x');
  });

  test('replaces dots and slashes with dashes', () => {
    expect(encodeWorktreePath('/home/ubuntu/.local/state/cpe/worktrees/01JXYZ/')).toBe(
      '-home-ubuntu--local-state-cpe-worktrees-01JXYZ-',
    );
  });
});

describe('classifyJsonlEntry', () => {
  const runId = 'run-test';
  const phaseNumber = 1;

  test('tool_use Edit → EditEvent with inProgress: true', () => {
    const pendingEdits = new Map();
    const entry = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'Edit',
            input: { file_path: 'src/foo.ts' },
          },
        ],
      },
    };
    const events = classifyJsonlEntry(entry, runId, phaseNumber, pendingEdits);
    expect(events.length).toBeGreaterThan(0);
    const ev = events[0] as EditEvent;
    expect(ev.kind).toBe('edit');
    expect(ev.file).toBe('src/foo.ts');
    expect(ev.inProgress).toBe(true);
    expect(ev.toolUseId).toBe('tu-1');
    expect(pendingEdits.has('tu-1')).toBe(true);
  });

  test('tool_use Write → EditEvent with inProgress: true', () => {
    const pendingEdits = new Map();
    const entry = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu-2',
            name: 'Write',
            input: { file_path: 'src/bar.ts' },
          },
        ],
      },
    };
    const events = classifyJsonlEntry(entry, runId, phaseNumber, pendingEdits);
    const ev = events[0] as EditEvent;
    expect(ev.kind).toBe('edit');
    expect(ev.inProgress).toBe(true);
  });

  test('tool_use Bash → BashEvent', () => {
    const pendingEdits = new Map();
    const entry = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu-3',
            name: 'Bash',
            input: { command: 'bun test' },
          },
        ],
      },
    };
    const events = classifyJsonlEntry(entry, runId, phaseNumber, pendingEdits);
    expect(events.length).toBeGreaterThan(0);
    const ev = events[0] as BashEvent;
    expect(ev.kind).toBe('bash');
    expect(ev.command).toBe('bun test');
    expect(ev.toolUseId).toBe('tu-3');
  });

  test('tool_result for pending Edit → EditEvent with inProgress: false', () => {
    const pendingEdits = new Map();
    // First emit the tool_use
    const toolUseEntry = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu-4', name: 'Edit', input: { file_path: 'src/x.ts' } }],
      },
    };
    classifyJsonlEntry(toolUseEntry, runId, phaseNumber, pendingEdits);

    // Tool results arrive as user messages in the JSONL format
    const resultEntry = {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu-4', content: 'ok' }],
      },
    };
    const events = classifyJsonlEntry(resultEntry, runId, phaseNumber, pendingEdits);
    expect(events.length).toBeGreaterThan(0);
    const ev = events[0] as EditEvent;
    expect(ev.kind).toBe('edit');
    expect(ev.inProgress).toBe(false);
    expect(pendingEdits.has('tu-4')).toBe(false);
  });

  test('unrecognised entry → empty array', () => {
    const pendingEdits = new Map();
    expect(classifyJsonlEntry({ type: 'text', content: 'hello' }, runId, phaseNumber, pendingEdits)).toHaveLength(0);
    expect(classifyJsonlEntry(null, runId, phaseNumber, pendingEdits)).toHaveLength(0);
    expect(classifyJsonlEntry(42, runId, phaseNumber, pendingEdits)).toHaveLength(0);
  });

  test('rate-limit entry → LimitEvent', () => {
    const pendingEdits = new Map();
    const entry = { isApiErrorMessage: true, apiErrorStatus: 429 };
    const events = classifyJsonlEntry(entry, runId, phaseNumber, pendingEdits);
    expect(events.length).toBeGreaterThan(0);
    const ev = events[0] as LimitEvent;
    expect(ev.kind).toBe('limit');
    expect(ev.resumeAt).toBeInstanceOf(Date);
  });
});
