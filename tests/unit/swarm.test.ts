import { beforeAll, describe, expect, it } from 'vitest';
import { GAME_CONFIG, SWARM_EVENTS, type GameConfig } from '../../src/data';
import { installV2Behaviours } from '../../src/sim/behaviours';
import { installSwarmBehaviours, RING_ARRIVE_DIST } from '../../src/sim/behaviours/swarm';
import { BEHAVIOUR_CODE, spawnEnemy } from '../../src/sim/entities';
import { EventType } from '../../src/sim/EventBus';
import { createRunState, ENEMY_FLAG, type RunState } from '../../src/sim/RunState';
import { createSimContext, type SimContext } from '../../src/sim/SimContext';
import { enemyAISystem } from '../../src/sim/systems/EnemyAISystem';
import { SWARM_WARNING_SEC, spawnDirector } from '../../src/sim/systems/SpawnDirector';
import { RING_RADIUS, RING_GAP_PLAYER_RADII } from '../../src/sim/systems/swarm';

const DT = 1 / 60;
// No credit-funded spawns: only swarm events put enemies in the store.
const SWARM_ONLY: GameConfig = { ...GAME_CONFIG, stages: [{ atSec: 0, addTypes: [] }] };

beforeAll(() => {
  installV2Behaviours();
  installSwarmBehaviours();
});

function setup(seed = 1, config: GameConfig = SWARM_ONLY): { state: RunState; ctx: SimContext } {
  const state = createRunState(seed, config);
  return { state, ctx: createSimContext(state) };
}

function alive(state: RunState): number[] {
  const e = state.enemies;
  return Array.from(e.pool.activeIds.subarray(0, e.count));
}

/** Starts swarm event `idx` directly (player at px, py). */
function startEvent(idx: number, px = 0, py = 0, seed = 1) {
  const s = setup(seed);
  s.state.player.x = px;
  s.state.player.y = py;
  s.state.director.swarmIdx = idx;
  s.state.clock.elapsed = SWARM_EVENTS[idx].atSec;
  spawnDirector(s.ctx, DT);
  return s;
}

describe('swarm events (Req 23)', () => {
  it('warning fires 2 s before each event exactly once, then the event starts', () => {
    const { state, ctx } = setup(3);
    const warnings: Array<{ idx: number; t: number; until: number }> = [];
    const starts: number[] = [];
    for (let i = 0; i <= 440 * 60; i++) {
      state.clock.elapsed = i * DT;
      const before = state.director.swarmIdx;
      spawnDirector(ctx, DT);
      if (state.director.swarmIdx !== before) starts.push(state.clock.elapsed);
      state.events.drain((type, a, b) => {
        if (type === EventType.swarmWarning) warnings.push({ idx: a, t: state.clock.elapsed, until: b });
      });
      state.enemies.reset();
    }
    expect(warnings.map((w) => w.idx)).toEqual(SWARM_EVENTS.map((_, i) => i));
    expect(starts).toHaveLength(SWARM_EVENTS.length);
    warnings.forEach((w, i) => {
      const at = SWARM_EVENTS[i].atSec;
      expect(w.t).toBeGreaterThanOrEqual(at - SWARM_WARNING_SEC - 1e-9);
      expect(w.t).toBeLessThan(at - SWARM_WARNING_SEC + DT + 1e-9);
      expect(w.until).toBeCloseTo(SWARM_WARNING_SEC, 1);
      expect(starts[i]).toBeGreaterThanOrEqual(at - 1e-9);
      expect(starts[i]).toBeLessThan(at + DT + 1e-9);
    });
    expect(state.director.swarmIdx).toBe(SWARM_EVENTS.length);
  });

  it('ring spawns `count` enemies on a circle around the player with a gap; they close in, then revert', () => {
    const def = SWARM_EVENTS[0];
    expect(def.kind).toBe('ring');
    const { state, ctx } = startEvent(0, 300, -200);
    const e = state.enemies;
    const ids = alive(state);
    const typeIndex = state.config.enemies.findIndex((t) => t.id === def.typeId);
    expect(ids).toHaveLength(def.count);
    const angles: number[] = [];
    for (const id of ids) {
      expect(e.typeId[id]).toBe(typeIndex);
      expect(e.behaviour[id]).toBe(BEHAVIOUR_CODE.ringInward);
      expect(e.flags[id] & ENEMY_FLAG.SWARM).toBeTruthy();
      expect(e.flags[id] & ENEMY_FLAG.NO_MERGE).toBeTruthy();
      expect(Math.hypot(e.x[id] - 300, e.y[id] + 200)).toBeCloseTo(RING_RADIUS, 0);
      angles.push(Math.atan2(e.y[id] + 200, e.x[id] - 300));
    }
    angles.sort((a, b) => a - b);
    let gap = angles[0] + 2 * Math.PI - angles[angles.length - 1];
    for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
    expect(gap * RING_RADIUS).toBeGreaterThanOrEqual(RING_GAP_PLAYER_RADII * state.player.radius - 0.5);

    // Close in: distance to the centre shrinks every step until the member reverts.
    const prevD = new Map(ids.map((id) => [id, RING_RADIUS]));
    for (let step = 0; step < 13 * 60; step++) {
      enemyAISystem(ctx, DT);
      for (const id of ids) {
        if (e.behaviour[id] !== BEHAVIOUR_CODE.ringInward) continue;
        const d = Math.hypot(e.x[id] - 300, e.y[id] + 200);
        expect(d).toBeLessThan(prevD.get(id)!);
        prevD.set(id, d);
      }
    }
    for (const id of ids) {
      expect(e.isAlive(id)).toBe(true);
      expect(e.behaviour[id]).toBe(BEHAVIOUR_CODE.chaser);
      expect(e.flags[id] & ENEMY_FLAG.SWARM).toBe(0);
      expect(e.flags[id] & ENEMY_FLAG.NO_MERGE).toBe(0); // imps can merge again
      expect(Math.hypot(e.x[id] - 300, e.y[id] + 200)).toBeLessThan(RING_ARRIVE_DIST + 150);
    }
  });

  it('stampede runs in a straight line across the view and is freed past the far edge without kills or orbs', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const def = SWARM_EVENTS[1];
      expect(def.kind).toBe('stampede');
      const { state, ctx } = startEvent(1, 50, 80, seed);
      const e = state.enemies;
      const ids = alive(state);
      expect(ids).toHaveLength(def.count);
      const start = new Map(ids.map((id) => [id, [e.x[id], e.y[id], e.aiDirX[id], e.aiDirY[id]] as const]));
      // All members share one direction, start outside the view and head towards it.
      const [, , dx0, dy0] = start.get(ids[0])!;
      for (const id of ids) {
        const [x, y, dx, dy] = start.get(id)!;
        expect(e.behaviour[id]).toBe(BEHAVIOUR_CODE.stampede);
        expect([dx, dy]).toEqual([dx0, dy0]);
        expect(Math.abs(dx) + Math.abs(dy)).toBe(1);
        if (dx !== 0) expect(Math.abs(x - 50)).toBeGreaterThan(ctx.view.width / 2);
        else expect(Math.abs(y - 80)).toBeGreaterThan(ctx.view.height / 2);
        expect(((50 - x) * dx + (80 - y) * dy) > 0).toBe(true);
      }
      const freedAt = new Map<number, number>();
      for (let step = 0; step < 30 * 60 && e.count > 0; step++) {
        enemyAISystem(ctx, DT);
        for (const id of ids) {
          if (freedAt.has(id)) continue;
          if (!e.isAlive(id)) {
            freedAt.set(id, step);
            continue;
          }
          const [x, y, dx, dy] = start.get(id)!;
          // Perpendicular coordinate never changes.
          if (dx !== 0) expect(e.y[id]).toBeCloseTo(y, 3);
          else expect(e.x[id]).toBeCloseTo(x, 3);
        }
      }
      expect(e.count).toBe(0);
      expect(state.stats.kills).toBe(0);
      expect(state.orbs.count).toBe(0);
      let killed = 0;
      state.events.drain((type) => {
        if (type === EventType.enemyKilled) killed++;
      });
      expect(killed).toBe(0);
    }
  });

  it('swarm spawns do not spend horde or special credits', () => {
    const { state, ctx } = setup(9, GAME_CONFIG);
    state.clock.elapsed = SWARM_EVENTS[0].atSec;
    state.director.swarmIdx = 0;
    // Below every lane's cheapest cost, so no credit-funded spawn can happen; dt = 0 earns nothing.
    state.director.credits = 0.5;
    state.director.specialCredits = 0.75;
    spawnDirector(ctx, 0);
    expect(state.director.swarmIdx).toBe(1);
    expect(state.enemies.count).toBe(SWARM_EVENTS[0].count);
    expect(state.director.credits).toBe(0.5);
    expect(state.director.specialCredits).toBe(0.75);
  });

  it('respects maxActive', () => {
    const { state, ctx } = setup(4);
    const maxActive = state.config.balance.spawn.maxActive;
    const filler = state.config.enemies.findIndex((t) => t.id === 'shambler');
    while (state.enemies.count < maxActive - 5) spawnEnemy(state, filler, 10, 10);
    state.clock.elapsed = SWARM_EVENTS[0].atSec;
    spawnDirector(ctx, DT);
    expect(state.enemies.count).toBe(maxActive);
    expect(state.director.swarmIdx).toBe(1);
  });

  it('a bat stampede uses stampede steering and never telegraphs', () => {
    const idx = SWARM_EVENTS.findIndex((s) => s.kind === 'stampede' && s.typeId === 'bat');
    expect(idx).toBeGreaterThanOrEqual(0);
    const { state, ctx } = startEvent(idx, 0, 0, 7);
    const e = state.enemies;
    const ids = alive(state);
    expect(ids).toHaveLength(SWARM_EVENTS[idx].count);
    for (let step = 0; step < 12 * 60 && e.count > 0; step++) {
      enemyAISystem(ctx, DT);
      for (const id of ids) {
        if (!e.isAlive(id)) continue;
        expect(e.behaviour[id]).toBe(BEHAVIOUR_CODE.stampede);
        expect(e.aiState[id]).toBe(0);
        expect(Math.hypot(e.vx[id], e.vy[id])).toBeGreaterThan(0);
      }
    }
  });
});
