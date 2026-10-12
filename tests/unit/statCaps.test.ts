import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/data';
import { STAT_FLOOR, clampStats, defaultStats } from '../../src/sim/StatCaps';
import { safeNormalize } from '../../src/sim/math';

describe('StatCaps', () => {
  it('clamps every multiplier to [floor, cap] and repairs non-finite values', () => {
    const s = { damage: 99, attackSpeed: -5, moveSpeed: NaN, pickupRadius: 1.2 };
    clampStats(s, BALANCE.caps);
    expect(s.damage).toBe(BALANCE.caps.damage);
    expect(s.attackSpeed).toBe(STAT_FLOOR);
    expect(s.moveSpeed).toBe(1);
    expect(s.pickupRadius).toBe(1.2);
  });

  it('defaults are all 1 and within caps', () => {
    const s = defaultStats();
    expect(clampStats({ ...s }, BALANCE.caps)).toEqual(s);
  });
});

describe('safeNormalize', () => {
  it('returns (0,0) for zero and non-finite input, unit length otherwise', () => {
    const out = { x: 9, y: 9 };
    expect(safeNormalize(0, 0, out)).toEqual({ x: 0, y: 0 });
    expect(safeNormalize(NaN, 1, out)).toEqual({ x: 0, y: 0 });
    expect(safeNormalize(Infinity, 1, out)).toEqual({ x: 0, y: 0 });
    safeNormalize(3, 4, out);
    expect(out.x).toBeCloseTo(0.6);
    expect(out.y).toBeCloseTo(0.8);
  });
});
