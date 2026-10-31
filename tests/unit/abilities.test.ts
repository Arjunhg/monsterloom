import { describe, expect, it } from 'vitest';
import { NON_DAMAGE_FIELDS } from '../../src/data/bodyParts';
import { createRunState } from '../../src/sim/RunState';
import { createSimContext, spawnEnemy, type SimContext } from '../../src/sim/SimContext';
import { partIndex } from '../../src/sim/entities';
import { createParams, effectiveParams } from '../../src/sim/abilities/params';
import { getAbility } from '../../src/sim/abilities/registry';
import { ribcageBonePositions } from '../../src/sim/abilities/ribcage';
import { swampGutPuddle, swampGutPulse } from '../../src/sim/abilities/swampGut';
import { tentacleGrabs, tentacleView } from '../../src/sim/abilities/tentacle';
import { abilitySystem } from '../../src/sim/systems/AbilitySystem';
import { projectileSystem } from '../../src/sim/systems/ProjectileSystem';
import { damageSystem } from '../../src/sim/systems/DamageSystem';

const DT = 1 / 60;
const PARTS = ['extra_eye', 'fangs', 'tentacle', 'bat_wings', 'ribcage', 'swamp_gut'] as const;
const SHAMBLER = 0;
const IMP = 1;
const HP = 10000;

function rebuildHash(ctx: SimContext): void {
  const e = ctx.state.enemies;
  ctx.enemyHash.clear();
  for (let k = 0; k < e.count; k++) {
    const id = e.pool.activeIds[k];
    ctx.enemyHash.insert(id, e.x[id], e.y[id]);
  }
}

/** Fresh run owning only `partId` at `level` (starter removed so it doesn't interfere). */
function setup(partId: string, level: number) {
  const state = createRunState(1);
  const ctx = createSimContext(state);
  state.build.parts.clear();
  state.build.parts.set(partId, { level, merged: false, rareBonuses: 0 });
  return { state, ctx, idx: partIndex(state, partId) };
}

function enemy(ctx: SimContext, type: number, x: number, y: number): number {
  const id = spawnEnemy(ctx.state, type, x, y);
  ctx.state.enemies.hp[id] = HP;
  return id;
}

function step(ctx: SimContext, n = 1): void {
  for (let i = 0; i < n; i++) {
    rebuildHash(ctx);
    abilitySystem(ctx, DT);
    projectileSystem(ctx, DT);
    damageSystem(ctx, DT);
  }
}

function dealt(ctx: SimContext, id: number): number {
  return HP - ctx.state.enemies.hp[id];
}

describe('registry and content', () => {
  it('starter loadout is exactly Blob Spit; every v1 part has a runtime', () => {
    const state = createRunState(1);
    expect([...state.build.parts.keys()]).toEqual(['blob_spit']);
    for (const id of ['blob_spit', ...PARTS]) expect(getAbility(id), id).toBeDefined();
  });

  it.each(PARTS)('%s: every level changes a non-damage param (and L1 ≠ L5)', (id) => {
    const { state, idx } = setup(id, 1);
    const snap = (level: number) => {
      state.build.parts.get(id)!.level = level;
      const p = effectiveParams(state, idx, createParams())!;
      return NON_DAMAGE_FIELDS.map((k) => p[k]);
    };
    const levels = [1, 2, 3, 4, 5].map(snap);
    for (let l = 1; l < 5; l++) expect(levels[l], `L${l} → L${l + 1}`).not.toEqual(levels[l - 1]);
    expect(levels[4]).not.toEqual(levels[0]);
  });

  it('all parts are safe with zero enemies', () => {
    const state = createRunState(1);
    const ctx = createSimContext(state);
    for (const id of PARTS) state.build.parts.set(id, { level: 5, merged: false, rareBonuses: 0 });
    state.player.vx = 100; // let bat wings dash
    expect(() => step(ctx, 600)).not.toThrow();
    expect(Number.isFinite(state.player.x) && Number.isFinite(state.player.y)).toBe(true);
    expect(state.stats.damageDealt).toBe(0);
  });
});

describe('Extra Eye', () => {
  it('each eye fires independently on staggered timers', () => {
    const { state, ctx } = setup('extra_eye', 3); // 3 eyes, cooldown 1.3
    enemy(ctx, SHAMBLER, 1000, 1000); // out of range: bolts fly along lastDir
    const fireSteps: number[] = [];
    let seen = 0;
    for (let s = 0; s < 78; s++) {
      step(ctx);
      const spawned = state.projectiles.count - seen;
      for (let k = 0; k < spawned; k++) fireSteps.push(s);
      seen = state.projectiles.count;
    }
    expect(fireSteps.length).toBe(3);
    expect(new Set(fireSteps).size).toBe(3);
  });

  it('bolts home in on their target', () => {
    const { state, ctx } = setup('extra_eye', 1);
    const e = enemy(ctx, IMP, 200, 0);
    step(ctx); // fires toward +x
    expect(state.projectiles.count).toBe(1);
    state.enemies.x[e] = 150;
    state.enemies.y[e] = 120; // far off the original straight line
    step(ctx, 50); // < cooldown 1.4 s, so only the first bolt exists
    expect(dealt(ctx, e)).toBeCloseTo(8);
  });
});

describe('Fangs', () => {
  it('fires a fan of `count` piercing darts across `spread` degrees', () => {
    const { state, ctx, idx } = setup('fangs', 5); // count 4, pierce 5, spread 36
    const ids = [enemy(ctx, SHAMBLER, 60, 0), enemy(ctx, SHAMBLER, 120, 0), enemy(ctx, SHAMBLER, 180, 0)];
    rebuildHash(ctx);
    abilitySystem(ctx, DT);
    const pr = state.projectiles;
    expect(pr.count).toBe(4);
    const angles: number[] = [];
    for (let k = 0; k < pr.count; k++) {
      const pid = pr.pool.activeIds[k];
      expect(pr.pierce[pid]).toBe(5);
      expect(pr.ability[pid]).toBe(idx);
      angles.push((Math.atan2(pr.vy[pid], pr.vx[pid]) * 180) / Math.PI);
    }
    expect(Math.max(...angles) - Math.min(...angles)).toBeCloseTo(36, 3);
    for (let i = 0; i < 40; i++) {
      projectileSystem(ctx, DT);
      damageSystem(ctx, DT);
    }
    // Inner darts (±6°) pierce through all three lined-up enemies.
    for (const id of ids) expect(dealt(ctx, id)).toBeGreaterThanOrEqual(12);
  });
});

describe('Tentacle', () => {
  it('grabs the nearest `count` enemies, stuns and hurls them, splashes neighbours', () => {
    const { state, ctx } = setup('tentacle', 4); // dmg 17, count 2, range 220, radius 65
    const e = state.enemies;
    const b = enemy(ctx, SHAMBLER, 0, -80);
    const a = enemy(ctx, SHAMBLER, 120, 0);
    const c = enemy(ctx, SHAMBLER, 150, 30); // 153 px from player, 42 px from a
    const d = enemy(ctx, SHAMBLER, 400, 0); // out of range
    step(ctx);
    expect(dealt(ctx, a)).toBeCloseTo(17);
    expect(dealt(ctx, b)).toBeCloseTo(17);
    expect(dealt(ctx, c)).toBeCloseTo(8.5);
    expect(dealt(ctx, d)).toBe(0);
    expect(e.stun[a]).toBeGreaterThan(0.5);
    expect(e.stun[b]).toBeGreaterThan(0.5);
    expect(e.stun[c]).toBe(0);
    expect(e.vx[a]).toBeCloseTo(600);
    expect(e.vy[b]).toBeCloseTo(-600);
    // Cooldown holds.
    step(ctx, 10);
    expect(dealt(ctx, a)).toBeCloseTo(17);
  });

  it('stays ready when nothing is in range', () => {
    const { ctx } = setup('tentacle', 1); // range 140
    const far = enemy(ctx, SHAMBLER, 300, 0);
    step(ctx, 5);
    expect(dealt(ctx, far)).toBe(0);
    ctx.state.enemies.x[far] = 100;
    step(ctx);
    expect(dealt(ctx, far)).toBeCloseTo(14);
  });

  it('exposes a grab visual at L1 so the renderer can draw the lash', () => {
    const { ctx, idx } = setup('tentacle', 1);
    enemy(ctx, SHAMBLER, 100, 0);
    const out: number[] = [];
    expect(tentacleGrabs(ctx, idx, out)).toBe(0);
    step(ctx);
    expect(tentacleGrabs(ctx, idx, out)).toBe(1);
    expect(out[0]).toBeCloseTo(100);
    expect(out[1]).toBeCloseTo(0);
    expect(tentacleView(ctx, idx).active).toBe(true);
    step(ctx, 30); // 0.5 s > visual lifetime
    expect(tentacleGrabs(ctx, idx, out)).toBe(0);
    expect(tentacleView(ctx, idx).active).toBe(false);
  });
});

describe('Bat Wings', () => {
  it('dashes along the movement dir with i-frames, hitting path enemies once', () => {
    const { state, ctx } = setup('bat_wings', 1); // dmg 12, distance 120, duration 0.2, cooldown 4
    const p = state.player;
    const e = enemy(ctx, SHAMBLER, 60, 0);
    const off = enemy(ctx, SHAMBLER, 60, 200);
    p.vx = 200; // "moving" (PlayerSystem not run, so only the dash moves the player)
    step(ctx);
    expect(p.x).toBeGreaterThan(0);
    expect(p.invuln).toBeGreaterThan(0.15);
    step(ctx, 30);
    expect(p.x).toBeCloseTo(120, 0);
    expect(p.y).toBeCloseTo(0);
    expect(dealt(ctx, e)).toBeCloseTo(12);
    expect(dealt(ctx, off)).toBe(0);
    // On cooldown: no second dash for a while.
    step(ctx, 60);
    expect(p.x).toBeCloseTo(120, 0);
  });

  it('does not dash while standing still', () => {
    const { state, ctx } = setup('bat_wings', 1);
    step(ctx, 30);
    expect(state.player.x).toBe(0);
    expect(state.player.invuln).toBe(0);
  });

  it('L5 leaves a lingering damaging trail', () => {
    const { state, ctx, idx } = setup('bat_wings', 5);
    state.player.vy = 100;
    step(ctx);
    step(ctx, 15);
    const pr = state.projectiles;
    expect(pr.count).toBeGreaterThanOrEqual(3);
    for (let k = 0; k < pr.count; k++) {
      const pid = pr.pool.activeIds[k];
      expect(pr.ability[pid]).toBe(idx);
      expect(pr.vx[pid]).toBe(0);
      expect(pr.vy[pid]).toBe(0);
    }
    // An enemy walking into the trail afterwards still gets hurt.
    const late = enemy(ctx, SHAMBLER, 0, 60);
    step(ctx, 2);
    expect(dealt(ctx, late)).toBeGreaterThan(0);
  });
});

describe('Ribcage', () => {
  it('bones orbit at `radius` and hit each enemy at most once per interval', () => {
    const { ctx, idx } = setup('ribcage', 1); // 2 bones, radius 60, 2.5 rad/s, dmg 7
    const e = enemy(ctx, SHAMBLER, 60, 0);
    step(ctx);
    const out: number[] = [];
    expect(ribcageBonePositions(ctx, idx, out)).toBe(2);
    expect(out.length).toBe(4);
    for (let k = 0; k < 2; k++) expect(Math.hypot(out[2 * k], out[2 * k + 1])).toBeCloseTo(60, 3);
    step(ctx, 59); // 1 s: bone 0 passes once, bone 1 not yet back
    expect(dealt(ctx, e)).toBeCloseTo(7);
    step(ctx, 60); // 2 s: bone 1 arrives (~1.07 s)
    expect(dealt(ctx, e)).toBeCloseTo(14);
  });

  it('higher levels add bones on a wider orbit', () => {
    const { ctx, idx } = setup('ribcage', 5);
    step(ctx);
    const out: number[] = [];
    expect(ribcageBonePositions(ctx, idx, out)).toBe(6);
    expect(Math.hypot(out[0], out[1])).toBeCloseTo(86, 3);
  });
});

describe('Swamp Gut', () => {
  it('pulses damage and slow within radius', () => {
    const { state, ctx } = setup('swamp_gut', 1); // dmg 6, radius 90, slow 0.2, duration 1
    const e = state.enemies;
    const near = enemy(ctx, SHAMBLER, 50, 0);
    const far = enemy(ctx, SHAMBLER, 200, 0);
    step(ctx);
    expect(dealt(ctx, near)).toBeCloseTo(6);
    expect(e.slowAmt[near]).toBeCloseTo(0.2);
    expect(e.slowTimer[near]).toBeCloseTo(1);
    expect(dealt(ctx, far)).toBe(0);
    expect(e.slowAmt[far]).toBe(0);
    expect(swampGutPuddle(ctx, partIndex(state, 'swamp_gut')).active).toBe(false);
  });

  it('exposes a pulse visual at L1 (before the L4 puddle exists)', () => {
    const { ctx, idx } = setup('swamp_gut', 1); // radius 90, lingering 0
    enemy(ctx, SHAMBLER, 50, 0);
    expect(swampGutPulse(ctx, idx).active).toBe(false);
    step(ctx);
    const pulse = swampGutPulse(ctx, idx);
    expect(pulse.active).toBe(true);
    expect(pulse.radius).toBe(90);
    expect(pulse.t01).toBeGreaterThanOrEqual(0);
    expect(pulse.t01).toBeLessThan(1);
    step(ctx, 30); // 0.5 s > visual lifetime, well before the next 3 s pulse
    expect(swampGutPulse(ctx, idx).active).toBe(false);
  });

  it('L4 leaves a puddle that keeps slowing and damaging', () => {
    const { state, ctx, idx } = setup('swamp_gut', 4); // dmg 8, radius 135, slow 0.35, duration 1.2
    const e = state.enemies;
    const id = enemy(ctx, SHAMBLER, 50, 0);
    step(ctx);
    expect(dealt(ctx, id)).toBeCloseTo(8);
    const puddle = swampGutPuddle(ctx, idx);
    expect(puddle.active).toBe(true);
    expect(puddle.x).toBe(0);
    expect(puddle.radius).toBe(135);
    state.player.x = 5000; // the pulse follows the player; the puddle stays put
    e.slowAmt[id] = 0;
    e.slowTimer[id] = 0;
    step(ctx, 31);
    expect(e.slowAmt[id]).toBeCloseTo(0.35);
    expect(dealt(ctx, id)).toBeCloseTo(8 + 2);
    step(ctx, 60);
    expect(swampGutPuddle(ctx, idx).active).toBe(false);
  });
});
