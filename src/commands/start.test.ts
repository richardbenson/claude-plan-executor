import { describe, it, expect } from 'bun:test';
import { interruptiblePause } from './start.js';

describe('interruptiblePause', () => {
  it('returns immediately for a non-positive duration', async () => {
    const t0 = Date.now();
    await interruptiblePause(0, () => false);
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it('waits roughly the full duration when not paused', async () => {
    const t0 = Date.now();
    await interruptiblePause(300, () => false, 50);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(280);
  });

  it('cuts the wait short when paused', async () => {
    let calls = 0;
    // pause becomes true on the 2nd check -> should bail well before 5s
    const isPaused = () => ++calls >= 2;
    const t0 = Date.now();
    await interruptiblePause(5000, isPaused, 50);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
