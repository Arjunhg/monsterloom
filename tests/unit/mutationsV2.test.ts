import { describe, expect, it } from 'vitest';
import { MUTATIONS } from '../../src/data/mutations';
import { createRunState, ENEMY_FLAG, PROJECTILE_SIDE, type RunState } from '../../src/sim/RunState';
import { createSimContext, spawnEnemy, type SimContext } from '../../src/sim/SimContext';
import { applyOffer, drawOffers } from '../../src/sim/upgrades/UpgradeSystem';
import { isEligible } from '../../src/sim/upgrades/MutationSystem';
import { mutationAbilitySystem } from '../../src/sim/systems/MutationAbilitySystem';
import { abilitySystem } from '../../src/sim/systems/AbilitySystem';
import { damageSystem } from '../../src/sim/systems/DamageSystem';
import { Sim } from '../../src/sim/Sim';
import {
  WEREWOLF_DAMAGE,
  WEREWOLF_DAMAGE_SOURCE,
  WEREWOLF_KNOCKBACK_SPEED,
  werewolfShockwave,
  werewolfShockwaveCount,
} from '../../src/sim/abilities/werewolfFrenzy';
import {
  BONE_STORM_COUNT,
  BONE_STORM_DAMAGE,
  BONE_STORM_INTERVAL,
  BONE_STORM_PIERCE,
  boneStormBurstCount,
  boneStormPulse,
} from '../../src/sim/abilities/boneStorm';
import {
  BOG_KRAKEN_DAMAGE,
  BOG_KRAKEN_DAMAGE_SOURCE,
  bogKrakenGrabs,
  bogKrakenGrabTotal,
  bogKrakenView,
} from '../../src/sim/abilities/bogKraken';
import { swampGutPuddle } from '../../src/sim/abilities/swampGut';

const DT = 1 / 60;

function recipe(id: string) {
  const r = MUTATIONS.find((m) => m.id === id);
  if (!r) throw new Error(`missing recipe ${id}`);
  return r;
}

function own(state: RunState, partId: string, level: number): void {
  state.build.parts.set(partId, { level, merged: false, rareBonuses: 0 });
}

function rebuildHash(ctx: SimContext): void {
  const e = ctx.state.enemies;
  ctx.enemyHash.clear();
  for (let k = 0; k < e.count; k++) {
    const id = e.pool.activeIds[k];
    ctx.enemyHash.insert(id, e.x[id], e.y[id]);
  }
}

function tough(state: RunState, x: number, y: number): number {
  const id = spawnEnemy(state, 0, x, y);
  expect(id).toBeGreaterThanOrEqual(0);
  state.enemies.hp[id] = state.enemies.maxHp[id] = 1e6;
  return id;
}

/** Draws offers and applies the mutation offer for `id` (asserting it is an Epic). */
function takeMutation(state: RunState, id: string): void {
  const offers = drawOffers(state, state.rng.upgrades);
  const offer = offers.find((o) => o.kind === 'mutation' && o.mutationId === id);
  expect(offer).toBeDefined();
  expect(offer!.rarity).toBe('epic');
  applyOffer(state, offer!);
  expect(state.build.mutations.has(id)).toBe(true);
}

const CASES: Array<{ id: string; req: Record<string, number> }> = [
  { id: 'werewolf_frenzy', req: { fangs: 3, bat_wings: 2 } },
  { id: 'bone_storm', req: { ribcage: 3, blob_spit: 3 } },
  { id: 'bog_kraken', req: { swamp_gut: 3, tentacle: 2 } },
];

describe('v2 mutation eligibility and offers', () => {
  for (const c of CASES) {
    it(`${c.id} becomes eligible exactly at its required levels and is offered as Epic`, () => {
      const r = recipe(c.id);
      const none = new Set<string>();
      const keys = Object.keys(c.req);
      const map = (over: Record<string, number>) =>
        new Map(Object.entries({ ...c.req, ...over }).map(([k, level]) => [k, { level }]));
      expect(isEligible(r, map({}), none)).toBe(true);
      for (const k of keys) {
        expect(isEligible(r, map({ [k]: c.req[k] - 1 }), none)).toBe(false);
        const missing = map({});
        missing.delete(k);
        expect(isEligible(r, missing, none)).toBe(false);
      }
      expect(isEligible(r, map({}), new Set([c.id]))).toBe(false);

      const state = createRunState(21);
      for (const k of keys) own(state, k, c.req[k] - 1);
      if (c.req.blob_spit === undefined) own(state, 'blob_spit', 1);
      expect(drawOffers(state, state.rng.upgrades).some((o) => o.mutationId === c.id)).toBe(false);
      for (const k of keys) own(state, k, c.req[k]);
      const offers = drawOffers(state, state.rng.upgrades);
      expect(offers[0]).toMatchObject({ kind: 'mutation', mutationId: c.id, rarity: 'epic', icon: r.spriteKey });
    });
  }
});

describe('Werewolf Frenzy', () => {
  it('emits a damaging knockback shockwave when a Bat Wings dash ends', () => {
    const state = createRunState(5);
    const ctx = createSimContext(state);
    own(state, 'fangs', 3);
    own(state, 'bat_wings', 2);
    takeMutation(state, 'werewolf_frenzy');

    // Dash goes +x (~135 px). Enemy sits beyond the dash path but within 150 px of its end.
    const near = tough(state, 240, 0);
    const far = tough(state, 900, 0);
    state.player.vx = 100;
    state.player.vy = 0;

    const waveDamage = new Map<number, number>();
    let sawWave = false;
    for (let i = 0; i < 40; i++) {
      rebuildHash(ctx);
      abilitySystem(ctx, DT);
      const before = ctx.damage.count;
      const countBefore = werewolfShockwaveCount(ctx);
      mutationAbilitySystem(ctx, DT);
      if (werewolfShockwaveCount(ctx) > countBefore) {
        for (let q = before; q < ctx.damage.count; q++) {
          expect(ctx.damage.source[q]).toBe(WEREWOLF_DAMAGE_SOURCE);
          const id = ctx.damage.enemy[q];
          waveDamage.set(id, (waveDamage.get(id) ?? 0) + ctx.damage.amount[q]);
        }
        const v = werewolfShockwave(ctx);
        expect(v.active).toBe(true);
        sawWave = true;
        // Knockback (velocity/stun) is set right away; check before damageSystem.
        expect(state.enemies.stun[near]).toBeGreaterThan(0);
        expect(state.enemies.vx[near]).toBeCloseTo(WEREWOLF_KNOCKBACK_SPEED, 0);
      }
      damageSystem(ctx, DT);
      state.events.clear();
    }
    expect(sawWave).toBe(true);
    expect(werewolfShockwaveCount(ctx)).toBe(1);
    expect(waveDamage.get(near)).toBeCloseTo(WEREWOLF_DAMAGE, 3);
    expect(waveDamage.has(far)).toBe(false);
    expect(state.enemies.hp[near]).toBeLessThan(1e6);
    expect(state.enemies.stun[far]).toBe(0);
  });

  it('does not knock back bosses (but still damages them)', () => {
    const state = createRunState(6);
    const ctx = createSimContext(state);
    own(state, 'fangs', 3);
    own(state, 'bat_wings', 2);
    takeMutation(state, 'werewolf_frenzy');
    const boss = tough(state, 240, 0);
    state.enemies.flags[boss] |= ENEMY_FLAG.BOSS;
    state.player.vx = 100;
    let damaged = 0;
    for (let i = 0; i < 40; i++) {
      rebuildHash(ctx);
      abilitySystem(ctx, DT);
      const before = ctx.damage.count;
      const c0 = werewolfShockwaveCount(ctx);
      mutationAbilitySystem(ctx, DT);
      if (werewolfShockwaveCount(ctx) > c0) {
        for (let q = before; q < ctx.damage.count; q++) if (ctx.damage.enemy[q] === boss) damaged++;
        expect(state.enemies.stun[boss]).toBe(0);
      }
      damageSystem(ctx, DT);
      state.events.clear();
    }
    expect(damaged).toBe(1);
  });
});

describe('Bone Storm', () => {
  it('spawns a ring of 12 bone projectiles every 2.5 s', () => {
    const state = createRunState(8);
    const ctx = createSimContext(state);
    own(state, 'ribcage', 3);
    own(state, 'blob_spit', 3);
    takeMutation(state, 'bone_storm');
    const ribIdx = state.config.bodyParts.findIndex((p) => p.id === 'ribcage');

    expect(state.projectiles.count).toBe(0);
    rebuildHash(ctx);
    mutationAbilitySystem(ctx, DT);
    expect(state.projectiles.count).toBe(BONE_STORM_COUNT);
    expect(boneStormPulse(ctx).active).toBe(true);

    const pr = state.projectiles;
    let sumVx = 0;
    let sumVy = 0;
    for (let k = 0; k < pr.count; k++) {
      const id = pr.pool.activeIds[k];
      expect(pr.side[id]).toBe(PROJECTILE_SIDE.PLAYER);
      expect(pr.ability[id]).toBe(ribIdx);
      expect(pr.damage[id]).toBeCloseTo(BONE_STORM_DAMAGE, 3);
      expect(pr.pierce[id]).toBe(BONE_STORM_PIERCE);
      sumVx += pr.vx[id];
      sumVy += pr.vy[id];
    }
    expect(Math.abs(sumVx)).toBeLessThan(1e-2); // evenly spaced ring
    expect(Math.abs(sumVy)).toBeLessThan(1e-2);

    const steps = Math.ceil(BONE_STORM_INTERVAL / DT);
    for (let i = 0; i < steps - 2; i++) mutationAbilitySystem(ctx, DT);
    expect(boneStormBurstCount(ctx)).toBe(1);
    for (let i = 0; i < 3; i++) mutationAbilitySystem(ctx, DT);
    expect(boneStormBurstCount(ctx)).toBe(2);
    expect(state.projectiles.count).toBe(2 * BONE_STORM_COUNT);
  });
});

describe('Bog Kraken', () => {
  it('grabs the 2 nearest non-boss enemies inside the puddle: stun, pull, damage', () => {
    const state = createRunState(9);
    const ctx = createSimContext(state);
    own(state, 'swamp_gut', 4); // L4: lingering puddle
    own(state, 'tentacle', 2);
    takeMutation(state, 'bog_kraken');
    const swampIdx = state.config.bodyParts.findIndex((p) => p.id === 'swamp_gut');

    // First ability tick: swamp pulse leaves a puddle at the player (0, 0).
    rebuildHash(ctx);
    abilitySystem(ctx, DT);
    ctx.damage.clear();
    const pd = swampGutPuddle(ctx, swampIdx);
    expect(pd.active).toBe(true);
    const radius = pd.radius;

    // Move the player far away so the puddle (not the fallback) is the grab area.
    state.player.x = 2000;
    const a = tough(state, 40, 0);
    const b = tough(state, 0, -70);
    const c = tough(state, radius - 5, 0); // third nearest: not grabbed
    const boss = tough(state, 10, 10);
    state.enemies.flags[boss] |= ENEMY_FLAG.BOSS;
    const byPlayer = tough(state, 2020, 0);

    rebuildHash(ctx);
    mutationAbilitySystem(ctx, DT);
    const e = state.enemies;
    const grabbed = new Map<number, number>();
    for (let q = 0; q < ctx.damage.count; q++) {
      expect(ctx.damage.source[q]).toBe(BOG_KRAKEN_DAMAGE_SOURCE);
      grabbed.set(ctx.damage.enemy[q], ctx.damage.amount[q]);
    }
    expect([...grabbed.keys()].sort()).toEqual([a, b].sort());
    expect(grabbed.get(a)).toBeCloseTo(BOG_KRAKEN_DAMAGE, 3);
    expect(e.stun[a]).toBeGreaterThan(0);
    expect(e.stun[b]).toBeGreaterThan(0);
    expect(e.vx[a]).toBeLessThan(0); // pulled toward the puddle centre
    expect(e.vy[b]).toBeGreaterThan(0);
    for (const id of [c, boss, byPlayer]) expect(e.stun[id]).toBe(0);

    const out: number[] = [];
    expect(bogKrakenGrabs(ctx, out)).toBe(2);
    expect(out).toHaveLength(4);
    const view = bogKrakenView(ctx);
    expect(view.active).toBe(true);
    expect(view.x).toBeCloseTo(pd.x, 3);

    damageSystem(ctx, DT);
    expect(e.hp[a]).toBeLessThan(1e6);
    // Visual expires after 0.3 s.
    for (let i = 0; i < 20; i++) mutationAbilitySystem(ctx, DT);
    expect(bogKrakenGrabs(ctx, out)).toBe(0);
  });

  it('falls back to a 140 px radius around the player without a puddle', () => {
    const state = createRunState(10);
    const ctx = createSimContext(state);
    own(state, 'swamp_gut', 3); // L3: no puddle
    own(state, 'tentacle', 2);
    takeMutation(state, 'bog_kraken');
    const inRange = tough(state, 100, 0);
    const outRange = tough(state, 200, 0);
    rebuildHash(ctx);
    mutationAbilitySystem(ctx, DT);
    expect(state.enemies.stun[inRange]).toBeGreaterThan(0);
    expect(state.enemies.vx[inRange]).toBeLessThan(0);
    expect(state.enemies.stun[outRange]).toBe(0);
    expect(bogKrakenGrabTotal(ctx)).toBe(1);
  });
});

describe('restart clears v2 mutation state', () => {
  it('Sim.restart resets bone storm / kraken / werewolf records', () => {
    const sim = new Sim({ seed: 4 });
    const s = sim.state;
    own(s, 'ribcage', 3);
    own(s, 'blob_spit', 3);
    own(s, 'swamp_gut', 3);
    own(s, 'tentacle', 2);
    expect(drawOffers(s, s.rng.upgrades).filter((o) => o.kind === 'mutation').length).toBeGreaterThanOrEqual(2);
    takeMutation(s, 'bone_storm');
    takeMutation(s, 'bog_kraken');
    tough(s, 60, 0);
    for (let i = 0; i < 5; i++) sim.stepOnce();
    expect(boneStormBurstCount(sim.ctx)).toBe(1);
    expect(bogKrakenGrabTotal(sim.ctx)).toBeGreaterThan(0);

    sim.restart(4);
    expect(boneStormBurstCount(sim.ctx)).toBe(0);
    expect(boneStormPulse(sim.ctx).active).toBe(false);
    expect(bogKrakenGrabTotal(sim.ctx)).toBe(0);
    expect(bogKrakenGrabs(sim.ctx, [])).toBe(0);
    expect(werewolfShockwaveCount(sim.ctx)).toBe(0);
    expect(werewolfShockwave(sim.ctx).active).toBe(false);
    expect(s.build.mutations.size).toBe(0);
  });
});
