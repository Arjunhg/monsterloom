import { describe, expect, it } from 'vitest';
import { createRunState, ENEMY_FLAG } from '../../src/sim/RunState';
import { createSimContext } from '../../src/sim/SimContext';
import { spawnEnemy } from '../../src/sim/entities';
import { BEHAVIOURS, enemyAISystem, registerBehaviour } from '../../src/sim/systems/EnemyAISystem';
import { spatialIndexSystem } from '../../src/sim/systems/SpatialIndexSystem';
import { separationSystem } from '../../src/sim/systems/SeparationSystem';

const DT = 1 / 60;

function setup() {
  const state = createRunState(42);
  const ctx = createSimContext(state);
  state.player.x = 0;
  state.player.y = 0;
  return { state, ctx, e: state.enemies };
}

describe('EnemyAISystem', () => {
  it('chaser moves toward the player at its type speed', () => {
    const { state, ctx, e } = setup();
    const id = spawnEnemy(state, 0, 300, 400);
    const speed = state.config.enemies[0]!.speed;
    enemyAISystem(ctx, DT);
    expect(Math.hypot(e.vx[id], e.vy[id])).toBeCloseTo(speed, 3);
    expect(e.vx[id]).toBeLessThan(0);
    expect(e.vy[id]).toBeLessThan(0);
    expect(e.prevX[id]).toBe(300);
    expect(e.prevY[id]).toBe(400);
    const moved = Math.hypot(e.x[id] - 300, e.y[id] - 400);
    expect(moved).toBeCloseTo(speed * DT, 3);
    expect(Math.hypot(e.x[id], e.y[id])).toBeLessThan(500);
  });

  it('is safe when the enemy sits exactly on the player', () => {
    const { state, ctx, e } = setup();
    const id = spawnEnemy(state, 0, 0, 0);
    enemyAISystem(ctx, DT);
    expect(Number.isFinite(e.x[id])).toBe(true);
    expect(e.vx[id]).toBe(0);
    expect(e.vy[id]).toBe(0);
  });

  it('slow reduces speed and expires', () => {
    const { state, ctx, e } = setup();
    const id = spawnEnemy(state, 0, 500, 0);
    const speed = e.speed[id];
    e.slowAmt[id] = 0.5;
    e.slowTimer[id] = 0.1;
    enemyAISystem(ctx, DT);
    expect(Math.hypot(e.vx[id], e.vy[id])).toBeCloseTo(speed * 0.5, 3);
    for (let s = 0; s < 10; s++) enemyAISystem(ctx, DT);
    expect(e.slowTimer[id]).toBe(0);
    expect(e.slowAmt[id]).toBe(0);
    expect(Math.hypot(e.vx[id], e.vy[id])).toBeCloseTo(speed, 3);
  });

  it('stunned enemy does not steer but keeps damped momentum', () => {
    const { state, ctx, e } = setup();
    const id = spawnEnemy(state, 0, 100, 0);
    e.stun[id] = 1;
    e.vx[id] = 200; // hurled away from the player
    e.vy[id] = 0;
    enemyAISystem(ctx, DT);
    expect(e.vx[id]).toBeCloseTo(180, 3);
    expect(e.vy[id]).toBe(0);
    expect(e.x[id]).toBeGreaterThan(100);
    expect(e.stun[id]).toBeCloseTo(1 - DT, 5);
  });

  it('unregistered behaviour codes fall back to chaser; registerBehaviour overrides', () => {
    const { state, ctx, e } = setup();
    const id = spawnEnemy(state, 0, 100, 0);
    e.behaviour[id] = 4; // witch: not implemented yet
    const prev = BEHAVIOURS[4];
    expect(prev).toBeUndefined();
    enemyAISystem(ctx, DT);
    expect(e.vx[id]).toBeLessThan(0);
    registerBehaviour(4, (c, i) => {
      c.state.enemies.vx[i] = 0;
      c.state.enemies.vy[i] = 7;
    });
    try {
      enemyAISystem(ctx, DT);
      expect(e.vy[id]).toBe(7);
    } finally {
      BEHAVIOURS[4] = prev;
    }
  });

  it('does nothing once the run has ended', () => {
    const { state, ctx, e } = setup();
    const id = spawnEnemy(state, 0, 100, 0);
    state.outcome = 'defeat';
    enemyAISystem(ctx, DT);
    expect(e.x[id]).toBe(100);
  });
});

describe('SpatialIndexSystem', () => {
  it('contains every alive enemy id', () => {
    const { state, ctx, e } = setup();
    const ids: number[] = [];
    for (let k = 0; k < 50; k++) ids.push(spawnEnemy(state, k % 3, k * 37 - 900, (k * 53) % 700 - 350));
    e.free(ids[10]!);
    e.free(ids[20]!);
    spatialIndexSystem(ctx, DT);
    const out: number[] = [];
    ctx.enemyHash.queryRadius(0, 0, 1e6, out);
    const expected = ids.filter((_, k) => k !== 10 && k !== 20).sort((a, b) => a - b);
    expect(out.sort((a, b) => a - b)).toEqual(expected);
  });
});

describe('SeparationSystem', () => {
  it('pushes two overlapping enemies apart symmetrically', () => {
    const { state, ctx, e } = setup();
    const a = spawnEnemy(state, 0, 0, 0);
    const b = spawnEnemy(state, 0, 4, 0);
    const before = Math.abs(e.x[b] - e.x[a]);
    spatialIndexSystem(ctx, DT);
    separationSystem(ctx, DT);
    expect(Math.abs(e.x[b] - e.x[a])).toBeGreaterThan(before);
    expect(e.x[a]).toBeLessThan(0);
    expect(e.x[b]).toBeGreaterThan(4);
    expect(e.x[a] + e.x[b]).toBeCloseTo(4, 4);
  });

  it('leaves NO_SEP enemies unmoved and they do not push others', () => {
    const { state, ctx, e } = setup();
    const a = spawnEnemy(state, 0, 0, 0);
    const g = spawnEnemy(state, 0, 3, 0);
    e.flags[g] |= ENEMY_FLAG.NO_SEP;
    spatialIndexSystem(ctx, DT);
    separationSystem(ctx, DT);
    expect(e.x[g]).toBe(3);
    expect(e.y[g]).toBe(0);
    expect(e.x[a]).toBe(0);
    expect(e.y[a]).toBe(0);
  });

  it('separates coincident enemies deterministically', () => {
    const run = () => {
      const { state, ctx, e } = setup();
      const a = spawnEnemy(state, 0, 50, 50);
      const b = spawnEnemy(state, 0, 50, 50);
      spatialIndexSystem(ctx, DT);
      separationSystem(ctx, DT);
      return [e.x[a], e.y[a], e.x[b], e.y[b]] as const;
    };
    const r1 = run();
    const r2 = run();
    expect(r1).toEqual(r2);
    const [ax, ay, bx, by] = r1;
    expect(Math.hypot(ax - bx, ay - by)).toBeGreaterThan(0);
    expect(ax + bx).toBeCloseTo(100, 4);
    expect(ay + by).toBeCloseTo(100, 4);
  });

  it('clamps push per step and caps neighbours', () => {
    const { state, ctx, e } = setup();
    const ids: number[] = [];
    for (let k = 0; k < 20; k++) ids.push(spawnEnemy(state, 0, 0, 0));
    spatialIndexSystem(ctx, DT);
    separationSystem(ctx, DT);
    for (const id of ids) {
      expect(Math.hypot(e.x[id], e.y[id])).toBeLessThanOrEqual(e.radius[id] + 1e-4);
    }
  });
});
