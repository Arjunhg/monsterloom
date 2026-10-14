import { describe, expect, it } from 'vitest';
import { Sim, SIM_STEP } from '../../src/sim/Sim';
import { drawOffers, applyOffer } from '../../src/sim/upgrades/UpgradeSystem';
import { resolveLevelUp } from '../../src/sim/systems/EnergySystem';

/** Plays `seconds` with a scripted circling input, auto-picking offer 0 at every menu. */
function play(sim: Sim, seconds: number): void {
  const steps = Math.round(seconds / SIM_STEP);
  for (let i = 0; i < steps && sim.state.outcome === null; i++) {
    const a = i * 0.01;
    sim.setInput(Math.cos(a), Math.sin(a));
    if (sim.state.paused === 'menu') {
      applyOffer(sim.state, drawOffers(sim.state, sim.state.rng.upgrades)[0]);
      resolveLevelUp(sim.state);
      continue;
    }
    sim.stepOnce();
  }
}

describe('Sim', () => {
  it('runs a full simulated minute: enemies spawn, die, drop energy and level the player up', () => {
    const sim = new Sim({ seed: 1234, assertFinite: true });
    play(sim, 60);
    const s = sim.state;
    expect(s.clock.elapsed).toBeGreaterThan(30);
    expect(s.stats.kills).toBeGreaterThan(0);
    expect(s.energy.levelUps).toBeGreaterThan(0);
    expect(s.build.parts.size).toBeGreaterThan(1);
  });

  it('is deterministic for the same seed and inputs', () => {
    const a = new Sim({ seed: 99 });
    const b = new Sim({ seed: 99 });
    play(a, 30);
    play(b, 30);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('does not advance while paused, and resume only ends user/auto pauses', () => {
    const sim = new Sim({ seed: 5 });
    sim.pause('user');
    sim.advance(1);
    expect(sim.state.clock.elapsed).toBe(0);
    sim.resume();
    sim.advance(0.1);
    expect(sim.state.clock.elapsed).toBeGreaterThan(0);
    sim.state.paused = 'menu';
    sim.pause('auto'); // must not downgrade the menu
    sim.resume();
    expect(sim.state.paused).toBe('menu');
  });

  it('restart resets everything in place and records a new seed when none is given', () => {
    const sim = new Sim({ seed: 7 });
    const enemyX = sim.state.enemies.x;
    play(sim, 40);
    sim.restart();
    const s = sim.state;
    expect(s.enemies.count + s.projectiles.count + s.orbs.count + s.tokens.count).toBe(0);
    expect([...s.build.parts.keys()]).toEqual(['blob_spit']);
    expect(s.clock.elapsed).toBe(0);
    expect(s.energy.value).toBe(0);
    expect(s.stats.kills).toBe(0);
    expect(s.enemies.x).toBe(enemyX);
    expect(Number.isInteger(s.seed)).toBe(true);
    // And the restarted run plays identically to a fresh Sim with that seed.
    const fresh = new Sim({ seed: s.seed });
    play(sim, 20);
    play(fresh, 20);
    expect(sim.snapshot()).toEqual(fresh.snapshot());
  });

  it('a whole night with no input still ends with an outcome', () => {
    const sim = new Sim({ seed: 3, assertFinite: true });
    for (let i = 0; i < 540 * 60 + 10 && sim.state.outcome === null; i++) {
      if (sim.state.paused === 'menu') {
        applyOffer(sim.state, drawOffers(sim.state, sim.state.rng.upgrades)[0]);
        resolveLevelUp(sim.state);
        continue;
      }
      sim.stepOnce();
    }
    expect(sim.state.outcome).not.toBeNull();
  });
});
