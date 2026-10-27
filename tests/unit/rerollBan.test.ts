import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/data';
import { createRunState, resetRunState } from '../../src/sim/RunState';
import { SeededRNG } from '../../src/sim/rng/SeededRNG';
import {
  FALLBACK_HEAL_OFFER,
  banOffer,
  canBan,
  drawOffers,
  rerollOffers,
  type UpgradeOffer,
} from '../../src/sim/upgrades/UpgradeSystem';

const key = (o: UpgradeOffer) => `${o.kind}:${o.partId ?? ''}:${o.mutationId ?? ''}`;

describe('rerollOffers', () => {
  it('decrements and prefers offers not currently shown', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = createRunState(seed);
      const rng = new SeededRNG(seed);
      const first = drawOffers(s, rng);
      const next = rerollOffers(s, rng, first)!;
      expect(next).toHaveLength(3);
      expect(s.build.rerolls).toBe(BALANCE.menu.rerolls - 1);
      // Fresh run: 6 new parts + starter level-up, so 3 unseen candidates always exist.
      const before = new Set(first.map(key));
      expect(next.some((o) => before.has(key(o)))).toBe(false);
    }
  });

  it('is a no-op at 0 rerolls', () => {
    const s = createRunState(3);
    s.build.rerolls = 0;
    const offers = drawOffers(s, new SeededRNG(1));
    expect(rerollOffers(s, new SeededRNG(2), offers)).toBeNull();
    expect(s.build.rerolls).toBe(0);
  });

  it('falls back to the full pool when too few unseen candidates remain', () => {
    const s = createRunState(4);
    // Max out everything except two level-ups: only 2 candidates exist.
    for (const p of s.config.bodyParts) if (!p.starter) s.build.banned.add(p.id);
    s.build.banned.delete('fangs');
    const offers = drawOffers(s, new SeededRNG(1));
    const next = rerollOffers(s, new SeededRNG(2), offers)!;
    expect(next.filter((o) => o.kind !== 'fallbackHeal').map(key).sort()).toEqual(
      offers.filter((o) => o.kind !== 'fallbackHeal').map(key).sort(),
    );
  });
});

describe('banOffer', () => {
  it('bans only newPart offers', () => {
    const s = createRunState(5);
    const levelUp: UpgradeOffer = { kind: 'levelUp', partId: 'blob_spit', rarity: 'common', fromLevel: 1, toLevel: 2, name: '', icon: '', descriptionKey: '' };
    const mutation: UpgradeOffer = { kind: 'mutation', mutationId: 'beholder_gaze', rarity: 'epic', name: '', icon: '', descriptionKey: '' };
    const heal: UpgradeOffer = { ...FALLBACK_HEAL_OFFER };
    const newPart: UpgradeOffer = { kind: 'newPart', partId: 'fangs', rarity: 'common', fromLevel: 0, toLevel: 1, name: 'Fangs', icon: '', descriptionKey: '' };
    const current = [levelUp, mutation, heal];
    for (let slot = 0; slot < 3; slot++) {
      expect(canBan(s, current[slot])).toBe(false);
      expect(banOffer(s, new SeededRNG(1), current, slot)).toBeNull();
    }
    expect(s.build.bans).toBe(BALANCE.menu.bans);
    expect(s.build.banned.size).toBe(0);

    const next = banOffer(s, new SeededRNG(1), [levelUp, newPart, heal], 1)!;
    expect(next).not.toBeNull();
    expect(s.build.banned.has('fangs')).toBe(true);
    expect(s.build.bans).toBe(BALANCE.menu.bans - 1);
    expect(next[0]).toEqual(levelUp);
    expect(next[2]).toEqual(heal);
    expect(next[1].partId).not.toBe('fangs');
    expect(key(next[1])).not.toBe(key(levelUp));
    for (let i = 0; i < 30; i++) expect(drawOffers(s, new SeededRNG(i)).some((o) => o.partId === 'fangs')).toBe(false);
  });

  it('owned parts are not bannable and bans at 0 are no-ops', () => {
    const s = createRunState(6);
    s.build.parts.set('fangs', { level: 1, merged: false, rareBonuses: 0 });
    const stale: UpgradeOffer = { kind: 'newPart', partId: 'fangs', rarity: 'common', name: '', icon: '', descriptionKey: '' };
    expect(canBan(s, stale)).toBe(false);
    s.build.parts.delete('fangs');
    s.build.bans = 0;
    expect(canBan(s, stale)).toBe(false);
    expect(banOffer(s, new SeededRNG(1), [stale, stale, stale], 0)).toBeNull();
    expect(s.build.banned.size).toBe(0);
  });
});

describe('reset', () => {
  it('restores rerolls/bans from balance.menu and clears bans', () => {
    const s = createRunState(7);
    expect(s.build.rerolls).toBe(BALANCE.menu.rerolls);
    expect(s.build.bans).toBe(BALANCE.menu.bans);
    s.build.rerolls = 0;
    s.build.bans = 0;
    s.build.banned.add('fangs');
    resetRunState(s, 8);
    expect(s.build.rerolls).toBe(BALANCE.menu.rerolls);
    expect(s.build.bans).toBe(BALANCE.menu.bans);
    expect(s.build.banned.size).toBe(0);
  });
});
