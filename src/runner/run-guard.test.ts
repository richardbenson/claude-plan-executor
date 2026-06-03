import { describe, it, expect } from 'bun:test';
import { RunGuard, registerGuard, unregisterGuard, requestBail } from './run-guard.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('RunGuard', () => {
  it('aborts after the inactivity window with no activity', async () => {
    const g = new RunGuard({ inactivityMs: 60 });
    g.start();
    expect(g.signal.aborted).toBe(false);
    await sleep(120);
    expect(g.signal.aborted).toBe(true);
    expect(g.reason).toBe('timeout-inactivity');
    expect(g.outcome).toBe('timeout');
  });

  it('stays alive while new activity keeps arriving, then times out', async () => {
    const g = new RunGuard({ inactivityMs: 80 });
    g.start();
    for (let i = 0; i < 4; i++) {
      await sleep(40);
      g.noteActivity(`line-${i}`); // each distinct -> resets the timer
    }
    expect(g.signal.aborted).toBe(false); // ~160ms elapsed but never idle 80ms
    await sleep(140);
    expect(g.signal.aborted).toBe(true);
    expect(g.reason).toBe('timeout-inactivity');
  });

  it('treats repeated identical output as no new activity (anti-runaway)', async () => {
    const g = new RunGuard({ inactivityMs: 80 });
    g.start();
    for (let i = 0; i < 4; i++) {
      await sleep(30);
      g.noteActivity('SAME LINE'); // repeats must NOT keep it alive
    }
    await sleep(60); // total idle (by signature) now exceeds 80ms
    expect(g.signal.aborted).toBe(true);
    expect(g.reason).toBe('timeout-inactivity');
  });

  it('honours the absolute max-runtime cap even with activity', async () => {
    const g = new RunGuard({ inactivityMs: 1000, maxRuntimeMs: 100 });
    g.start();
    const iv = setInterval(() => g.noteActivity(`t-${Date.now()}`), 20);
    await sleep(180);
    clearInterval(iv);
    expect(g.signal.aborted).toBe(true);
    expect(g.reason).toBe('timeout-maxruntime');
    expect(g.outcome).toBe('timeout');
  });

  it('bails on request and records bailed', () => {
    const g = new RunGuard({ inactivityMs: 10_000 });
    g.start();
    registerGuard('run-x', g);
    expect(requestBail('run-x')).toBe(true);
    expect(g.signal.aborted).toBe(true);
    expect(g.reason).toBe('bailed');
    expect(g.outcome).toBe('bailed');
    unregisterGuard('run-x');
    expect(requestBail('run-x')).toBe(false); // unregistered
  });

  it('does not fire after dispose', async () => {
    const g = new RunGuard({ inactivityMs: 50 });
    g.start();
    g.dispose();
    await sleep(90);
    expect(g.signal.aborted).toBe(false);
    expect(g.outcome).toBe(null);
  });
});
