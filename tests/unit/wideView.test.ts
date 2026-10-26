import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE, GAME_CONFIG, SWARM_EVENTS, type GameConfig } from '../../src/data';
import { BOSS_BLINK_DIST, BOSS_BLINK_TO, bossAttackState, bossBehaviour } from '../../src/sim/behaviours/boss';
import { spawnEnemy } from '../../src/sim/entities';
import { createRunState } from '../../src/sim/RunState';
import { createSimContext, VIEW_HEIGHT, VIEW_WIDTH } from '../../src/sim/SimContext';
import {
  effectiveMaxActive,
  setSpawnRecorder,
  spawnDirector,
  viewDensityScale,
  viewDistanceScale,
} from '../../src/sim/systems/SpawnDirector';
import { RING_EDGE_PAD, RING_RADIUS, ringRadiusFor } from '../../src/sim/systems/swarm';

const DT = 1 / 60;
const WIDE = { width: 2773, height: 1560 };
const BOSS_TYPE = GAME_CONFIG.enemies.findIndex((e) => e.boss);

/** Lots of credits so the active cap is the only limit. */
const FLOOD: GameConfig = {
  ...GAME_CONFIG,
  balance: { ...BALANCE, credits: { ...BALANCE.credits, base: 2000, maxCarry: 500 } },
};

afterEach(() => setSpawnRecorder(null));

describe('wide view: density scale and active cap', () => {
  it('is exactly 1 / maxActive on the default 720×1560 view', () => {
    const view = { width: VIEW_WIDTH, height: VIEW_HEIGHT };
    expect(viewDensityScale(view, BALANCE)).toBe(1);
    expect(effectiveMaxActive(view, BALANCE)).toBe(BALANCE.spawn.maxActive);
    expect(viewDistanceScale(view)).toBe(1);
    expect(ringRadiusFor(view)).toBe(RING_RADIUS);
    // A context created headless uses that default.
    const ctx = createSimContext(createRunState(1));
    expect(ctx.view).toEqual(view);
  });

  it('caps at wideBoostMax and maxActiveWide on 2773×1560', () => {
    expect(viewDensityScale(WIDE, BALANCE)).toBe(BALANCE.spawn.wideBoostMax);
    expect(BALANCE.spawn.wideBoostMax).toBe(1.5);
    expect(effectiveMaxActive(WIDE, BALANCE)).toBe(BALANCE.spawn.maxActiveWide);
    expect(BALANCE.spawn.maxActiveWide).toBe(600);
    // Intermediate landscape view: scale in (1, max), cap strictly between.
    const mid = { width: 1400, height: 1300 };
    const s = viewDensityScale(mid, BALANCE);
    expect(s).toBeCloseTo(Math.sqrt((1400 * 1300) / (720 * 1560)), 10);
    const cap = effectiveMaxActive(mid, BALANCE);
    expect(cap).toBeGreaterThan(400);
    expect(cap).toBeLessThan(600);
    expect(cap).toBe(Math.min(600, Math.round(400 * s)));
    // Taller-than-wide phone views keep the tuned portrait density exactly.
    expect(viewDensityScale({ width: 720, height: 2200 })).toBe(1);
    expect(viewDensityScale({ width: 1800, height: 2400 })).toBe(1);
    expect(viewDensityScale({ width: 720, height: 1200 })).toBe(1);
    // Smaller-than-default views never go below 1 / maxActive.
    expect(viewDensityScale({ width: 400, height: 800 }, BALANCE)).toBe(1);
    expect(effectiveMaxActive({ width: 400, height: 800 }, BALANCE)).toBe(400);
  });

  it('the director fills up to 600 on a wide view and never exceeds it (400 on the default view)', () => {
    for (const [view, cap] of [
      [WIDE, 600],
      [{ width: VIEW_WIDTH, height: VIEW_HEIGHT }, 400],
    ] as const) {
      const state = createRunState(5, FLOOD);
      const ctx = createSimContext(state);
      ctx.view.width = view.width;
      ctx.view.height = view.height;
      let peak = 0;
      for (let i = 0; i < 600; i++) {
        state.clock.elapsed = 100 + i * DT;
        spawnDirector(ctx, DT);
        peak = Math.max(peak, state.enemies.count);
        expect(state.enemies.count).toBeLessThanOrEqual(cap);
      }
      expect(peak).toBe(cap);
    }
  });

  it('earns credits faster on a wide view', () => {
    const count = (view: { width: number; height: number }) => {
      const state = createRunState(9, GAME_CONFIG);
      const ctx = createSimContext(state);
      ctx.view.width = view.width;
      ctx.view.height = view.height;
      let n = 0;
      setSpawnRecorder(() => n++);
      for (let i = 0; i < 120 * 60; i++) {
        state.clock.elapsed = i * DT;
        spawnDirector(ctx, DT);
        state.enemies.reset();
      }
      setSpawnRecorder(null);
      return n;
    };
    const base = count({ width: VIEW_WIDTH, height: VIEW_HEIGHT });
    const wide = count(WIDE);
    expect(wide).toBeGreaterThan(base * 1.35);
    expect(wide).toBeLessThan(base * 1.65);
  });
});

describe('wide view: spawn positions', () => {
  it('spawn points lie outside the wide view, within the margin band', () => {
    const state = createRunState(3, GAME_CONFIG);
    const ctx = createSimContext(state);
    ctx.view.width = WIDE.width;
    ctx.view.height = WIDE.height;
    state.player.x = 123;
    state.player.y = -456;
    const { marginMin, marginMax } = BALANCE.spawn;
    let n = 0;
    setSpawnRecorder((_t, _c, x, y) => {
      const ox = Math.abs(x - state.player.x) - WIDE.width / 2;
      const oy = Math.abs(y - state.player.y) - WIDE.height / 2;
      const out = Math.max(ox, oy); // distance beyond the view edge (rect metric)
      expect(out).toBeGreaterThanOrEqual(marginMin - 1e-3);
      expect(out).toBeLessThanOrEqual(marginMax + 1e-3);
      n++;
    });
    for (let i = 0; i < 300 * 60; i++) {
      state.clock.elapsed = i * DT;
      spawnDirector(ctx, DT);
      state.enemies.reset();
    }
    expect(n).toBeGreaterThan(200);
  });
});

describe('wide view: swarm ring radius', () => {
  it('ring starts beyond the short half-axis + pad', () => {
    for (const view of [WIDE, { width: 720, height: 2200 }, { width: 1800, height: 2400 }]) {
      const r = ringRadiusFor(view);
      expect(r).toBeGreaterThanOrEqual(Math.min(view.width, view.height) / 2 + RING_EDGE_PAD);
      expect(r).toBeGreaterThanOrEqual(RING_RADIUS);
    }
    expect(ringRadiusFor(WIDE)).toBe(1560 / 2 + RING_EDGE_PAD);

    const idx = SWARM_EVENTS.findIndex((s) => s.kind === 'ring');
    const config: GameConfig = { ...GAME_CONFIG, stages: [{ atSec: 0, addTypes: [] }] };
    const state = createRunState(2, config);
    const ctx = createSimContext(state);
    ctx.view.width = WIDE.width;
    ctx.view.height = WIDE.height;
    state.director.swarmIdx = idx;
    state.clock.elapsed = SWARM_EVENTS[idx].atSec;
    spawnDirector(ctx, DT);
    const e = state.enemies;
    expect(e.count).toBe(SWARM_EVENTS[idx].count);
    for (let k = 0; k < e.count; k++) {
      const id = e.pool.activeIds[k];
      expect(Math.hypot(e.x[id] - state.player.x, e.y[id] - state.player.y)).toBeCloseTo(ringRadiusFor(WIDE), 0);
    }
  });
});

describe('wide view: boss distances', () => {
  function bossAt(dist: number) {
    const state = createRunState(4);
    const ctx = createSimContext(state);
    ctx.view.width = WIDE.width;
    ctx.view.height = WIDE.height;
    state.clock.bossSpawned = true;
    const id = spawnEnemy(state, BOSS_TYPE, dist, 0);
    bossAttackState(ctx, id).cooldown = 1e9;
    return { state, ctx, id };
  }

  it('blinks to BOSS_BLINK_TO × k, and only beyond BOSS_BLINK_DIST × k', () => {
    const k = Math.hypot(WIDE.width, WIDE.height) / Math.hypot(VIEW_WIDTH, VIEW_HEIGHT);
    expect(viewDistanceScale(WIDE)).toBeCloseTo(k, 12);
    expect(k).toBeGreaterThan(1.8);

    // Far beyond the scaled blink distance: lands at the scaled blink-to distance (off-screen).
    {
      const { state, ctx, id } = bossAt(8000);
      bossBehaviour(ctx, id, DT);
      const d = Math.hypot(state.enemies.x[id] - state.player.x, state.enemies.y[id] - state.player.y);
      expect(d).toBeCloseTo(BOSS_BLINK_TO * k, 0);
      expect(d).toBeGreaterThan(WIDE.width / 2);
    }
    // Beyond the portrait blink distance but inside the scaled one: no blink.
    {
      const dist = BOSS_BLINK_DIST + 300;
      expect(dist).toBeLessThan(BOSS_BLINK_DIST * k);
      const { state, ctx, id } = bossAt(dist);
      bossBehaviour(ctx, id, DT);
      expect(state.enemies.x[id]).toBe(dist);
      expect(state.enemies.vx[id]).toBeLessThan(0); // still approaching
    }
  });
});
