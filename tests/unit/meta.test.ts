import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/data';
import {
  META_STORAGE_KEY,
  MetaProgression,
  UNLOCK_CATALOGUE,
  defaultMetaState,
  deserializeMetaState,
  nextCostFor,
  rewardFor,
  serializeMetaState,
  startingPartIdsFor,
  statMultipliersFor,
  validateMetaState,
} from '../../src/meta/MetaProgression';
import { FakePlatform } from '../../src/platform/FakePlatform';
import { Sim } from '../../src/sim/Sim';

/** Task 20.3: meta progression unit tests (Req 26.1, 26.4, 26.7). */
describe('rewardFor', () => {
  it('matches floor(survival/10 + kills/25), with a 1.5x victory multiplier', () => {
    expect(rewardFor(0, 0, false)).toBe(0);
    expect(rewardFor(120, 100, false)).toBe(16);
    expect(rewardFor(61, 24, false)).toBe(7);
    expect(rewardFor(540, 800, true)).toBe(129);
    expect(rewardFor(540, 800, false)).toBe(86);
  });

  it('sanitizes negative and non-finite inputs to zero', () => {
    expect(rewardFor(-50, -10, false)).toBe(0);
    expect(rewardFor(NaN, Infinity, true)).toBe(0);
  });
});

describe('meta state validation and serialization', () => {
  it('round-trips a valid state through serialize/deserialize', () => {
    const s = defaultMetaState();
    s.currency = 77;
    s.unlocks = ['start_fangs'];
    s.statBonuses = { damage: 2, moveSpeed: 1 };
    expect(deserializeMetaState(serializeMetaState(s))).toEqual(s);
    expect(validateMetaState(s)).toEqual(s);
  });

  it('rejects invalid states', () => {
    expect(validateMetaState(null)).toBeNull();
    expect(validateMetaState({ ...defaultMetaState(), version: 99 })).toBeNull();
    expect(validateMetaState({ ...defaultMetaState(), currency: -1 })).toBeNull();
    expect(validateMetaState({ ...defaultMetaState(), currency: 1.5 })).toBeNull();
    expect(validateMetaState({ ...defaultMetaState(), unlocks: ['not_a_real_unlock'] })).toBeNull();
    expect(validateMetaState({ ...defaultMetaState(), unlocks: ['start_fangs', 'start_fangs'] })).toBeNull();
    expect(validateMetaState({ ...defaultMetaState(), statBonuses: { damage: 6 } })).toBeNull();
    expect(validateMetaState({ ...defaultMetaState(), equipped: 'ghost_skin' })).toBeNull();
    expect(deserializeMetaState('{not json')).toBeNull();
  });

  it('every catalogue entry is a starting part or a stat track (Req 26.5 scope)', () => {
    for (const def of UNLOCK_CATALOGUE) {
      expect(['startingPart', 'stat']).toContain(def.kind);
    }
    const ids = UNLOCK_CATALOGUE.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('MetaProgression persistence', () => {
  it('loads saved state and saves awards through the platform', async () => {
    const platform = new FakePlatform();
    const meta = new MetaProgression(platform);
    await expect(meta.load()).resolves.toBe('absent');
    expect(meta.awardRun(120, 100, false)).toBe(16);
    await expect(meta.flush()).resolves.toBe(true);
    await expect(platform.load(META_STORAGE_KEY)).resolves.toMatchObject({ currency: 16 });

    const reloaded = new MetaProgression(platform);
    await expect(reloaded.load()).resolves.toBe('loaded');
    expect(reloaded.state.currency).toBe(16);
  });

  it('a failed save keeps state in memory and retries at the next run end', async () => {
    const platform = new FakePlatform();
    const meta = new MetaProgression(platform);
    await meta.load();
    platform.failNext('save');
    expect(meta.awardRun(120, 100, false)).toBe(16);
    await expect(meta.flush()).resolves.toBe(false);
    await expect(platform.load(META_STORAGE_KEY)).resolves.toBeNull();
    expect(meta.state.currency).toBe(16);

    expect(meta.awardRun(120, 100, false)).toBe(16);
    await expect(meta.flush()).resolves.toBe(true);
    await expect(platform.load(META_STORAGE_KEY)).resolves.toMatchObject({ currency: 32 });
  });

  it('invalid stored data falls back to defaults and is left untouched in storage', async () => {
    const platform = new FakePlatform();
    await platform.save(META_STORAGE_KEY, { version: 99, currency: 'lots' });
    const meta = new MetaProgression(platform);
    await expect(meta.load()).resolves.toBe('invalid');
    expect(meta.state).toEqual(defaultMetaState());
    expect(meta.saveBlocked).toBe(true);

    meta.awardRun(540, 800, true);
    await expect(meta.flush()).resolves.toBe(false);
    await expect(platform.load(META_STORAGE_KEY)).resolves.toEqual({ version: 99, currency: 'lots' });
  });

  it('malformed stored JSON is treated as invalid, a transport error is not blocked', async () => {
    const corrupt = {
      load: async () => {
        throw new SyntaxError('Unexpected token');
      },
      save: async () => {},
    };
    const blocked = new MetaProgression(corrupt);
    await expect(blocked.load()).resolves.toBe('invalid');
    expect(blocked.saveBlocked).toBe(true);

    const offline = {
      load: async () => {
        throw new Error('RATE_LIMITED');
      },
      save: async () => {},
    };
    const retryable = new MetaProgression(offline);
    await expect(retryable.load()).resolves.toBe('error');
    expect(retryable.saveBlocked).toBe(false);
  });
});

describe('unlock purchases and run bonuses', () => {
  it('buys stat levels and starting parts, respecting cost, funds and caps', () => {
    const meta = new MetaProgression(new FakePlatform());
    meta.state.currency = 200;
    const statDef = UNLOCK_CATALOGUE.find((d) => d.id === 'stat_damage')!;
    expect(nextCostFor(meta.state, statDef)).toBe(15);
    expect(meta.buyUnlock('stat_damage')).toBe(true);
    expect(meta.state.currency).toBe(185);
    expect(statMultipliersFor(meta.state).damage).toBeCloseTo(1.04);

    expect(meta.buyUnlock('start_fangs')).toBe(true);
    expect(meta.state.currency).toBe(65);
    expect(startingPartIdsFor(meta.state)).toEqual(['fangs']);
    expect(meta.buyUnlock('start_fangs')).toBe(false); // already owned
    expect(meta.buyUnlock('nope')).toBe(false);
    expect(meta.buyUnlock('start_tentacle')).toBe(false); // 65 < 120

    meta.state.statBonuses.damage = 5;
    expect(nextCostFor(meta.state, statDef)).toBeNull();
    expect(meta.buyUnlock('stat_damage')).toBe(false);
  });

  it('Sim applies starting parts and stat multipliers, clamped to balance caps', () => {
    const sim = new Sim({
      seed: 1,
      bonuses: {
        startingPartIds: ['fangs', 'extra_eye', 'blob_spit', 'unknown_part'],
        statMultipliers: { damage: 99, moveSpeed: 1.08 },
      },
    });
    const snap = sim.snapshot();
    expect(snap.build.map(([id]) => id).sort()).toEqual(['blob_spit', 'extra_eye', 'fangs']);
    expect(sim.state.player.stats.damage).toBe(BALANCE.caps.damage);
    expect(sim.state.player.stats.moveSpeed).toBeCloseTo(1.08);

    sim.setBonuses({});
    sim.restart(2);
    expect(sim.snapshot().build).toEqual([['blob_spit', 1]]);
    expect(sim.state.player.stats.damage).toBe(1);
  });
});
