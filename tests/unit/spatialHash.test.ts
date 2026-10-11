import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../../src/sim/spatial/SpatialHash';

const sorted = (a: number[]): number[] => [...a].sort((p, q) => p - q);

describe('SpatialHash', () => {
  it('returns nothing on an empty hash', () => {
    const h = new SpatialHash();
    const out = [99];
    expect(h.queryRadius(0, 0, 100, out)).toBe(0);
    expect(out).toEqual([]);
    expect(h.nearest(0, 0, 1000)).toBe(-1);
  });

  it('handles negative coordinates across cell boundaries', () => {
    const h = new SpatialHash(64);
    h.insert(1, -1, -1);
    h.insert(2, 1, 1);
    h.insert(3, -130, -5);
    h.insert(4, -500, -500);
    const out: number[] = [];
    expect(h.queryRadius(0, 0, 5, out)).toBe(2);
    expect(sorted(out)).toEqual([1, 2]);
    expect(sorted((h.queryRadius(-100, 0, 40, out), out))).toEqual([3]);
    expect(h.nearest(-120, -10, 200)).toBe(3);
    expect(h.nearest(-490, -490, 50)).toBe(4);
  });

  it('includes points exactly at distance r and handles r = 0 / maxR = 0', () => {
    const h = new SpatialHash(64);
    h.insert(7, 30, 40); // distance 50 from origin
    h.insert(8, 10, 10);
    const out: number[] = [];
    expect(h.queryRadius(0, 0, 50, out)).toBe(2);
    expect(h.queryRadius(0, 0, 49.999, out)).toBe(1);
    expect(out).toEqual([8]);
    expect(h.queryRadius(10, 10, 0, out)).toBe(1);
    expect(out).toEqual([8]);
    expect(h.queryRadius(11, 10, 0, out)).toBe(0);
    expect(h.nearest(0, 0, 50, (id) => id === 7)).toBe(7);
    expect(h.nearest(30, 40, 0)).toBe(7);
    expect(h.nearest(31, 40, 0)).toBe(-1);
    expect(h.nearest(0, 0, -1)).toBe(-1);
  });

  it('applies the nearest filter and respects maxR', () => {
    const h = new SpatialHash(64);
    h.insert(1, 5, 0);
    h.insert(2, 100, 0);
    h.insert(3, 300, 0);
    expect(h.nearest(0, 0, 1000)).toBe(1);
    expect(h.nearest(0, 0, 1000, (id) => id !== 1)).toBe(2);
    expect(h.nearest(0, 0, 1000, (id) => id === 3)).toBe(3);
    expect(h.nearest(0, 0, 299, (id) => id === 3)).toBe(-1);
    expect(h.nearest(0, 0, 1000, () => false)).toBe(-1);
  });

  it('nearest is exact when a closer point sits in a farther ring', () => {
    const h = new SpatialHash(64);
    // Query near the right edge of cell 0. Point A is in the same cell but far;
    // point B is in the neighbouring cell but closer.
    h.insert(1, 10, 33); // same cell as query, distance 53
    h.insert(2, 66, 33); // neighbouring cell, distance 3
    expect(h.nearest(63, 33, 500)).toBe(2);
  });

  it('nearest tie returns a minimum-distance id', () => {
    const h = new SpatialHash(64);
    h.insert(10, 100, 0);
    h.insert(11, -100, 0);
    h.insert(12, 0, 100);
    h.insert(13, 0, 150);
    const id = h.nearest(0, 0, 1000);
    expect([10, 11, 12]).toContain(id);
  });

  it('does not confuse cells whose hash keys collide', () => {
    // Cells (-1, 199) and (1, -199) hash to the same key.
    const key = (a: number, b: number) => Math.imul(a, 73856093) ^ Math.imul(b, 19349663);
    expect(key(-1, 199)).toBe(key(1, -199));
    const cs = 64;
    const h = new SpatialHash(cs);
    h.insert(1, 1 * cs + 10, -199 * cs + 10); // in cell (1, -199)
    h.insert(2, -1 * cs + 10, 199 * cs + 10); // in cell (-1, 199)
    const out: number[] = [];
    expect(h.queryRadius(-1 * cs + 10, 199 * cs + 10, 5, out)).toBe(1);
    expect(out).toEqual([2]);
    expect(h.queryRadius(-1 * cs + 20, 199 * cs + 20, 5, out)).toBe(0);
    expect(h.nearest(-1 * cs + 20, 199 * cs + 20, 100, (id) => id === 1)).toBe(-1);
    expect(h.nearest(1 * cs + 20, -199 * cs + 20, 100)).toBe(1);
  });

  it('reuses storage across clear() and matches brute force on a fixed set', () => {
    const h = new SpatialHash(32, 4);
    let s = 12345;
    const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32) * 1000 - 500;
    for (let round = 0; round < 3; round++) {
      h.clear();
      const pts: Array<[number, number, number]> = [];
      for (let i = 0; i < 200; i++) {
        const p: [number, number, number] = [i, rand(), rand()];
        pts.push(p);
        h.insert(p[0], p[1], p[2]);
      }
      expect(h.size).toBe(200);
      const out: number[] = [];
      for (let q = 0; q < 20; q++) {
        const qx = rand();
        const qy = rand();
        const r = Math.abs(rand()) / 2;
        const expected = pts.filter(([, x, y]) => Math.hypot(x - qx, y - qy) <= r).map((p) => p[0]);
        h.queryRadius(qx, qy, r, out);
        expect(sorted(out)).toEqual(sorted(expected));

        const n = h.nearest(qx, qy, r);
        const best = Math.min(Infinity, ...pts.map(([, x, y]) => Math.hypot(x - qx, y - qy)).filter((d) => d <= r));
        if (best === Infinity) expect(n).toBe(-1);
        else expect(Math.hypot(pts[n]![1] - qx, pts[n]![2] - qy)).toBeCloseTo(best, 9);
      }
    }
  });
});
