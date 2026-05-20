import { describe, expect, test } from 'bun:test';
import { ActivityBus } from './bus.js';
import type { OkEvent } from './types.js';

function makeOkEvent(overrides: Partial<OkEvent> = {}): OkEvent {
  return {
    kind: 'ok',
    timestamp: new Date(),
    runId: 'run-1',
    phaseNumber: 1,
    summary: 'done',
    costUsd: 0.01,
    ...overrides,
  };
}

describe('ActivityBus', () => {
  test('starts with empty buffer', () => {
    const bus = new ActivityBus();
    expect(bus.getBuffer()).toEqual([]);
  });

  test('emits events to subscribers', () => {
    const bus = new ActivityBus();
    const received: unknown[] = [];
    bus.subscribe(e => received.push(e));
    const event = makeOkEvent();
    bus.emit(event);
    expect(received).toEqual([event]);
  });

  test('unsubscribe stops delivery', () => {
    const bus = new ActivityBus();
    const received: unknown[] = [];
    const unsub = bus.subscribe(e => received.push(e));
    unsub();
    bus.emit(makeOkEvent());
    expect(received).toHaveLength(0);
  });

  test('ring buffer drops oldest entry at capacity', () => {
    const bus = new ActivityBus();
    const capacity = 200;
    for (let i = 0; i < capacity + 1; i++) {
      bus.emit(makeOkEvent({ summary: `event-${i}` }));
    }
    const buf = bus.getBuffer();
    expect(buf).toHaveLength(capacity);
    expect((buf[0] as OkEvent).summary).toBe('event-1');
    expect((buf[capacity - 1] as OkEvent).summary).toBe(`event-${capacity}`);
  });

  test('clear empties the buffer', () => {
    const bus = new ActivityBus();
    bus.emit(makeOkEvent());
    bus.clear();
    expect(bus.getBuffer()).toHaveLength(0);
  });

  test('subscriber errors do not crash the bus', () => {
    const bus = new ActivityBus();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    expect(() => bus.emit(makeOkEvent())).not.toThrow();
  });
});
