import { beforeAll, describe, expect, it } from 'vitest';
import { createRunState, PROJECTILE_SIDE } from '../../src/sim/RunState';
import { createSimContext } from '../../src/sim/SimContext';
import { spawnEnemy } from '../../src/sim/entities';
import { enemyAISystem } from '../../src/sim/systems/EnemyAISystem';
import { damageSystem } from '../../src/sim/systems/DamageSystem';
import { projectileSystem } from '../../src/sim/systems/ProjectileSystem';
import {
  BAT_CHARGE,
  BAT_TELEGRAPH,
  installV2Behaviours,
  slimeRadius,
  slimeScale,
} from '../../src/sim/behaviours';

const DT = 1 / 60;

function setup() {
  const state = createRunState(7);
  const ctx = createSimContext(state);
  state.player.x = 0;
  state.player.y = 0;
  return { state, ctx, e: state.enemies };
}

function typeIndex(state: ReturnType<typeof createRunState>, id: string): number {
  const i = state.config.enemies.findIndex((t) => t.id === id);
  if (i < 0) throw new Error(`missing enemy type ${id}`);
  return i;
}

function step(ctx: ReturnType<typeof createSimContext>, n = 1): void {
  for (let i = 0; i < n; i++) {
    enemyAISystem(ctx, DT);
    ctx.state.clock.elapsed += DT;
  }
}

beforeAll(() => {
  installV2Behaviours();
  installV2Behaviours(); // idempotent
});

describe('bat', () => {
  it('telegraphs 0.75 s with a locked direction and zero velocity, then charges at 3× speed', () => {
    const { state, ctx, e } = setup();
    const id = spawnEnemy(state, typeIndex(state, 'bat'), 300, 0);
    step(ctx);
    expect(e.aiState[id]).toBe(BAT_TELEGRAPH);
    expect(e.aiTimer[id]).toBeCloseTo(0.75, 5);
    expect(e.aiDirX[id]).toBeCloseTo(-1, 5);
    expect(e.aiDirY[id]).toBeCloseTo(0, 5);
    expect(e.x[id]).toBe(300);

    // Player moves away; the direction stays locked.
    state.player.y = 500;
    for (let i = 0; i < 44; i++) {
      step(ctx);
      expect(e.aiState[id]).toBe(BAT_TELEGRAPH);
      expect(e.vx[id]).toBe(0);
      expect(e.vy[id]).toBe(0);
      expect(e.x[id]).toBe(300);
      expect(e.y[id]).toBe(0);
    }
    step(ctx); // 45th step = 0.75 s after the telegraph began
    expect(e.aiState[id]).toBe(BAT_CHARGE);
    const speed = e.speed[id] * 3;
    expect(e.vx[id]).toBeCloseTo(-speed, 3);
    expect(e.vy[id]).toBeCloseTo(0, 5);

    for (let i = 0; i < 30; i++) step(ctx);
    expect(e.vx[id]).toBeCloseTo(-speed, 3);
    expect(e.vy[id]).toBeCloseTo(0, 5);
    expect(e.y[id]).toBeCloseTo(0, 5);
    expect(e.x[id]).toBeLessThan(300 - speed * 30 * DT + 1);
  });

  it('approaches like a chaser from far away', () => {
    const { state, ctx, e } = setup();
    const id = spawnEnemy(state, typeIndex(state, 'bat'), 1000, 0);
    step(ctx);
    expect(e.aiState[id]).toBe(0);
    expect(e.vx[id]).toBeCloseTo(-e.speed[id], 3);
  });

  it('despawns far away after charging without a kill or orb', () => {
    const { state, ctx, e } = setup();
    const id = spawnEnemy(state, typeIndex(state, 'bat'), 200, 0);
    let steps = 0;
    while (e.isAlive(id) && steps < 60 * 15) {
      step(ctx);
      steps++;
    }
    expect(e.isAlive(id)).toBe(false);
    expect(e.count).toBe(0);
    expect(state.stats.kills).toBe(0);
    expect(state.orbs.count).toBe(0);
    // Telegraph 0.75 s + ≥1.6 view diagonals at 420 px/s.
    expect(steps * DT).toBeGreaterThan(0.75 + (1.6 * Math.hypot(720, 1560)) / 420 - 0.1);
  });
});

describe('ghost', () => {
  it('moves toward the player with a lateral oscillation', () => {
    const { state, ctx, e } = setup();
    const id = spawnEnemy(state, typeIndex(state, 'ghost'), 800, 0);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 120; i++) {
      step(ctx);
      minY = Math.min(minY, e.vy[id]);
      maxY = Math.max(maxY, e.vy[id]);
    }
    expect(e.x[id]).toBeLessThan(800 - 0.8 * e.speed[id] * 2);
    // Lateral velocity swings both ways (wobbleAmp 60).
    expect(maxY).toBeGreaterThan(30);
    expect(minY).toBeLessThan(-30);
  });
});

describe('witch', () => {
  it('keeps its distance band and fires enemy projectiles that hurt the player', () => {
    const { state, ctx, e } = setup();
    const id = spawnEnemy(state, typeIndex(state, 'witch'), 700, 0);
    const keep = 300;
    let fired = 0;
    const hp0 = state.player.hp;
    for (let i = 0; i < 60 * 15; i++) {
      const before = state.projectiles.count;
      enemyAISystem(ctx, DT);
      if (state.projectiles.count > before) {
        fired++;
        const pid = state.projectiles.pool.activeIds[state.projectiles.count - 1];
        expect(state.projectiles.side[pid]).toBe(PROJECTILE_SIDE.ENEMY);
      }
      projectileSystem(ctx, DT);
      state.player.invuln = 0;
      state.clock.elapsed += DT;
      if (i > 60 * 6) {
        const d = Math.hypot(e.x[id], e.y[id]);
        expect(d).toBeGreaterThan(keep - 45);
        expect(d).toBeLessThan(keep + 45);
      }
    }
    expect(fired).toBeGreaterThanOrEqual(3);
    expect(state.player.hp).toBeLessThan(hp0);
  });

  it('does not fire out of range', () => {
    const { state, ctx } = setup();
    spawnEnemy(state, typeIndex(state, 'witch'), 5000, 0);
    step(ctx, 60 * 5);
    expect(state.projectiles.count).toBe(0);
  });
});

describe('slime', () => {
  it('initialises size from params with matching scale/radius', () => {
    const { state, ctx, e } = setup();
    const ti = typeIndex(state, 'slime');
    const id = spawnEnemy(state, ti, 500, 0);
    step(ctx);
    expect(e.aiState[id]).toBe(3);
    expect(e.scale[id]).toBeCloseTo(slimeScale(3), 5);
    expect(e.radius[id]).toBeCloseTo(slimeRadius(state.config.enemies[ti]!.radius, 3), 5);
  });

  it('size-3 kill produces two size-2 slimes', () => {
    const { state, ctx, e } = setup();
    const ti = typeIndex(state, 'slime');
    const id = spawnEnemy(state, ti, 500, 0);
    step(ctx);
    const maxHp = e.maxHp[id];
    const energy = e.energyValue[id];
    ctx.damage.push(id, 1e6);
    damageSystem(ctx, DT);
    expect(e.isAlive(id) && e.aiState[id] === 3).toBe(false);
    expect(e.count).toBe(2);
    expect(state.stats.kills).toBe(1);
    for (let k = 0; k < e.count; k++) {
      const c = e.pool.activeIds[k];
      expect(e.aiState[c]).toBe(2);
      expect(e.maxHp[c]).toBeCloseTo(maxHp * 0.45, 4);
      expect(e.hp[c]).toBeCloseTo(maxHp * 0.45, 4);
      expect(e.scale[c]).toBeCloseTo(slimeScale(2), 5);
      expect(e.energyValue[c]).toBe(Math.max(1, Math.floor(energy / 2)));
      expect(e.stun[c]).toBeGreaterThan(0);
      expect(Math.hypot(e.vx[c], e.vy[c])).toBeCloseTo(160, 3);
    }
    // Spread apart: children move in opposite directions.
    const [a, b] = [e.pool.activeIds[0], e.pool.activeIds[1]];
    const y0 = Math.abs(e.y[a] - e.y[b]);
    step(ctx, 5);
    expect(Math.abs(e.y[a] - e.y[b])).toBeGreaterThan(y0);
  });

  it('size-1 kill produces none', () => {
    const { state, ctx, e } = setup();
    const id = spawnEnemy(state, typeIndex(state, 'slime'), 500, 0);
    e.aiState[id] = 1;
    ctx.damage.push(id, 1e6);
    damageSystem(ctx, DT);
    expect(e.count).toBe(0);
  });

  it('non-slime kills are unaffected', () => {
    const { state, ctx, e } = setup();
    const id = spawnEnemy(state, typeIndex(state, 'shambler'), 500, 0);
    ctx.damage.push(id, 1e6);
    damageSystem(ctx, DT);
    expect(e.count).toBe(0);
  });
});
