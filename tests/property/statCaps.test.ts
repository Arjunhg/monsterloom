// Feature: monster-mash-survivor, Property 16: Stat multipliers stay capped
// Validates: Requirements 12.1, 26.5
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/data';
import { MAX_STAT_BONUS_LEVEL, defaultMetaState, statMultipliersFor } from '../../src/meta/MetaProgression';
import { STAT_FLOOR, STAT_KEYS, clampStats, type StatMultipliers } from '../../src/sim/StatCaps';

const multiplierArb = fc.double({ min: -5, max: 10, noNaN: true, noDefaultInfinity: true });

describe('Property 16: stat multipliers stay capped (including meta bonuses)', () => {
  it('upgrade multipliers combined with meta stat bonuses never exceed the caps', () => {
    fc.assert(
      fc.property(
        fc.record({
          damage: multiplierArb,
          attackSpeed: multiplierArb,
          moveSpeed: multiplierArb,
          pickupRadius: multiplierArb,
        }),
        fc.record({
          damage: fc.integer({ min: 0, max: MAX_STAT_BONUS_LEVEL }),
          attackSpeed: fc.integer({ min: 0, max: MAX_STAT_BONUS_LEVEL }),
          moveSpeed: fc.integer({ min: 0, max: MAX_STAT_BONUS_LEVEL }),
          pickupRadius: fc.integer({ min: 0, max: MAX_STAT_BONUS_LEVEL }),
        }),
        (base, levels) => {
          const meta = defaultMetaState();
          meta.statBonuses = { ...levels };
          const metaMul = statMultipliersFor(meta);
          const combined: StatMultipliers = {
            damage: base.damage * metaMul.damage,
            attackSpeed: base.attackSpeed * metaMul.attackSpeed,
            moveSpeed: base.moveSpeed * metaMul.moveSpeed,
            pickupRadius: base.pickupRadius * metaMul.pickupRadius,
          };
          clampStats(combined, BALANCE.caps);
          for (const k of STAT_KEYS) {
            expect(combined[k]).toBeGreaterThanOrEqual(STAT_FLOOR);
            expect(combined[k]).toBeLessThanOrEqual(BALANCE.caps[k]);
          }
          // Meta multipliers themselves are small, finite and >= 1.
          for (const k of STAT_KEYS) {
            expect(metaMul[k]).toBeGreaterThanOrEqual(1);
            expect(metaMul[k]).toBeLessThanOrEqual(1.25);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
