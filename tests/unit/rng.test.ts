import { describe, it, expect } from 'vitest';
import { SeededRNG, fnv1a32, newSeed, normalizeSeed, createRunStreams } from '../../src/sim/rng/SeededRNG';

const take = (rng: SeededRNG, n: number): number[] => Array.from({ length: n }, () => rng.next());

describe('SeededRNG', () => {
  it('same seed produces the same sequence, values in [0,1)', () => {
    const a = take(new SeededRNG(12345), 200);
    const b = take(new SeededRNG(12345), 200);
    expect(a).toEqual(b);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(take(new SeededRNG(12346), 200)).not.toEqual(a);
  });

  it('normalizes seeds to uint32', () => {
    expect(new SeededRNG(-1).seed).toBe(0xffffffff);
    expect(new SeededRNG(2 ** 32 + 5).seed).toBe(5);
    expect(new SeededRNG(NaN).seed).toBe(0);
    expect(normalizeSeed(3.9)).toBe(3);
    expect(take(new SeededRNG(-1), 10)).toEqual(take(new SeededRNG(0xffffffff), 10));
  });

  it('fork streams are deterministic and differ from each other', () => {
    const names = ['spawn', 'drops', 'upgrades', 'ai'] as const;
    const s1 = createRunStreams(42);
    const s2 = createRunStreams(42);
    const seqs = names.map((n) => take(s1[n], 50));
    names.forEach((n, i) => expect(take(s2[n], 50)).toEqual(seqs[i]));
    for (let i = 0; i < seqs.length; i++) {
      for (let j = i + 1; j < seqs.length; j++) expect(seqs[i]).not.toEqual(seqs[j]);
    }
    // fork does not depend on parent draw count
    const root = new SeededRNG(42);
    take(root, 17);
    expect(take(root.fork('spawn'), 50)).toEqual(seqs[0]);
    // fork differs from parent and across seeds
    expect(take(new SeededRNG(42).fork('spawn'), 50)).not.toEqual(take(new SeededRNG(42), 50));
    expect(take(createRunStreams(43).spawn, 50)).not.toEqual(seqs[0]);
  });

  it('int bounds are inclusive', () => {
    const rng = new SeededRNG(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(1, 4);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(4);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
    expect(rng.int(5, 5)).toBe(5);
  });

  it('range stays in [min,max)', () => {
    const rng = new SeededRNG(9);
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(-2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(3);
    }
  });

  it('weighted never picks zero-weight items', () => {
    const rng = new SeededRNG(99);
    const items = [
      { id: 'a', w: 0 },
      { id: 'b', w: 1 },
      { id: 'c', w: 0 },
      { id: 'd', w: 3 },
      { id: 'e', w: -2 },
    ];
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const it = rng.weighted(items, (x) => x.w)!;
      counts[it.id] = (counts[it.id] ?? 0) + 1;
    }
    expect(counts.a).toBeUndefined();
    expect(counts.c).toBeUndefined();
    expect(counts.e).toBeUndefined();
    expect(counts.b).toBeGreaterThan(0);
    expect(counts.d).toBeGreaterThan(counts.b);
    expect(rng.weighted(items, () => 0)).toBeUndefined();
    expect(rng.weighted([], () => 1)).toBeUndefined();
  });

  it('pick and shuffle', () => {
    const rng = new SeededRNG(5);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    for (let i = 0; i < 100; i++) expect(arr).toContain(rng.pick(arr));
    expect(() => rng.pick([])).toThrow();
    const copy = arr.slice();
    const out = rng.shuffle(copy);
    expect(out).toBe(copy);
    expect(copy.slice().sort((x, y) => x - y)).toEqual(arr);
    const a = new SeededRNG(5).shuffle(arr.slice());
    const b = new SeededRNG(5).shuffle(arr.slice());
    expect(a).toEqual(b);
  });

  it('fnv1a32 and newSeed', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
    for (let i = 0; i < 20; i++) {
      const s = newSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
