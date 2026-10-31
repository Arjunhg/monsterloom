import { describe, expect, it } from 'vitest';
import { createRunState } from '../../src/sim/RunState';
import { Sim } from '../../src/sim/Sim';
import { createSimContext } from '../../src/sim/SimContext';
import {
  FRENZY_CHARGE_PER_KILL,
  FRENZY_DAMAGE_MULT,
  FRENZY_METER_MAX,
  FRENZY_SPEED_MULT,
  FRENZY_WINDOW_SEC,
  frenzySystem,
  frenzyView,
} from '../../src/sim/systems/FrenzySystem';

const DT = 1 / 60;

/** Task 26.2: Frenzy meter (Req 30). Kills are fed by bumping stats.kills,
 *  exactly what DamageSystem does before FrenzySystem runs each tick. */
function setup() {
  const state = createRunState(1);
  const ctx = createSimContext(state);
  return { state, ctx };
}

function step(ctx: ReturnType<typeof createSimContext>, n = 1): void {
  for (let i = 0; i < n; i++) frenzySystem(ctx, DT);
}

function killsToFill(): number {
  return Math.ceil(FRENZY_METER_MAX / FRENZY_CHARGE_PER_KILL);
}

describe('frenzy meter', () => {
  it('fills on kills and decays without them', () => {
    const { state, ctx } = setup();
    state.stats.kills += 5;
    step(ctx);
    expect(frenzyView(state).meter).toBeCloseTo(5 * FRENZY_CHARGE_PER_KILL, 0);
    const charged = frenzyView(state).meter;
    step(ctx, 60); // 1 s of no kills
    expect(frenzyView(state).meter).toBeLessThan(charged);
    expect(frenzyView(state).active).toBe(false);
  });

  it('activates exactly at full, scales stats, and restores them exactly at the end', () => {
    const { state, ctx } = setup();
    const baseDamage = state.player.stats.damage;
    const baseSpeed = state.player.stats.moveSpeed;
    state.stats.kills += killsToFill();
    step(ctx);
    expect(frenzyView(state).active).toBe(true);
    expect(state.player.stats.damage).toBeCloseTo(baseDamage * FRENZY_DAMAGE_MULT);
    expect(state.player.stats.moveSpeed).toBeCloseTo(baseSpeed * FRENZY_SPEED_MULT);
    step(ctx, Math.ceil(FRENZY_WINDOW_SEC / DT) + 2);
    expect(frenzyView(state).active).toBe(false);
    expect(state.player.stats.damage).toBe(baseDamage);
    expect(state.player.stats.moveSpeed).toBe(baseSpeed);
    expect(frenzyView(state).meter).toBeLessThan(FRENZY_CHARGE_PER_KILL);
  });

  it('kills during the window earn bonus kills for score; kills outside do not', () => {
    const { state, ctx } = setup();
    state.stats.kills += 3;
    step(ctx);
    expect(state.stats.bonusKills).toBe(0);
    state.stats.kills += killsToFill();
    step(ctx);
    expect(frenzyView(state).active).toBe(true);
    state.stats.kills += 4;
    step(ctx);
    expect(state.stats.bonusKills).toBe(4);
    step(ctx, Math.ceil(FRENZY_WINDOW_SEC / DT) + 2);
    state.stats.kills += 2;
    step(ctx);
    expect(state.stats.bonusKills).toBe(4);
  });

  it('does not charge or stay active after the run ends', () => {
    const { state, ctx } = setup();
    state.outcome = 'defeat';
    state.stats.kills += killsToFill();
    step(ctx, 10);
    expect(frenzyView(state).active).toBe(false);
    expect(frenzyView(state).meter).toBe(0);
  });

  it('stays deterministic: same seed and inputs give the same frenzy state', () => {
    const run = () => {
      const sim = new Sim({ seed: 4242 });
      sim.setInput(1, 0.5);
      for (let i = 0; i < 3600; i++) sim.stepOnce(DT);
      return {
        snap: sim.snapshot(),
        bonusKills: sim.state.stats.bonusKills,
        meter: frenzyView(sim.state).meter,
      };
    };
    const a = run();
    const b = run();
    expect(b).toEqual(a);
  });
});
