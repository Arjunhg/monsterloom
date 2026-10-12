import { afterEach, describe, expect, it } from 'vitest';
import { BODY_PARTS } from '../../src/data';
import { EventType, type EventCode } from '../../src/sim/EventBus';
import { createRunState, type RunState } from '../../src/sim/RunState';
import { SeededRNG } from '../../src/sim/rng/SeededRNG';
import {
  FALLBACK_HEAL_FRACTION,
  applyOffer,
  drawOffers,
  eligiblePool,
  registerMutationApplier,
  registerMutationCandidates,
  type UpgradeOffer,
} from '../../src/sim/upgrades/UpgradeSystem';

const nonStarter = BODY_PARTS.filter((p) => !p.starter).map((p) => p.id);
const key = (o: UpgradeOffer) => `${o.kind}:${o.partId ?? ''}:${o.mutationId ?? ''}`;

function own(s: RunState, id: string, level = 1): void {
  s.build.parts.set(id, { level, merged: false, rareBonuses: 0 });
}

function drainEvents(s: RunState): [EventCode, number, number][] {
  const out: [EventCode, number, number][] = [];
  s.events.drain((t, a, b) => out.push([t, a, b]));
  return out;
}

const unregister: (() => void)[] = [];
afterEach(() => {
  while (unregister.length) unregister.pop()!();
});

describe('UpgradeSystem draw', () => {
  it('fresh run: 3 distinct non-fallback offers, starter never offered as newPart', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = createRunState(seed);
      const offers = drawOffers(s, s.rng.upgrades);
      expect(offers).toHaveLength(3);
      expect(offers.every((o) => o.kind !== 'fallbackHeal')).toBe(true);
      expect(new Set(offers.map(key)).size).toBe(3);
      expect(offers.some((o) => o.kind === 'newPart' && o.partId === 'blob_spit')).toBe(false);
    }
  });

  it('excludes maxed parts and banned parts', () => {
    const s = createRunState(1);
    s.build.parts.get('blob_spit')!.level = 5;
    own(s, 'fangs', 5);
    s.build.banned.add('tentacle');
    const pool = eligiblePool(s);
    expect(pool.some((c) => c.partId === 'blob_spit' || c.partId === 'fangs' || c.partId === 'tentacle')).toBe(false);
    for (let i = 0; i < 50; i++) {
      for (const o of drawOffers(s, new SeededRNG(i))) {
        expect(['blob_spit', 'fangs', 'tentacle']).not.toContain(o.partId);
      }
    }
  });

  it('at maxParts only offers levelUps and fallbacks', () => {
    const s = createRunState(1);
    for (const id of nonStarter.slice(0, s.config.balance.maxParts - 1)) own(s, id);
    expect(s.build.parts.size).toBe(s.config.balance.maxParts);
    expect(eligiblePool(s).every((c) => c.kind === 'levelUp')).toBe(true);
    for (let i = 0; i < 50; i++) {
      for (const o of drawOffers(s, new SeededRNG(i))) expect(['levelUp', 'fallbackHeal']).toContain(o.kind);
    }
  });

  it('fills with fallbackHeal when fewer than 3 candidates exist', () => {
    const s = createRunState(1);
    s.build.parts.get('blob_spit')!.level = 5;
    for (const id of nonStarter.slice(0, 5)) own(s, id, 5);
    own(s, nonStarter[0], 4); // the only candidate
    const offers = drawOffers(s, new SeededRNG(3));
    expect(offers.map((o) => o.kind)).toEqual(['levelUp', 'fallbackHeal', 'fallbackHeal']);
    expect(offers[0]).toMatchObject({ partId: nonStarter[0], fromLevel: 4, toLevel: 5 });
    expect(offers[1].rarity).toBe('common');
  });

  it('is deterministic for the same seed', () => {
    const a = createRunState(777);
    const b = createRunState(777);
    for (let i = 0; i < 5; i++) expect(drawOffers(a, a.rng.upgrades)).toEqual(drawOffers(b, b.rng.upgrades));
  });

  it('forces mutation candidates into the first slots as Epic', () => {
    unregister.push(
      registerMutationCandidates(() => [
        { kind: 'mutation', mutationId: 'beholder_gaze', rarities: ['common'], name: 'Beholder Gaze', icon: 'i', descriptionKey: 'm' },
      ]),
    );
    const s = createRunState(5);
    const offers = drawOffers(s, s.rng.upgrades);
    expect(offers[0]).toMatchObject({ kind: 'mutation', mutationId: 'beholder_gaze', rarity: 'epic' });
    expect(new Set(offers.map(key)).size).toBe(3);
  });
});

describe('UpgradeSystem apply', () => {
  it('newPart common adds level 1 and emits partGained', () => {
    const s = createRunState(1);
    applyOffer(s, { kind: 'newPart', partId: 'fangs', rarity: 'common', name: '', icon: '', descriptionKey: '' });
    expect(s.build.parts.get('fangs')).toEqual({ level: 1, merged: false, rareBonuses: 0 });
    const idx = BODY_PARTS.findIndex((p) => p.id === 'fangs');
    expect(drainEvents(s)).toEqual([[EventType.partGained, idx, 1]]);
  });

  it('epic newPart starts at level 2', () => {
    const s = createRunState(1);
    applyOffer(s, { kind: 'newPart', partId: 'ribcage', rarity: 'epic', name: '', icon: '', descriptionKey: '' });
    expect(s.build.parts.get('ribcage')!.level).toBe(2);
  });

  it('levelUp +1 and Rare adds a rare bonus, emits partLevelled', () => {
    const s = createRunState(1);
    applyOffer(s, { kind: 'levelUp', partId: 'blob_spit', rarity: 'common', name: '', icon: '', descriptionKey: '' });
    expect(s.build.parts.get('blob_spit')).toMatchObject({ level: 2, rareBonuses: 0 });
    applyOffer(s, { kind: 'levelUp', partId: 'blob_spit', rarity: 'rare', name: '', icon: '', descriptionKey: '' });
    expect(s.build.parts.get('blob_spit')).toMatchObject({ level: 3, rareBonuses: 1 });
    expect(drainEvents(s)).toEqual([
      [EventType.partLevelled, 0, 2],
      [EventType.partLevelled, 0, 3],
    ]);
  });

  it('fallbackHeal heals a fraction of maxHp, clamped', () => {
    const s = createRunState(1);
    s.player.hp = 10;
    applyOffer(s, { kind: 'fallbackHeal', rarity: 'common', name: '', icon: '', descriptionKey: '' });
    expect(s.player.hp).toBeCloseTo(10 + s.player.maxHp * FALLBACK_HEAL_FRACTION);
    s.player.hp = s.player.maxHp - 1;
    applyOffer(s, { kind: 'fallbackHeal', rarity: 'common', name: '', icon: '', descriptionKey: '' });
    expect(s.player.hp).toBe(s.player.maxHp);
  });

  it('mutation offers delegate to the registered applier; stats are clamped', () => {
    const seen: string[] = [];
    unregister.push(registerMutationApplier((st, o) => {
      seen.push(o.mutationId!);
      st.player.stats.damage = 99;
    }));
    const s = createRunState(1);
    applyOffer(s, { kind: 'mutation', mutationId: 'm1', rarity: 'epic', name: '', icon: '', descriptionKey: '' });
    expect(seen).toEqual(['m1']);
    expect(s.player.stats.damage).toBe(s.config.balance.caps.damage);
  });

  it('levels and part count stay capped over 200 random applies', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = createRunState(seed);
      const rng = new SeededRNG(seed * 31);
      for (let i = 0; i < 200; i++) {
        const offers = drawOffers(s, s.rng.upgrades);
        applyOffer(s, rng.pick(offers));
        for (const [id, p] of s.build.parts) {
          const def = BODY_PARTS.find((d) => d.id === id)!;
          expect(p.level).toBeGreaterThanOrEqual(1);
          expect(p.level).toBeLessThanOrEqual(def.maxLevel);
        }
        expect(s.build.parts.size).toBeLessThanOrEqual(s.config.balance.maxParts);
      }
    }
  });
});
