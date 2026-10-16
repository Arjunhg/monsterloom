import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE, GAME_CONFIG, type GameConfig } from '../../src/data';
import { createRunState } from '../../src/sim/RunState';
import { createSimContext } from '../../src/sim/SimContext';
import { setSpawnRecorder, spawnDirector } from '../../src/sim/systems/SpawnDirector';

const DT = 1 / 60;
// v1 content: same horde, no special (v2) monsters.
const V1: GameConfig = {
  ...GAME_CONFIG,
  stages: [
    { atSec: 0, addTypes: ['shambler', 'imp'] },
    { atSec: 120, addTypes: ['skull_knight'] },
  ],
};

/** Spawns per enemy type id over [0, seconds), with enemies cleared every step so the cap never binds. */
function spawnCounts(config: GameConfig, seconds: number, seed: number): Map<string, number> {
  const state = createRunState(seed, config);
  const ctx = createSimContext(state);
  const counts = new Map<string, number>();
  setSpawnRecorder((_t, _c, _x, _y, _q, type) => {
    const id = config.enemies[type].id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  });
  for (let i = 0; i < seconds * 60; i++) {
    state.clock.elapsed = i * DT;
    spawnDirector(ctx, DT);
    state.enemies.reset();
  }
  return counts;
}

const HORDE = ['shambler', 'imp', 'skull_knight'];
const sum = (m: Map<string, number>, ids: string[]) => ids.reduce((a, id) => a + (m.get(id) ?? 0), 0);

describe('spawn lanes', () => {
  afterEach(() => setSpawnRecorder(null));

  it('v2 monsters do not thin out the regular horde', () => {
    for (const seed of [1, 2, 3]) {
      const v1 = spawnCounts(V1, 480, seed);
      const v2 = spawnCounts(GAME_CONFIG, 480, seed);
      // Horde-lane credits are independent of the special lane, so horde spawns match v1 (±5% for RNG).
      expect(sum(v2, HORDE)).toBeGreaterThanOrEqual(sum(v1, HORDE) * 0.95);
      // And the special monsters arrive on top.
      expect(sum(v2, ['bat', 'slime', 'ghost', 'witch'])).toBeGreaterThan(40);
    }
  });

  it('each lane respects its own carry cap', () => {
    const state = createRunState(7, GAME_CONFIG);
    const ctx = createSimContext(state);
    const special = GAME_CONFIG.enemies.filter((e) => e.special).map((e) => e.threatCost);
    const horde = GAME_CONFIG.enemies.filter((e) => !e.special && !e.boss).map((e) => e.threatCost);
    for (let i = 0; i < 400 * 60; i++) {
      state.clock.elapsed = i * DT;
      spawnDirector(ctx, DT);
      expect(state.director.credits).toBeLessThanOrEqual(BALANCE.credits.maxCarry + Math.max(...horde) + 1e-6);
      expect(state.director.specialCredits).toBeLessThanOrEqual(BALANCE.credits.maxCarry + Math.max(...special) + 1e-6);
    }
  });
});
