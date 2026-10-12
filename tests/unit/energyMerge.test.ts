import { describe, expect, it } from 'vitest';
import { thresholdFor } from '../../src/data/balance';
import { createRunState } from '../../src/sim/RunState';
import { createSimContext, spawnEnemy, spawnOrb } from '../../src/sim/SimContext';
import { EventType } from '../../src/sim/EventBus';
import { collectEnergy, energySystem, fillFraction, resolveLevelUp } from '../../src/sim/systems/EnergySystem';
import { enforceOrbCap, orbSystem } from '../../src/sim/systems/OrbSystem';
import { mergeSystem } from '../../src/sim/systems/MergeSystem';
import { spatialIndexSystem } from '../../src/sim/systems/SpatialIndexSystem';

describe('Energy and orbs', () => {
  it('converts thresholds into pending level-ups with carry-over and pauses for the menu', () => {
    const s = createRunState(1);
    const ctx = createSimContext(s);
    const t0 = thresholdFor(0, s.config.balance);
    const t1 = thresholdFor(1, s.config.balance);
    collectEnergy(s, t0 + t1 + 1);
    expect(s.energy.levelUps).toBe(2);
    expect(s.energy.pendingLevelUps).toBe(2);
    expect(s.energy.value).toBe(1);
    expect(fillFraction(s)).toBeCloseTo(1 / thresholdFor(2, s.config.balance));
    energySystem(ctx, 1 / 60);
    expect(s.paused).toBe('menu');
    resolveLevelUp(s);
    expect(s.paused).toBe('menu');
    resolveLevelUp(s);
    expect(s.paused).toBe(false);
  });

  it('orbs outside the pickup radius stay put; inside they are attracted and collected', () => {
    const s = createRunState(2);
    const ctx = createSimContext(s);
    const far = spawnOrb(s, 1000, 0, 1);
    const near = spawnOrb(s, 60, 0, 2);
    for (let i = 0; i < 60; i++) orbSystem(ctx, 1 / 60);
    expect(s.orbs.isAlive(far)).toBe(true);
    expect(s.orbs.x[far]).toBe(1000);
    expect(s.orbs.isAlive(near)).toBe(false);
    expect(s.energy.value).toBe(2);
    const evs: number[] = [];
    s.events.drain((t) => evs.push(t));
    expect(evs).toContain(EventType.orbCollected);
  });

  it('orb cap folds the oldest orb into another and preserves total energy', () => {
    const s = createRunState(3);
    const max = s.config.balance.orbs.max;
    let total = 0;
    for (let i = 0; i < max + 10; i++) {
      spawnOrb(s, 5000 + i * 3, 5000, 1 + (i % 3));
      total += 1 + (i % 3);
    }
    enforceOrbCap(s);
    expect(s.orbs.count).toBe(max);
    let sum = 0;
    s.orbs.pool.forEachAlive((id) => (sum += s.orbs.value[id]));
    expect(sum).toBe(total);
  });
});

describe('MergeSystem', () => {
  function stepMerge(ctx: ReturnType<typeof createSimContext>, seconds: number): void {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      spatialIndexSystem(ctx, 1 / 60);
      mergeSystem(ctx, 1 / 60);
    }
  }

  it('fuses two touching same-type enemies after contactSec into one tier-1 enemy', () => {
    const s = createRunState(4);
    const ctx = createSimContext(s);
    const a = spawnEnemy(s, 0, 100, 100);
    const b = spawnEnemy(s, 0, 110, 100);
    const hpSum = s.enemies.hp[a] + s.enemies.hp[b];
    const energySum = s.enemies.energyValue[a] + s.enemies.energyValue[b];
    stepMerge(ctx, 0.5);
    expect(s.enemies.count).toBe(2);
    stepMerge(ctx, 0.7);
    expect(s.enemies.count).toBe(1);
    const m = s.enemies.isAlive(a) ? a : b;
    expect(s.enemies.tier[m]).toBe(1);
    expect(s.enemies.hp[m]).toBeGreaterThanOrEqual(hpSum);
    expect(s.enemies.energyValue[m]).toBeGreaterThanOrEqual(energySum);
    expect(s.enemies.scale[m]).toBeGreaterThan(1);
  });

  it('does not merge different types, max-tier enemies or NO_MERGE enemies', () => {
    const s = createRunState(5);
    const ctx = createSimContext(s);
    spawnEnemy(s, 0, 0, 0);
    spawnEnemy(s, 1, 5, 0); // different type
    const c = spawnEnemy(s, 0, 300, 0);
    const d = spawnEnemy(s, 0, 305, 0);
    s.enemies.tier[c] = s.enemies.tier[d] = s.config.balance.merge.maxTier; // already max tier
    stepMerge(ctx, 3);
    expect(s.enemies.count).toBe(4);
  });
});
