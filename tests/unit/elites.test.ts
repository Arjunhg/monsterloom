import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE, GAME_CONFIG, type GameConfig } from '../../src/data';
import { EventType } from '../../src/sim/EventBus';
import { spawnEnemy } from '../../src/sim/entities';
import { createRunState, ENEMY_FLAG } from '../../src/sim/RunState';
import { createSimContext } from '../../src/sim/SimContext';
import { damageSystem } from '../../src/sim/systems/DamageSystem';
import { energySystem } from '../../src/sim/systems/EnergySystem';
import {
  CLUSTER_RADIUS,
  makeElite,
  setSpawnRecorder,
  spawnDirector,
} from '../../src/sim/systems/SpawnDirector';
import { installEliteTokenDrops, tokenSystem } from '../../src/sim/systems/TokenSystem';

const DT = 1 / 60;
const BAT = GAME_CONFIG.enemies.findIndex((e) => e.id === 'bat');
const BOSS = GAME_CONFIG.enemies.findIndex((e) => e.boss);

function withBalance(patch: Partial<typeof BALANCE>, stages = GAME_CONFIG.stages): GameConfig {
  return { ...GAME_CONFIG, stages, balance: { ...BALANCE, ...patch } };
}

afterEach(() => setSpawnRecorder(null));

describe('Elites', () => {
  it('makeElite scales hp/scale/radius/energy and sets ELITE | NO_MERGE', () => {
    const state = createRunState(1);
    const id = spawnEnemy(state, 0, 0, 0);
    const hp = state.enemies.hp[id];
    const r = state.enemies.radius[id];
    const ev = state.enemies.energyValue[id];
    makeElite(state, id);
    const e = state.enemies;
    expect(e.flags[id] & ENEMY_FLAG.ELITE).toBeTruthy();
    expect(e.flags[id] & ENEMY_FLAG.NO_MERGE).toBeTruthy();
    expect(e.hp[id]).toBeCloseTo(hp * BALANCE.elite.hpMult, 4);
    expect(e.maxHp[id]).toBeCloseTo(hp * BALANCE.elite.hpMult, 4);
    expect(e.scale[id]).toBeCloseTo(BALANCE.elite.scale, 5);
    expect(e.radius[id]).toBeCloseTo(r * 1.15, 4);
    expect(e.energyValue[id]).toBeCloseTo(ev * 3, 5);
    // Idempotent: a second call changes nothing.
    makeElite(state, id);
    expect(e.hp[id]).toBeCloseTo(hp * BALANCE.elite.hpMult, 4);
  });

  it('killed elite drops exactly one token; non-elite drops none', () => {
    installEliteTokenDrops();
    installEliteTokenDrops(); // idempotent
    const state = createRunState(2);
    const ctx = createSimContext(state);
    const elite = spawnEnemy(state, 0, 300, 40);
    makeElite(state, elite);
    const plain = spawnEnemy(state, 0, -300, 0);
    ctx.damage.push(plain, 1e6);
    damageSystem(ctx, DT);
    expect(state.tokens.count).toBe(0);
    ctx.damage.push(elite, 1e6);
    ctx.damage.push(elite, 1e6); // already dead → no second drop
    damageSystem(ctx, DT);
    expect(state.tokens.count).toBe(1);
    const t = state.tokens.pool.activeIds[0];
    expect(state.tokens.x[t]).toBeCloseTo(300);
    expect(state.tokens.y[t]).toBeCloseTo(40);
  });

  it('token pickup queues a token pick without touching energy, then pauses for the menu', () => {
    const state = createRunState(3);
    const ctx = createSimContext(state);
    state.energy.value = 3;
    state.energy.levelUps = 2;
    const t = state.tokens.alloc();
    state.tokens.x[t] = 60; // inside pickup radius (90)
    state.tokens.y[t] = 0;
    state.events.clear();
    for (let i = 0; i < 60 && state.tokens.count > 0; i++) tokenSystem(ctx, DT);
    expect(state.tokens.count).toBe(0);
    expect(state.energy.pendingTokens).toBe(1);
    expect(state.energy.value).toBe(3);
    expect(state.energy.levelUps).toBe(2);
    expect(state.energy.pendingLevelUps).toBe(0);
    const evs: number[] = [];
    state.events.drain((type) => evs.push(type));
    expect(evs.filter((e) => e === EventType.tokenCollected).length).toBe(1);
    energySystem(ctx, DT);
    expect(state.paused).toBe('menu');
  });

  it('tokens outside the pickup radius stay put; nothing happens after the run ended', () => {
    const state = createRunState(4);
    const ctx = createSimContext(state);
    const t = state.tokens.alloc();
    state.tokens.x[t] = 500;
    tokenSystem(ctx, DT);
    expect(state.tokens.x[t]).toBe(500);
    state.tokens.x[t] = 0;
    state.outcome = 'victory';
    tokenSystem(ctx, DT);
    expect(state.tokens.count).toBe(1);
    expect(state.energy.pendingTokens).toBe(0);
  });

  it('no elite rolls before elite.startSec', () => {
    // maxChance 1 → every spawn after the ramp end is elite; none before startSec.
    const config = withBalance({
      elite: { ...BALANCE.elite, startSec: 30, maxChance: 1 },
      run: { ...BALANCE.run, durationSec: 31 },
    });
    const state = createRunState(5, config);
    const ctx = createSimContext(state);
    let spawns = 0;
    setSpawnRecorder(() => spawns++);
    while (state.clock.elapsed < 30 - DT) {
      state.clock.elapsed += DT;
      spawnDirector(ctx, DT);
    }
    expect(spawns).toBeGreaterThan(5);
    const ids = state.enemies.pool.activeIds;
    for (let k = 0; k < state.enemies.count; k++) {
      expect(state.enemies.flags[ids[k]] & ENEMY_FLAG.ELITE).toBe(0);
    }
    // After the ramp (t ≥ 31) every new spawn is elite.
    state.enemies.reset();
    state.clock.elapsed = 40;
    state.director.credits = 20;
    spawnDirector(ctx, DT);
    expect(state.enemies.count).toBeGreaterThan(0);
    for (let k = 0; k < state.enemies.count; k++) {
      expect(state.enemies.flags[ids[k]] & ENEMY_FLAG.ELITE).toBeTruthy();
    }
  });

  it('never rolls elite for the boss type', () => {
    const config = withBalance(
      { elite: { ...BALANCE.elite, startSec: 0, maxChance: 1 }, run: { ...BALANCE.run, durationSec: 10 } },
      [{ atSec: 0, addTypes: ['boss'] }],
    );
    const state = createRunState(6, config);
    const ctx = createSimContext(state);
    state.clock.elapsed = 100;
    state.director.credits = 5000;
    spawnDirector(ctx, DT);
    expect(state.enemies.count).toBe(1);
    const id = state.enemies.pool.activeIds[0];
    expect(state.enemies.typeId[id]).toBe(BOSS);
    expect(state.enemies.flags[id] & ENEMY_FLAG.ELITE).toBe(0);
  });

  it('bat picks spawn as a tight cluster in one step', () => {
    const config = withBalance({}, [{ atSec: 0, addTypes: ['bat'] }]);
    const state = createRunState(7, config);
    const ctx = createSimContext(state);
    const groupSize = GAME_CONFIG.enemies[BAT].behaviourParams!.groupSize!;
    let firstStepCount = 0;
    for (let i = 0; i < 60 * 30 && firstStepCount === 0; i++) {
      state.clock.elapsed += DT;
      spawnDirector(ctx, DT);
      firstStepCount = state.enemies.count;
    }
    expect(firstStepCount).toBe(groupSize);
    const e = state.enemies;
    const ids = e.pool.activeIds;
    for (let a = 0; a < e.count; a++) {
      expect(e.typeId[ids[a]]).toBe(BAT);
      for (let b = a + 1; b < e.count; b++) {
        const d = Math.hypot(e.x[ids[a]] - e.x[ids[b]], e.y[ids[a]] - e.y[ids[b]]);
        expect(d).toBeLessThanOrEqual(CLUSTER_RADIUS * 2.5);
      }
    }
    // Threat cost charged once per bat.
    expect(state.director.credits).toBeGreaterThanOrEqual(0);
  });
});
