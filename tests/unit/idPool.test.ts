import { describe, expect, it } from 'vitest';
import { IdPool } from '../../src/sim/pool/IdPool';

describe('IdPool', () => {
  it('allocates 0..n-1 after reset and returns -1 when exhausted', () => {
    const p = new IdPool(3);
    expect([p.alloc(), p.alloc(), p.alloc()]).toEqual([0, 1, 2]);
    expect(p.alloc()).toBe(-1);
    expect(p.count).toBe(3);
  });

  it('guards double free and out-of-range ids', () => {
    const p = new IdPool(2);
    const a = p.alloc();
    expect(p.free(a)).toBe(true);
    expect(p.free(a)).toBe(false);
    expect(p.free(-1)).toBe(false);
    expect(p.free(99)).toBe(false);
    expect(p.count).toBe(0);
  });

  it('keeps a dense active list and allows freeing during forEachAlive', () => {
    const p = new IdPool(5);
    for (let i = 0; i < 5; i++) p.alloc();
    p.free(1);
    p.free(3);
    const seen: number[] = [];
    p.forEachAlive((id) => {
      seen.push(id);
      p.free(id);
    });
    expect(seen.sort()).toEqual([0, 2, 4]);
    expect(p.count).toBe(0);
  });

  it('reuses freed ids and reset frees everything', () => {
    const p = new IdPool(2);
    p.alloc();
    const b = p.alloc();
    p.free(b);
    expect(p.alloc()).toBe(b);
    p.reset();
    expect(p.count).toBe(0);
    expect(p.isAlive(0)).toBe(false);
  });
});
