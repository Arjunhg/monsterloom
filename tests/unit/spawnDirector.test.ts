import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE, GAME_CONFIG } from '../../src/data';
import { EventType } from '../../src/sim/EventBus';
import { spawnEnemy } from '../../src/sim/entities';
import { createRunState, type RunState } from '../../src/sim/RunState';
import { createSimContext, type SimContext } from '../../src/sim/SimContext';
import { setSpawnRecorder, spawnDirector, spawnPointFor } from '../../src/sim/systems/SpawnDirector';

const DT = 1 / 60;

interface Rec {
  t: number;
  x: number;
  y: number;
  q: number;
  type: number;
}

function step(ctx: SimContext): void {
  ctx.state.clock.elapsed += DT;
  spawnDirector(ctx, DT);
}

function drainTypes(state: RunState): { type: number; a: number }[] {
  const out: { type: number; a: number }[] = [];
  state.events.drain((type, a) => out.push({ type, a }));
  return out;
}

function quadrantOf(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx); // (−π, π]
  // q covers [−π/2 + q·π/2, q·π/2)
  return Math.floor(((a + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2));
}

afterEach(() => setSpawnRecorder(null));

describe('SpawnDirector', () => {
  it('despawns far enemies without a kill, orb or event', () => {
    const state = createRunState(1);
    const ctx = createSimContext(state);
    state.director.stageIdx = GAME_CONFIG.stages.length; // skip stage events
    const far = Math.hypot(720, 1560) * BALANCE.spawn.despawnMul + 10;
    const farId = spawnEnemy(state, 0, far, 0);
    const nearId = spawnEnemy(state, 0, 100, 0);
    state.events.clear();
    spawnDirector(ctx, 0);
    expect(state.enemies.isAlive(farId)).toBe(false);
    expect(state.enemies.isAlive(nearId)).toBe(true);
    expect(state.stats.kills).toBe(0);
    expect(state.orbs.count).toBe(0);
    expect(state.events.count).toBe(0);
  });

  it('stage boundary adds Skull Knight once and emits one behaviourIntroduced', () => {
    const state = createRunState(2);
    const ctx = createSimContext(state);
    const knight = GAME_CONFIG.enemies.findIndex((e) => e.id === 'skull_knight');
    const types = new Set<number>();
    setSpawnRecorder((_t, _c, _x, _y, _q, type) => types.add(type));
    state.clock.elapsed = 119;
    spawnDirector(ctx, DT);
    expect(state.director.introduced.has('skull_knight')).toBe(false);
    drainTypes(state);

    let introCount = 0;
    for (let i = 0; i < 60 * 60; i++) {
      step(ctx);
      for (const ev of drainTypes(state)) {
        if (ev.type === EventType.behaviourIntroduced) {
          expect(ev.a).toBe(knight);
          introCount++;
        }
      }
    }
    expect(introCount).toBe(1);
    expect(state.director.stageIdx).toBe(GAME_CONFIG.stages.length);
    expect(types.has(knight)).toBe(true);
  });

  it('spawnPointFor lands on the expanded rect', () => {
    const view = { width: 720, height: 1560 };
    const p = spawnPointFor(10, 20, 0, 50, view);
    expect(p.x).toBeCloseTo(10 + 360 + 50);
    expect(p.y).toBeCloseTo(20);
    const q = spawnPointFor(0, 0, Math.PI / 2, 50, view);
    expect(q.y).toBeCloseTo(780 + 50);
  });

  it('spawns outside the view within the margin band, all quadrants ≥15% over 60 s', () => {
    const state = createRunState(3);
    const ctx = createSimContext(state);
    const recs: Rec[] = [];
    setSpawnRecorder((t, _c, x, y, q, type) => recs.push({ t, x: x - state.player.x, y: y - state.player.y, q, type }));
    const { marginMin, marginMax } = BALANCE.spawn;
    const hw = ctx.view.width / 2;
    const hh = ctx.view.height / 2;
    for (let i = 0; i < 60 * 60; i++) {
      // Player drifts so positions are relative to a moving centre.
      state.player.x += 30 * DT;
      state.player.y -= 10 * DT;
      step(ctx);
    }
    expect(recs.length).toBeGreaterThan(20);
    const counts = [0, 0, 0, 0];
    for (const r of recs) {
      const edge = Math.max(Math.abs(r.x) - hw, Math.abs(r.y) - hh);
      expect(edge).toBeGreaterThanOrEqual(marginMin - 1e-3);
      expect(edge).toBeLessThanOrEqual(marginMax + 1e-3);
      expect(quadrantOf(r.x, r.y)).toBe(r.q);
      counts[r.q]++;
    }
    for (const c of counts) expect(c / recs.length).toBeGreaterThanOrEqual(0.15);
  });

  it('never exceeds maxActive', () => {
    const config = { ...GAME_CONFIG, balance: { ...BALANCE, spawn: { ...BALANCE.spawn, maxActive: 10 } } };
    const state = createRunState(4, config);
    const ctx = createSimContext(state);
    state.clock.elapsed = 400; // high credit rate
    for (let i = 0; i < 60 * 30; i++) {
      step(ctx);
      expect(state.enemies.count).toBeLessThanOrEqual(10);
    }
    expect(state.enemies.count).toBe(10);
    expect(state.director.credits).toBeLessThanOrEqual(BALANCE.credits.maxCarry + 3);
  });

  it('does nothing after the run ended', () => {
    const state = createRunState(5);
    const ctx = createSimContext(state);
    state.outcome = 'defeat';
    for (let i = 0; i < 600; i++) step(ctx);
    expect(state.enemies.count).toBe(0);
  });
});
