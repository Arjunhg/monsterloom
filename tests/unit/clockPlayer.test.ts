import { describe, expect, it } from 'vitest';
import { createRunState } from '../../src/sim/RunState';
import { createSimContext, damagePlayer } from '../../src/sim/SimContext';
import { EventType, type EventCode } from '../../src/sim/EventBus';
import { clockSystem, skyBrightness, skyPhase, timeRemaining } from '../../src/sim/systems/ClockSystem';
import { createPlayerSystem } from '../../src/sim/systems/PlayerSystem';

function drainEvents(state: ReturnType<typeof createRunState>): Array<[EventCode, number]> {
  const out: Array<[EventCode, number]> = [];
  state.events.drain((t, a) => out.push([t, a]));
  return out;
}

describe('ClockSystem', () => {
  it('declares victory exactly at dawn when hp > 0', () => {
    const state = createRunState(1);
    const ctx = createSimContext(state);
    state.clock.elapsed = state.clock.duration - 0.5;
    clockSystem(ctx, 0.25);
    expect(state.outcome).toBeNull();
    expect(timeRemaining(state)).toBeCloseTo(0.25);
    clockSystem(ctx, 0.25);
    expect(state.clock.elapsed).toBe(state.clock.duration);
    expect(state.outcome).toBe('victory');
    expect(timeRemaining(state)).toBe(0);
    expect(drainEvents(state)).toEqual([[EventType.runEnded, 1]]);
  });

  it('clamps elapsed to duration and does not advance after outcome', () => {
    const state = createRunState(2);
    const ctx = createSimContext(state);
    state.clock.elapsed = state.clock.duration - 0.1;
    clockSystem(ctx, 5);
    expect(state.clock.elapsed).toBe(state.clock.duration);
    expect(state.outcome).toBe('victory');
    clockSystem(ctx, 1);
    expect(state.clock.elapsed).toBe(state.clock.duration);
    expect(drainEvents(state)).toHaveLength(1);

    const s2 = createRunState(3);
    const c2 = createSimContext(s2);
    clockSystem(c2, 10);
    s2.outcome = 'defeat';
    clockSystem(c2, 10);
    expect(s2.clock.elapsed).toBe(10);
  });

  it('does not declare victory when hp is 0', () => {
    const state = createRunState(4);
    const ctx = createSimContext(state);
    state.player.hp = 0;
    clockSystem(ctx, state.clock.duration);
    expect(state.outcome).toBeNull();
  });

  it('skyPhase and skyBrightness are monotone in [0,1]', () => {
    const duration = 540;
    let prevPhase = -Infinity;
    let prevBright = -Infinity;
    for (let t = -10; t <= duration + 10; t += 0.37) {
      const ph = skyPhase(t, duration);
      const br = skyBrightness(ph);
      expect(ph).toBeGreaterThanOrEqual(0);
      expect(ph).toBeLessThanOrEqual(1);
      expect(br).toBeGreaterThanOrEqual(0);
      expect(br).toBeLessThanOrEqual(1);
      expect(ph).toBeGreaterThanOrEqual(prevPhase);
      expect(br).toBeGreaterThanOrEqual(prevBright);
      prevPhase = ph;
      prevBright = br;
    }
    expect(skyPhase(0, duration)).toBe(0);
    expect(skyPhase(duration, duration)).toBe(1);
    expect(skyBrightness(0)).toBe(0);
    expect(skyBrightness(1)).toBe(1);
  });
});

describe('PlayerSystem', () => {
  it('moves by speed * moveSpeed * dt and records prev position / last dir', () => {
    const state = createRunState(5);
    const ctx = createSimContext(state);
    const sys = createPlayerSystem(() => ({ x: 1, y: 0 }));
    sys(ctx, 0.5);
    expect(state.player.prevX).toBe(0);
    expect(state.player.x).toBeCloseTo(state.player.speed * 0.5);
    expect(state.player.vx).toBeCloseTo(state.player.speed);
    expect(state.player.lastDirX).toBe(1);

    state.player.stats.moveSpeed = 1.5;
    const x0 = state.player.x;
    sys(ctx, 0.1);
    expect(state.player.prevX).toBe(x0);
    expect(state.player.x - x0).toBeCloseTo(state.player.speed * 1.5 * 0.1);
  });

  it('clamps input length to 1 (diagonal) and keeps lastDir on zero input', () => {
    const state = createRunState(6);
    const ctx = createSimContext(state);
    let input = { x: 1, y: 1 };
    const sys = createPlayerSystem(() => input);
    sys(ctx, 1);
    const dist = Math.hypot(state.player.x, state.player.y);
    expect(dist).toBeCloseTo(state.player.speed);
    expect(state.player.lastDirX).toBeCloseTo(Math.SQRT1_2);
    expect(state.player.lastDirY).toBeCloseTo(Math.SQRT1_2);

    // Sub-unit analog input is not normalised up.
    input = { x: 0, y: -0.5 };
    const y0 = state.player.y;
    sys(ctx, 1);
    expect(state.player.y - y0).toBeCloseTo(-0.5 * state.player.speed);
    expect(state.player.lastDirY).toBeCloseTo(-1);

    input = { x: 0, y: 0 };
    sys(ctx, 1);
    expect(state.player.vx).toBe(0);
    expect(state.player.vy).toBe(0);
    expect(state.player.lastDirY).toBeCloseTo(-1);
  });

  it('is a no-op once the outcome is set', () => {
    const state = createRunState(7);
    const ctx = createSimContext(state);
    const sys = createPlayerSystem(() => ({ x: 1, y: 0 }));
    state.outcome = 'victory';
    sys(ctx, 1);
    expect(state.player.x).toBe(0);
  });

  it('invulnerability lasts exactly balance.player.invulnSec', () => {
    const state = createRunState(8);
    const ctx = createSimContext(state);
    const sys = createPlayerSystem(() => ({ x: 0, y: 0 }));
    const inv = state.config.balance.player.invulnSec;
    const hp0 = state.player.hp;
    const dt = 1 / 60;

    expect(damagePlayer(state, 10)).toBe(true);
    expect(state.player.invuln).toBe(inv);
    const steps = Math.round(inv / dt);
    for (let i = 0; i < steps - 1; i++) {
      sys(ctx, dt);
      expect(damagePlayer(state, 10)).toBe(false);
    }
    expect(state.player.hp).toBe(hp0 - 10);
    sys(ctx, dt);
    expect(state.player.invuln).toBe(0);
    expect(damagePlayer(state, 10)).toBe(true);
    expect(state.player.hp).toBe(hp0 - 20);
  });

  it('death at exactly 0 hp sets defeat and emits runEnded(0)', () => {
    const state = createRunState(9);
    const ctx = createSimContext(state);
    expect(damagePlayer(state, state.player.hp)).toBe(true);
    expect(state.player.hp).toBe(0);
    expect(state.outcome).toBe('defeat');
    const evs = drainEvents(state);
    expect(evs[evs.length - 1]).toEqual([EventType.runEnded, 0]);
    // Clock no longer advances / no victory after defeat.
    const e0 = state.clock.elapsed;
    clockSystem(ctx, state.clock.duration);
    expect(state.clock.elapsed).toBe(e0);
    expect(state.outcome).toBe('defeat');
  });
});
