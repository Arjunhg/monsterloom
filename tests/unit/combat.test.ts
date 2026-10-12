import { describe, expect, it } from 'vitest';
import { createRunState, PROJECTILE_SIDE, type RunState } from '../../src/sim/RunState';
import { createSimContext, spawnEnemy, type SimContext } from '../../src/sim/SimContext';
import { EventType } from '../../src/sim/EventBus';
import { partIndex } from '../../src/sim/entities';
import { createParams, effectiveParams } from '../../src/sim/abilities/params';
import { getAbility } from '../../src/sim/abilities/registry';
import { abilitySystem } from '../../src/sim/systems/AbilitySystem';
import { projectileSystem, spawnProjectile } from '../../src/sim/systems/ProjectileSystem';
import { damageSystem } from '../../src/sim/systems/DamageSystem';
import { contactSystem } from '../../src/sim/systems/ContactSystem';

const DT = 1 / 60;

function rebuildHash(ctx: SimContext): void {
  const e = ctx.state.enemies;
  ctx.enemyHash.clear();
  for (let k = 0; k < e.count; k++) {
    const id = e.pool.activeIds[k];
    ctx.enemyHash.insert(id, e.x[id], e.y[id]);
  }
}

function events(state: RunState): Array<[number, number, number, number, number]> {
  const out: Array<[number, number, number, number, number]> = [];
  state.events.drain((t, a, b, c, d) => out.push([t, a, b, c, d]));
  return out;
}

function setup(seed = 1) {
  const state = createRunState(seed);
  const ctx = createSimContext(state);
  return { state, ctx };
}

describe('Blob Spit + combat pipeline', () => {
  it('starter loadout is one Blob Spit with a registered runtime', () => {
    const { state } = setup();
    expect([...state.build.parts.keys()]).toEqual(['blob_spit']);
    expect(getAbility('blob_spit')).toBeDefined();
  });

  it('fires toward the nearest enemy, kills it, drops an orb and emits events', () => {
    const { state, ctx } = setup();
    const near = spawnEnemy(state, 1, 0, 150); // imp, below the player
    const far = spawnEnemy(state, 1, 300, 0);
    state.enemies.hp[near] = 10;
    const energy = state.enemies.energyValue[near];
    rebuildHash(ctx);

    abilitySystem(ctx, DT);
    expect(state.projectiles.count).toBe(1);
    const pid = state.projectiles.pool.activeIds[0];
    expect(state.projectiles.side[pid]).toBe(PROJECTILE_SIDE.PLAYER);
    expect(state.projectiles.ability[pid]).toBe(partIndex(state, 'blob_spit'));
    expect(state.projectiles.vx[pid]).toBeCloseTo(0, 3);
    expect(state.projectiles.vy[pid]).toBeGreaterThan(0);

    // Cooldown holds: no second shot on the next tick.
    abilitySystem(ctx, DT);
    expect(state.projectiles.count).toBe(1);

    for (let i = 0; i < 60 && state.enemies.isAlive(near); i++) {
      projectileSystem(ctx, DT);
      damageSystem(ctx, DT);
    }
    expect(state.enemies.isAlive(near)).toBe(false);
    expect(state.enemies.isAlive(far)).toBe(true);
    expect(state.stats.kills).toBe(1);
    expect(state.stats.damageDealt).toBeCloseTo(10);
    expect(state.projectiles.count).toBe(0);
    expect(state.orbs.count).toBe(1);
    const oid = state.orbs.pool.activeIds[0];
    expect(state.orbs.value[oid]).toBe(energy);
    expect(state.orbs.x[oid]).toBeCloseTo(0);
    expect(state.orbs.y[oid]).toBeCloseTo(150);

    const ev = events(state);
    expect(ev.filter((e) => e[0] === EventType.enemyHit)).toEqual([[EventType.enemyHit, near, 10, 0, 0]]);
    const killed = ev.filter((e) => e[0] === EventType.enemyKilled);
    expect(killed).toEqual([[EventType.enemyKilled, near, 0, 150, 1]]);
    expect(ctx.damage.count).toBe(0);
  });

  it('pierce lets one projectile hit two enemies, each once', () => {
    const { state, ctx } = setup();
    const a = spawnEnemy(state, 0, 60, 0);
    const b = spawnEnemy(state, 0, 120, 0);
    state.enemies.hp[a] = state.enemies.hp[b] = 1000;
    rebuildHash(ctx);
    const pid = spawnProjectile(ctx, PROJECTILE_SIDE.PLAYER, 0, 0, 0, 400, 0, 8, 5, 1, 2);
    expect(pid).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 60 && state.projectiles.isAlive(pid); i++) {
      projectileSystem(ctx, DT);
      damageSystem(ctx, DT);
    }
    expect(state.projectiles.isAlive(pid)).toBe(false);
    expect(state.enemies.hp[a]).toBe(995);
    expect(state.enemies.hp[b]).toBe(995);
    expect(state.stats.damageDealt).toBe(10);
  });

  it('projectile with pierce 0 stops after the first hit', () => {
    const { state, ctx } = setup();
    const a = spawnEnemy(state, 0, 60, 0);
    const b = spawnEnemy(state, 0, 120, 0);
    state.enemies.hp[a] = state.enemies.hp[b] = 1000;
    rebuildHash(ctx);
    spawnProjectile(ctx, PROJECTILE_SIDE.PLAYER, 0, 0, 0, 400, 0, 8, 5, 0, 2);
    for (let i = 0; i < 60; i++) {
      projectileSystem(ctx, DT);
      damageSystem(ctx, DT);
    }
    expect(state.enemies.hp[a]).toBe(995);
    expect(state.enemies.hp[b]).toBe(1000);
  });

  it('projectiles expire after their lifetime', () => {
    const { state, ctx } = setup();
    rebuildHash(ctx);
    const pid = spawnProjectile(ctx, PROJECTILE_SIDE.PLAYER, 0, 0, 0, 100, 0, 8, 5, 0, 0.1);
    for (let i = 0; i < 5; i++) projectileSystem(ctx, DT);
    expect(state.projectiles.isAlive(pid)).toBe(true);
    expect(state.projectiles.prevX[pid]).toBeLessThan(state.projectiles.x[pid]);
    for (let i = 0; i < 2; i++) projectileSystem(ctx, DT);
    expect(state.projectiles.isAlive(pid)).toBe(false);
  });

  it('enemy projectiles damage the player and are freed', () => {
    const { state, ctx } = setup();
    rebuildHash(ctx);
    const pid = spawnProjectile(ctx, PROJECTILE_SIDE.ENEMY, 255, 30, 0, -300, 0, 6, 7, 0, 2);
    for (let i = 0; i < 10 && state.projectiles.isAlive(pid); i++) projectileSystem(ctx, DT);
    expect(state.projectiles.isAlive(pid)).toBe(false);
    expect(state.player.hp).toBe(state.player.maxHp - 7);
  });
});

describe('ContactSystem', () => {
  it('applies the highest overlapping contact damage once and respects invulnerability', () => {
    const { state, ctx } = setup();
    const a = spawnEnemy(state, 0, 10, 0); // shambler 8
    const b = spawnEnemy(state, 2, -10, 0); // skull knight 18
    spawnEnemy(state, 2, 500, 0); // far away, no contact
    rebuildHash(ctx);
    const max = state.player.maxHp;
    const dmg = Math.max(state.enemies.contactDmg[a], state.enemies.contactDmg[b]);

    contactSystem(ctx, DT);
    expect(state.player.hp).toBe(max - dmg);
    expect(state.player.invuln).toBeGreaterThan(0);
    const hurt = events(state).filter((e) => e[0] === EventType.playerHurt);
    expect(hurt).toEqual([[EventType.playerHurt, dmg, max - dmg, 0, 0]]);

    contactSystem(ctx, DT); // still invulnerable
    expect(state.player.hp).toBe(max - dmg);

    state.player.invuln = 0;
    contactSystem(ctx, DT);
    expect(state.player.hp).toBe(max - 2 * dmg);
  });

  it('does nothing without overlap', () => {
    const { state, ctx } = setup();
    spawnEnemy(state, 0, 200, 0);
    rebuildHash(ctx);
    contactSystem(ctx, DT);
    expect(state.player.hp).toBe(state.player.maxHp);
  });
});

describe('effectiveParams', () => {
  it('applies capped damage and attack-speed multipliers', () => {
    const { state } = setup();
    const idx = partIndex(state, 'blob_spit');
    const out = createParams();
    state.player.stats.damage = 10; // cap 3
    state.player.stats.attackSpeed = 4; // cap 2
    effectiveParams(state, idx, out);
    const caps = state.config.balance.caps;
    const l1 = state.config.bodyParts[idx].levels[0];
    expect(out.damage).toBeCloseTo(l1.damage * caps.damage);
    expect(out.cooldown).toBeCloseTo(l1.cooldown! / caps.attackSpeed);
    expect(out.range).toBe(l1.range);
    expect(out.pierce).toBeUndefined();
  });

  it('adds rare bonuses and uses the owned level', () => {
    const { state } = setup();
    const idx = partIndex(state, 'blob_spit');
    const def = state.config.bodyParts[idx];
    const owned = state.build.parts.get('blob_spit')!;
    owned.level = 3;
    owned.rareBonuses = 2;
    const out = effectiveParams(state, idx, createParams())!;
    expect(out.damage).toBeCloseTo(def.levels[2].damage);
    expect(out.count).toBe(def.levels[2].count! + 2 * (def.rareBonus!.count ?? 0));
  });

  it('returns null for unowned parts', () => {
    const { state } = setup();
    expect(effectiveParams(state, partIndex(state, 'fangs'), createParams())).toBeNull();
  });
});
