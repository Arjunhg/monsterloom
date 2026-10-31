import { describe, expect, it } from 'vitest';
import { createRunState } from '../../src/sim/RunState';
import { createSimContext } from '../../src/sim/SimContext';
import {
  BLOOD_MOON_SURGE_SEC,
  bloodMoonSchedule,
  bloodMoonSystem,
} from '../../src/sim/systems/BloodMoonSystem';
import { rewardFor } from '../../src/meta/MetaProgression';

const DT = 1 / 60;
const DURATION = 540;
const BOSS_LEAD = 90;

/** Task 27.2: Blood Moon surges (Req 31). */
describe('blood moon schedule', () => {
  it('is deterministic per seed and varies across seeds', () => {
    const a = bloodMoonSchedule(12345, DURATION, BOSS_LEAD);
    const b = bloodMoonSchedule(12345, DURATION, BOSS_LEAD);
    expect(b).toEqual(a);
    const others = [1, 2, 3, 999].map((s) => JSON.stringify(bloodMoonSchedule(s, DURATION, BOSS_LEAD)));
    expect(others.some((o) => o !== JSON.stringify(a))).toBe(true);
  });

  it('has 2-3 non-overlapping 20 s windows inside the safe span', () => {
    for (const seed of [1, 7, 42, 12345, 987654321]) {
      const w = bloodMoonSchedule(seed, DURATION, BOSS_LEAD);
      expect(w.length).toBeGreaterThanOrEqual(2);
      expect(w.length).toBeLessThanOrEqual(3);
      let prevEnd = -Infinity;
      for (const win of w) {
        expect(win.end - win.start).toBe(BLOOD_MOON_SURGE_SEC);
        expect(win.start).toBeGreaterThanOrEqual(30);
        expect(win.end).toBeLessThanOrEqual(DURATION - BOSS_LEAD);
        expect(win.start).toBeGreaterThanOrEqual(prevEnd);
        prevEnd = win.end;
      }
    }
  });
});

describe('blood moon system', () => {
  function setup() {
    const state = createRunState(12345);
    const ctx = createSimContext(state);
    return { state, ctx };
  }

  it('activates inside a window and pays bonus kills only there', () => {
    const { state, ctx } = setup();
    const [first] = bloodMoonSchedule(state.seed, state.clock.duration, state.config.balance.run.bossLeadSec);

    state.clock.elapsed = first.start - 5;
    state.stats.kills += 3;
    bloodMoonSystem(ctx, DT);
    expect(state.bloodMoon.active).toBe(false);
    expect(state.stats.surgeKills).toBe(0);
    expect(state.stats.bonusKills).toBe(0);

    state.clock.elapsed = first.start + 1;
    bloodMoonSystem(ctx, DT);
    expect(state.bloodMoon.active).toBe(true);
    state.stats.kills += 4;
    bloodMoonSystem(ctx, DT);
    expect(state.stats.surgeKills).toBe(4);
    expect(state.stats.bonusKills).toBe(4);

    state.clock.elapsed = first.end + 1;
    bloodMoonSystem(ctx, DT);
    expect(state.bloodMoon.active).toBe(false);
    state.stats.kills += 2;
    bloodMoonSystem(ctx, DT);
    expect(state.stats.surgeKills).toBe(4);
  });

  it('stays inactive after the run ends', () => {
    const { state, ctx } = setup();
    const [first] = bloodMoonSchedule(state.seed, state.clock.duration, state.config.balance.run.bossLeadSec);
    state.outcome = 'defeat';
    state.clock.elapsed = first.start + 1;
    bloodMoonSystem(ctx, DT);
    expect(state.bloodMoon.active).toBe(false);
  });

  it('surge kills add bonus Bones to the run reward', () => {
    expect(rewardFor(300, 100, false, 10)).toBe(rewardFor(300, 100, false) + 10);
    expect(rewardFor(300, 100, true, 7)).toBe(rewardFor(300, 100, true) + 7);
  });
});
