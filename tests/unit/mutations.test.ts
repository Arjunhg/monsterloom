import { describe, expect, it } from 'vitest';
import { MUTATIONS } from '../../src/data/mutations';
import { createRunState, type RunState } from '../../src/sim/RunState';
import { createSimContext, spawnEnemy, type SimContext } from '../../src/sim/SimContext';
import { EventType } from '../../src/sim/EventBus';
import { applyOffer, drawOffers } from '../../src/sim/upgrades/UpgradeSystem';
import { applyMutation, eligibleMutations, isEligible } from '../../src/sim/upgrades/MutationSystem';
import { mutationAbilitySystem } from '../../src/sim/systems/MutationAbilitySystem';
import { damageSystem } from '../../src/sim/systems/DamageSystem';
import { beholderBeam, BEAM_LENGTH, BEHOLDER_DAMAGE_SOURCE } from '../../src/sim/abilities/beholderGaze';

const DT = 1 / 60;
const beholder = MUTATIONS.find((m) => m.id === 'beholder_gaze')!;

function parts(entries: Record<string, number>): Map<string, { level: number }> {
  return new Map(Object.entries(entries).map(([k, level]) => [k, { level }]));
}

function giveRecipeParts(state: RunState): void {
  state.build.parts.set('extra_eye', { level: 3, merged: false, rareBonuses: 0 });
  state.build.parts.set('tentacle', { level: 1, merged: false, rareBonuses: 0 });
}

function rebuildHash(ctx: SimContext): void {
  const e = ctx.state.enemies;
  ctx.enemyHash.clear();
  for (let k = 0; k < e.count; k++) {
    const id = e.pool.activeIds[k];
    ctx.enemyHash.insert(id, e.x[id], e.y[id]);
  }
}

describe('MutationSystem.isEligible', () => {
  it('truth table for Beholder Gaze', () => {
    const none = new Set<string>();
    expect(isEligible(beholder, parts({ extra_eye: 2, tentacle: 1 }), none)).toBe(false);
    expect(isEligible(beholder, parts({ extra_eye: 3 }), none)).toBe(false);
    expect(isEligible(beholder, parts({ extra_eye: 3, tentacle: 1 }), none)).toBe(true);
    expect(isEligible(beholder, parts({ extra_eye: 5, tentacle: 4 }), none)).toBe(true);
    expect(isEligible(beholder, parts({ extra_eye: 3, tentacle: 1 }), new Set(['beholder_gaze']))).toBe(false);
  });
});

describe('Mutation offers and application', () => {
  it('offers Beholder Gaze as forced Epic in slot 0 once eligible', () => {
    const state = createRunState(7);
    expect(eligibleMutations(state)).toEqual([]);
    expect(drawOffers(state, state.rng.upgrades).some((o) => o.kind === 'mutation')).toBe(false);

    giveRecipeParts(state);
    const offers = drawOffers(state, state.rng.upgrades);
    expect(offers[0]).toMatchObject({
      kind: 'mutation',
      mutationId: 'beholder_gaze',
      rarity: 'epic',
      icon: beholder.spriteKey,
      descriptionKey: 'mutation.beholder_gaze',
    });
    expect(offers.filter((o) => o.kind === 'mutation')).toHaveLength(1);
  });

  it('applyOffer applies the mutation and it is never offered again', () => {
    const state = createRunState(11);
    giveRecipeParts(state);
    const offer = drawOffers(state, state.rng.upgrades)[0];
    state.events.clear();
    applyOffer(state, offer);

    expect(state.build.mutations.has('beholder_gaze')).toBe(true);
    expect(state.build.parts.get('extra_eye')!.merged).toBe(true);
    expect(state.build.parts.get('tentacle')!.merged).toBe(true);
    expect(state.build.parts.get('extra_eye')!.level).toBe(3);

    const evs: number[][] = [];
    state.events.drain((t, a) => evs.push([t, a]));
    expect(evs).toContainEqual([EventType.mutation, MUTATIONS.indexOf(beholder)]);

    for (let i = 0; i < 50; i++) {
      const offers = drawOffers(state, state.rng.upgrades);
      expect(offers.some((o) => o.mutationId === 'beholder_gaze')).toBe(false);
    }
    expect(applyMutation(state, 'beholder_gaze')).toBe(false);
    expect(applyMutation(state, 'nope')).toBe(false);
  });
});

describe('Beholder Gaze beam', () => {
  it('damages an enemy on the sweep line within a second, not one far off-line', () => {
    const state = createRunState(3);
    const ctx = createSimContext(state);
    giveRecipeParts(state);
    expect(applyMutation(state, 'beholder_gaze')).toBe(true);

    const r = 200;
    const onLine = spawnEnemy(state, 0, Math.cos(0.5) * r, Math.sin(0.5) * r);
    const offLine = spawnEnemy(state, 0, -r, 0); // angle π: beam reaches ~2.2 rad in 1 s
    const far = spawnEnemy(state, 0, BEAM_LENGTH + 300, 0);
    expect(onLine).toBeGreaterThanOrEqual(0);
    state.enemies.hp[onLine] = state.enemies.maxHp[onLine] = 1e6;
    state.enemies.hp[offLine] = state.enemies.maxHp[offLine] = 1e6;
    state.enemies.hp[far] = state.enemies.maxHp[far] = 1e6;

    const hits = new Map<number, number>();
    for (let i = 0; i < 60; i++) {
      rebuildHash(ctx);
      mutationAbilitySystem(ctx, DT);
      for (let q = 0; q < ctx.damage.count; q++) {
        expect(ctx.damage.source[q]).toBe(BEHOLDER_DAMAGE_SOURCE);
      }
      damageSystem(ctx, DT);
      state.events.drain((t, a, b) => {
        if (t === EventType.enemyHit) hits.set(a, (hits.get(a) ?? 0) + b);
      });
    }
    expect(hits.get(onLine) ?? 0).toBeGreaterThan(0);
    expect(hits.has(offLine)).toBe(false);
    expect(hits.has(far)).toBe(false);
    expect(state.enemies.hp[onLine]).toBeLessThan(1e6);

    const beam = beholderBeam(ctx);
    expect(beam.active).toBe(true);
    expect(Math.hypot(beam.x2 - beam.x1, beam.y2 - beam.y1)).toBeCloseTo(BEAM_LENGTH, 3);
  });

  it('does nothing when the mutation is not owned', () => {
    const state = createRunState(3);
    const ctx = createSimContext(state);
    spawnEnemy(state, 0, 100, 0);
    rebuildHash(ctx);
    mutationAbilitySystem(ctx, DT);
    expect(ctx.damage.count).toBe(0);
    expect(beholderBeam(ctx).active).toBe(false);
  });
});
