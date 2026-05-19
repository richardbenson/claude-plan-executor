import { describe, it, expect } from 'bun:test';
import { parseResetTime } from './reset-time.js';

function makeMsg(time: string): string {
  return `You've hit your limit · resets ${time}`;
}

describe('parseResetTime', () => {
  it('parses 4pm (Europe/London) with now before 4pm UK time', () => {
    // now = 3pm UTC on a summer day when London is UTC+1, so 3pm UTC = 4pm London
    // We want now to be BEFORE 4pm London, so use 2pm UTC (= 3pm London)
    const now = new Date('2025-06-15T13:00:00Z'); // 2pm UTC = 3pm London (BST = UTC+1)
    const result = parseResetTime(makeMsg('4pm (Europe/London)'), now);
    expect(result).not.toBeNull();
    // 4pm London BST = 15:00 UTC
    expect(result!.toISOString()).toBe('2025-06-15T15:00:00.000Z');
  });

  it('parses 11:30am (America/New_York)', () => {
    // EST = UTC-5, EDT = UTC-4. June = EDT (UTC-4)
    const now = new Date('2025-06-15T14:00:00Z'); // 10am NY time (UTC-4)
    const result = parseResetTime(makeMsg('11:30am (America/New_York)'), now);
    expect(result).not.toBeNull();
    // 11:30am EDT = 15:30 UTC
    expect(result!.toISOString()).toBe('2025-06-15T15:30:00.000Z');
  });

  it('adds 24 hours if parsed time is in the past', () => {
    // now = 5pm UTC, London is BST (UTC+1), so 5pm UTC = 6pm London
    // 4pm London has already passed
    const now = new Date('2025-06-15T17:00:00Z'); // 6pm London
    const result = parseResetTime(makeMsg('4pm (Europe/London)'), now);
    expect(result).not.toBeNull();
    // 4pm London = 15:00 UTC today, but that's past, so add 24h → next day 15:00 UTC
    expect(result!.toISOString()).toBe('2025-06-16T15:00:00.000Z');
  });

  it('returns null for unrecognised format', () => {
    const result = parseResetTime('No hit message here');
    expect(result).toBeNull();
  });

  it('returns null for bad timezone without throwing', () => {
    const result = parseResetTime(makeMsg('4pm (Invalid/Zone)'));
    expect(result).toBeNull();
  });

  it('returns a Date for valid input with no now arg (smoke test)', () => {
    const result = parseResetTime(makeMsg('4pm (Europe/London)'));
    expect(result).not.toBeNull();
    expect(result).toBeInstanceOf(Date);
  });
});
