// Feature: monster-mash-survivor, Property 22: Serialization round-trips (v3)
// Validates: Requirements 26.6, 26.7, 28.5, 28.6
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeChallenge, encodeChallenge, type ChallengePayload } from '../../src/meta/ChallengeLink';
import {
  MAX_STAT_BONUS_LEVEL,
  UNLOCK_CATALOGUE,
  deserializeMetaState,
  serializeMetaState,
  validateMetaState,
  type MetaState,
} from '../../src/meta/MetaProgression';

const unlockIds = UNLOCK_CATALOGUE.map((d) => d.id);

const metaStateArb: fc.Arbitrary<MetaState> = fc
  .record({
    currency: fc.integer({ min: 0, max: 1_000_000 }),
    unlocks: fc.uniqueArray(fc.constantFrom(...unlockIds), { maxLength: unlockIds.length }),
    statBonuses: fc.record(
      {
        damage: fc.integer({ min: 0, max: MAX_STAT_BONUS_LEVEL }),
        attackSpeed: fc.integer({ min: 0, max: MAX_STAT_BONUS_LEVEL }),
        moveSpeed: fc.integer({ min: 0, max: MAX_STAT_BONUS_LEVEL }),
        pickupRadius: fc.integer({ min: 0, max: MAX_STAT_BONUS_LEVEL }),
      },
      { withDeletedKeys: true },
    ),
    cosmetics: fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 4 }),
  })
  .map(({ currency, unlocks, statBonuses, cosmetics }): MetaState => {
    // Drop zero levels: validate() normalizes them out, so the canonical
    // form compared after a round trip must not carry them either.
    const bonuses: MetaState['statBonuses'] = {};
    for (const [k, v] of Object.entries(statBonuses)) if (v > 0) bonuses[k as keyof typeof bonuses] = v;
    return {
      version: 1,
      currency,
      unlocks,
      statBonuses: bonuses,
      cosmetics,
      equipped: cosmetics[0] ?? null,
    };
  });

const challengeArb: fc.Arbitrary<ChallengePayload> = fc
  .record({
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    score: fc.integer({ min: 0, max: 0xffffffff }),
    name: fc.option(fc.string({ minLength: 1, maxLength: 16 }), { nil: undefined }),
  })
  // encode() trims names and drops empty ones, so generate canonical names.
  .map(({ seed, score, name }) => {
    const clean = name?.trim();
    return clean ? { v: 1 as const, seed, score, name: clean } : { v: 1 as const, seed, score };
  });

describe('Property 22: serialization round-trips (v3)', () => {
  it('MetaProgression: deserialize(serialize(s)) equals s for every valid state', () => {
    fc.assert(
      fc.property(metaStateArb, (state) => {
        expect(deserializeMetaState(serializeMetaState(state))).toEqual(state);
        expect(validateMetaState(state)).toEqual(state);
      }),
      { numRuns: 200 },
    );
  });

  it('ChallengeLink: decode(encode(p)) equals p for every valid payload', () => {
    fc.assert(
      fc.property(challengeArb, (payload) => {
        expect(decodeChallenge(encodeChallenge(payload))).toEqual(payload);
      }),
      { numRuns: 200 },
    );
  });

  it('ChallengeLink: arbitrary strings decode to null or a valid payload, never throw', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const out = decodeChallenge(s);
        if (out !== null) {
          expect(out.v).toBe(1);
          // Anything decode accepts must survive a re-encode round trip.
          expect(decodeChallenge(encodeChallenge(out))).toEqual(out);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('ChallengeLink: single-character corruption of a valid code is rejected or still valid, never throws', () => {
    fc.assert(
      fc.property(challengeArb, fc.nat(), fc.string({ minLength: 1, maxLength: 1 }), (payload, at, ch) => {
        const code = encodeChallenge(payload);
        const i = at % code.length;
        const corrupted = code.slice(0, i) + ch + code.slice(i + 1);
        const out = decodeChallenge(corrupted);
        if (out !== null) expect(decodeChallenge(encodeChallenge(out))).toEqual(out);
      }),
      { numRuns: 200 },
    );
  });
});

describe('ChallengeLink malformed inputs', () => {
  it('rejects empty, truncated, and non-base64url strings', () => {
    expect(decodeChallenge('')).toBeNull();
    expect(decodeChallenge('!!!')).toBeNull();
    expect(decodeChallenge('AAAA')).toBeNull();
    const code = encodeChallenge({ v: 1, seed: 123, score: 456 });
    expect(decodeChallenge(code.slice(0, -2))).toBeNull();
    expect(decodeChallenge(`${code}AA`)).toBeNull();
  });

  it('encode truncates names to 16 characters and drops empty names', () => {
    const long = decodeChallenge(encodeChallenge({ v: 1, seed: 1, score: 2, name: 'ABCDEFGHIJKLMNOPQRST' }));
    expect(long?.name).toBe('ABCDEFGHIJKLMNOP');
    const empty = decodeChallenge(encodeChallenge({ v: 1, seed: 1, score: 2, name: '   ' }));
    expect(empty).toEqual({ v: 1, seed: 1, score: 2 });
  });
});
