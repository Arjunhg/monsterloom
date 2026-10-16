import { describe, expect, it } from 'vitest';
import { BALANCE, GAME_CONFIG, eliteChance, validateConfig } from '../../src/data';
import { createRunState } from '../../src/sim/RunState';
import { ENEMY_FLAG } from '../../src/sim/RunState';
import { spawnEnemy } from '../../src/sim/entities';

describe('v2 config', () => {
  it('passes v1 and v2 validation', () => {
    expect(validateConfig(GAME_CONFIG)).toEqual([]);
    expect(validateConfig(GAME_CONFIG, { v2: true })).toEqual([]);
  });

  it('introduces a new stage at least every 120 s, all before the boss', () => {
    const s = GAME_CONFIG.stages;
    for (let i = 1; i < s.length; i++) expect(s[i].atSec - s[i - 1].atSec).toBeLessThanOrEqual(120);
    const bossAt = BALANCE.run.durationSec - BALANCE.run.bossLeadSec;
    expect(Math.max(...s.map((x) => x.atSec))).toBeLessThan(bossAt);
  });

  it('has >= 4 mutation recipes referencing existing parts and >= 2 swarm events of both kinds', () => {
    expect(GAME_CONFIG.mutations.length).toBeGreaterThanOrEqual(4);
    const parts = new Set(GAME_CONFIG.bodyParts.map((p) => p.id));
    for (const m of GAME_CONFIG.mutations) for (const r of m.requires) expect(parts.has(r.partId)).toBe(true);
    const kinds = new Set((GAME_CONFIG.swarmEvents ?? []).map((e) => e.kind));
    expect(kinds).toEqual(new Set(['ring', 'stampede']));
  });

  it('flags ghosts NO_SEP|NO_MERGE and the boss BOSS|NO_MERGE on spawn', () => {
    const state = createRunState(1);
    const idx = (id: string) => GAME_CONFIG.enemies.findIndex((e) => e.id === id);
    const ghost = spawnEnemy(state, idx('ghost'), 0, 0);
    const boss = spawnEnemy(state, idx('boss'), 0, 0);
    const f = state.enemies.flags;
    expect(f[ghost] & ENEMY_FLAG.NO_SEP).toBeTruthy();
    expect(f[ghost] & ENEMY_FLAG.NO_MERGE).toBeTruthy();
    expect(f[boss] & ENEMY_FLAG.BOSS).toBeTruthy();
    expect(f[boss] & ENEMY_FLAG.NO_MERGE).toBeTruthy();
  });

  it('rejects a v2 config with a boss in a stage or a ghost that can merge', () => {
    const bad = {
      ...GAME_CONFIG,
      stages: [...GAME_CONFIG.stages.slice(0, -1), { atSec: 390, addTypes: ['witch', 'boss'] }],
      enemies: GAME_CONFIG.enemies.map((e) => (e.id === 'ghost' ? { ...e, canMerge: true } : e)),
    };
    const errors = validateConfig(bad, { v2: true });
    expect(errors.some((e) => e.includes("boss 'boss' must not be in a spawn stage"))).toBe(true);
    expect(errors.some((e) => e.includes("ghost 'ghost'"))).toBe(true);
  });

  it('elite chance is 0 before startSec, non-decreasing, and capped at maxChance', () => {
    expect(eliteChance(0)).toBe(0);
    expect(eliteChance(BALANCE.elite.startSec)).toBe(0);
    let prev = 0;
    for (let t = 0; t <= 700; t += 5) {
      const c = eliteChance(t);
      expect(c).toBeGreaterThanOrEqual(prev);
      expect(c).toBeLessThanOrEqual(BALANCE.elite.maxChance);
      prev = c;
    }
    expect(eliteChance(BALANCE.run.durationSec)).toBeCloseTo(BALANCE.elite.maxChance);
  });
});
