// Feature: monster-mash-survivor, Property 21: Closing ring has a passable gap
// Validates: Requirements 23.3
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildRing, RING_GAP_PLAYER_RADII } from '../../src/sim/systems/swarm';

/** Largest angular gap between consecutive occupied angles (wrapping around the circle). */
function largestGap(angles: number[]): number {
  const s = angles.map((a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((x, y) => x - y);
  let best = s[0] + 2 * Math.PI - s[s.length - 1];
  for (let i = 1; i < s.length; i++) best = Math.max(best, s[i] - s[i - 1]);
  return best;
}

describe('Property 21: Closing ring has a passable gap', () => {
  it('returns exactly `count` angles with a gap ≥ 2.5 × player diameter', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 6, max: 60 }),
        fc.double({ min: 200, max: 900, noNaN: true }),
        fc.double({ min: 10, max: 30, noNaN: true }),
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        (count, radius, playerRadius, rot) => {
          const ring = buildRing(count, radius, playerRadius, rot);
          expect(ring.angles).toHaveLength(count);
          expect(ring.gapSlots).toBeGreaterThanOrEqual(1);
          const gapArc = largestGap(ring.angles) * radius;
          expect(gapArc).toBeGreaterThanOrEqual(2 * playerRadius);
          expect(gapArc).toBeGreaterThanOrEqual(RING_GAP_PLAYER_RADII * playerRadius - 1e-6);
          // gapSlots is minimal: one fewer skipped slot would not leave a wide enough gap.
          if (ring.gapSlots > 1) {
            const g = ring.gapSlots - 1;
            expect((g + 1) * ((2 * Math.PI * radius) / (count + g))).toBeLessThan(RING_GAP_PLAYER_RADII * playerRadius);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
