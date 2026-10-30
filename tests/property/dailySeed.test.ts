// Feature: monster-mash-survivor, Property 23: Daily seed is deterministic per UTC date
// Validates: Requirements 27.1
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dailySeed, fnv1a32, utcDateKey } from '../../src/meta/DailyChallenge';

const DAY_MS = 86_400_000;
// 2024-01-01 .. ~2030-01-01 as UTC day offsets.
const dayOffsetArb = fc.integer({ min: 0, max: 2191 });
const EPOCH = Date.UTC(2024, 0, 1);

describe('Property 23: daily seed is deterministic per UTC date', () => {
  it('any two instants on the same UTC date give the same seed', () => {
    fc.assert(
      fc.property(
        dayOffsetArb,
        fc.integer({ min: 0, max: DAY_MS - 1 }),
        fc.integer({ min: 0, max: DAY_MS - 1 }),
        (days, msA, msB) => {
          const a = new Date(EPOCH + days * DAY_MS + msA);
          const b = new Date(EPOCH + days * DAY_MS + msB);
          expect(utcDateKey(a)).toBe(utcDateKey(b));
          expect(dailySeed(a)).toBe(dailySeed(b));
          expect(dailySeed(a)).toBe(fnv1a32(`mms-daily-${utcDateKey(a)}`));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('consecutive UTC dates give different seeds', () => {
    fc.assert(
      fc.property(dayOffsetArb, (days) => {
        const a = new Date(EPOCH + days * DAY_MS);
        const b = new Date(EPOCH + (days + 1) * DAY_MS);
        expect(dailySeed(a)).not.toBe(dailySeed(b));
      }),
      { numRuns: 200 },
    );
  });
});
