import { describe, it, expect } from 'vitest';
import { Mutex } from '../src/util/mutex.js';

describe('Mutex', () => {
  it('runs tasks exclusively', async () => {
    const m = new Mutex();
    const order: number[] = [];
    await Promise.all([
      m.runExclusive(async () => {
        order.push(1); await new Promise(r => setTimeout(r, 20)); order.push(2);
      }),
      m.runExclusive(async () => {
        order.push(3); await new Promise(r => setTimeout(r, 10)); order.push(4);
      }),
    ]);
    // Second task should start only after first completes
    expect(order).toEqual([1, 2, 3, 4]);
  });
});

