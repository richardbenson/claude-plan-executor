import type { ActivityEvent } from './types.js';

const RING_BUFFER_CAPACITY = 200;

export class ActivityBus {
  private buffer: ActivityEvent[] = [];
  private subscribers: Set<(event: ActivityEvent) => void> = new Set();

  emit(event: ActivityEvent): void {
    if (this.buffer.length >= RING_BUFFER_CAPACITY) {
      this.buffer.shift();
    }
    this.buffer.push(event);
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch {
        // subscriber errors must not crash the bus
      }
    }
  }

  subscribe(handler: (event: ActivityEvent) => void): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  getBuffer(): readonly ActivityEvent[] {
    return this.buffer;
  }

  clear(): void {
    this.buffer = [];
  }
}

export const activityBus: ActivityBus = new ActivityBus();
