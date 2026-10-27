// Feature: monster-mash-survivor, Property 20: Rerolls and bans counters
// Validates: Requirements 25.2, 25.3, 25.4, 25.5, 25.6, 25.7
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRunState, type RunState } from '../../src/sim/RunState';
import { SeededRNG } from '../../src/sim/rng/SeededRNG';
import { installMutationHooks } from '../../src/sim/upgrades/MutationSystem';
import {
  applyOffer,
  banOffer,
  canBan,
  drawOffers,
  rerollOffers,
  type UpgradeOffer,
} from '../../src/sim/upgrades/UpgradeSystem';

beforeAll(() => installMutationHooks());

type Action = { t: 'reroll' } | { t: 'ban'; slot: number } | { t: 'select'; slot: number };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.constant<Action>({ t: 'reroll' }),
  fc.integer({ min: 0, max: 2 }).map<Action>((slot) => ({ t: 'ban', slot })),
  fc.integer({ min: 0, max: 2 }).map<Action>((slot) => ({ t: 'select', slot })),
);

const key = (o: UpgradeOffer) => `${o.kind}:${o.partId ?? ''}:${o.mutationId ?? ''}`;

function snapshot(s: RunState) {
  return {
    rerolls: s.build.rerolls,
    bans: s.build.bans,
    banned: [...s.build.banned].sort(),
    parts: [...s.build.parts.entries()].map(([id, p]) => `${id}:${p.level}:${p.rareBonuses}`).sort(),
  };
}

function checkOffers(s: RunState, offers: UpgradeOffer[]): void {
  expect(offers).toHaveLength(3);
  const real = offers.filter((o) => o.kind !== 'fallbackHeal');
  expect(new Set(real.map(key)).size).toBe(real.length);
  for (const o of offers) {
    // 25.7: a banned part is never offered (as a new part or otherwise).
    if (o.partId !== undefined) expect(s.build.banned.has(o.partId)).toBe(false);
    // 25.6: only unowned new parts are bannable.
    if (o.kind !== 'newPart') expect(canBan(s, o)).toBe(false);
  }
}

describe('Property 20: Rerolls and bans counters', () => {
  it('counters never go negative, actions at 0 are no-ops, banned parts never return, owned parts never bannable', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.array(actionArb, { minLength: 1, maxLength: 40 }),
        (seed, actions) => {
          const s = createRunState(seed);
          const rng = new SeededRNG(seed ^ 0x5eed);
          let offers = drawOffers(s, rng);
          checkOffers(s, offers);

          for (const a of actions) {
            const before = snapshot(s);
            if (a.t === 'reroll') {
              const next = rerollOffers(s, rng, offers);
              if (before.rerolls <= 0) {
                expect(next).toBeNull();
                expect(snapshot(s)).toEqual(before);
              } else {
                expect(next).not.toBeNull();
                expect(s.build.rerolls).toBe(before.rerolls - 1);
                expect(s.build.bans).toBe(before.bans);
                offers = next!;
              }
            } else if (a.t === 'ban') {
              const target = offers[a.slot];
              const bannable = before.bans > 0 && target.kind === 'newPart';
              const next = banOffer(s, rng, offers, a.slot);
              if (!bannable) {
                expect(next).toBeNull();
                expect(snapshot(s)).toEqual(before);
              } else {
                expect(next).not.toBeNull();
                expect(s.build.bans).toBe(before.bans - 1);
                expect(s.build.banned.has(target.partId!)).toBe(true);
                expect(s.build.parts.has(target.partId!)).toBe(false);
                // Only the banned slot changed.
                for (let i = 0; i < 3; i++) if (i !== a.slot) expect(next![i]).toEqual(offers[i]);
                offers = next!;
              }
            } else {
              applyOffer(s, offers[a.slot]);
              offers = drawOffers(s, rng);
            }
            expect(s.build.rerolls).toBeGreaterThanOrEqual(0);
            expect(s.build.bans).toBeGreaterThanOrEqual(0);
            // Owned parts are never banned.
            for (const id of s.build.banned) expect(s.build.parts.has(id)).toBe(false);
            checkOffers(s, offers);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
