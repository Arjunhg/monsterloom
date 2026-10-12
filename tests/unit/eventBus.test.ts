import { describe, expect, it } from 'vitest';
import { EventBus, EventType } from '../../src/sim/EventBus';

describe('EventBus', () => {
  it('drains in push order with payloads, then empties', () => {
    const bus = new EventBus(8);
    bus.push(EventType.enemyHit, 3, 10);
    bus.push(EventType.levelUp, 1);
    const out: number[][] = [];
    bus.drain((t, a, b, c, d) => out.push([t, a, b, c, d]));
    expect(out).toEqual([
      [EventType.enemyHit, 3, 10, 0, 0],
      [EventType.levelUp, 1, 0, 0, 0],
    ]);
    expect(bus.count).toBe(0);
  });

  it('drops the oldest event on overflow', () => {
    const bus = new EventBus(3);
    for (let i = 1; i <= 5; i++) bus.push(EventType.orbCollected, i);
    const vals: number[] = [];
    bus.drain((_t, a) => vals.push(a));
    expect(vals).toEqual([3, 4, 5]);
    expect(bus.overflowCount).toBe(2);
  });

  it('defers events pushed during drain to the next drain', () => {
    const bus = new EventBus(8);
    bus.push(EventType.merge, 1);
    let n = 0;
    bus.drain(() => {
      n++;
      bus.push(EventType.merge, 2);
    });
    expect(n).toBe(1);
    expect(bus.count).toBe(1);
  });
});
