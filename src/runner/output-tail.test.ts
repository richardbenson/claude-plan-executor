import { test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ActivityBus } from '../events/bus.js';
import { startOutputTail } from './output-tail.js';
import type { ActivityEvent, OutputEvent } from '../events/types.js';

function tmpLog(): string {
  return path.join(os.tmpdir(), `cpe-output-tail-${crypto.randomUUID()}.log`);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('emits one output event per appended non-empty line', async () => {
  const logPath = tmpLog();
  fs.writeFileSync(logPath, '');
  const bus = new ActivityBus();
  const seen: OutputEvent[] = [];
  bus.subscribe(e => { if (e.kind === 'output') seen.push(e); });

  const stop = startOutputTail(logPath, 'run-1', -1, bus, { intervalMs: 20 });
  fs.appendFileSync(logPath, 'first line\n');
  fs.appendFileSync(logPath, '\n');           // blank — must be skipped
  fs.appendFileSync(logPath, 'second line\n');
  await sleep(120);
  stop();

  expect(seen.map(e => e.line)).toEqual(['first line', 'second line']);
  expect(seen[0]!.runId).toBe('run-1');
});

test('a partial (unterminated) line is buffered until its newline arrives', async () => {
  const logPath = tmpLog();
  fs.writeFileSync(logPath, '');
  const bus = new ActivityBus();
  const seen: string[] = [];
  bus.subscribe(e => { if (e.kind === 'output') seen.push((e as OutputEvent).line); });

  const stop = startOutputTail(logPath, 'run-2', -1, bus, { intervalMs: 20 });
  fs.appendFileSync(logPath, 'incomplete');   // no newline yet
  await sleep(60);
  expect(seen).toEqual([]);                    // nothing emitted while partial
  fs.appendFileSync(logPath, ' now done\n');
  await sleep(60);
  stop();

  expect(seen).toEqual(['incomplete now done']);
});

test('stop() flushes a final terminated line and then goes silent', async () => {
  const logPath = tmpLog();
  fs.writeFileSync(logPath, '');
  const bus = new ActivityBus();
  const seen: string[] = [];
  bus.subscribe(e => { if (e.kind === 'output') seen.push((e as OutputEvent).line); });

  const stop = startOutputTail(logPath, 'run-3', -1, bus, { intervalMs: 500 });
  fs.appendFileSync(logPath, 'flushed on stop\n');
  stop(); // final pump happens synchronously inside stop
  expect(seen).toEqual(['flushed on stop']);

  fs.appendFileSync(logPath, 'after stop\n');
  await sleep(40);
  expect(seen).toEqual(['flushed on stop']); // no further events after stop
});

test('tolerates a log file that does not exist yet', async () => {
  const logPath = tmpLog(); // not created
  const bus = new ActivityBus();
  const events: ActivityEvent[] = [];
  bus.subscribe(e => events.push(e));

  const stop = startOutputTail(logPath, 'run-4', -1, bus, { intervalMs: 20 });
  await sleep(60);
  fs.writeFileSync(logPath, 'appeared late\n');
  await sleep(60);
  stop();

  expect(events.filter(e => e.kind === 'output').map(e => (e as OutputEvent).line)).toEqual(['appeared late']);
});
