import { beforeAll, describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../src/data';
import {
  BOSS_MIN_TELEGRAPH_SEC,
  BOSS_STATE,
  bossAttackState,
  bossBehaviour,
  bossFleeing,
  bossId,
  bossSpawnSystem,
  bossTelegraph,
  installBoss,
  summonTypeIndex,
} from '../../src/sim/behaviours/boss';
import { EventType } from '../../src/sim/EventBus';
import { spawnEnemy } from '../../src/sim/entities';
import { createRunState, ENEMY_FLAG, type RunState } from '../../src/sim/RunState';
import { createSimContext, type SimContext } from '../../src/sim/SimContext';
import { clockSystem } from '../../src/sim/systems/ClockSystem';
import { damageSystem } from '../../src/sim/systems/DamageSystem';
import { enemyAISystem } from '../../src/sim/systems/EnemyAISystem';
import { spawnDirector } from '../../src/sim/systems/SpawnDirector';

const DT = 1 / 60;
const BOSS_TYPE = GAME_CONFIG.enemies.findIndex((e) => e.boss);
const BOSS_DEF = GAME_CONFIG.enemies[BOSS_TYPE];
const P = BOSS_DEF.behaviourParams!;
const LEAD = GAME_CONFIG.balance.run.bossLeadSec;

function events(state: RunState): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  state.events.drain((t, a, b) => out.push([t, a, b]));
  return out;
}

function countBosses(state: RunState): number {
  const e = state.enemies;
  let n = 0;
  for (let k = 0; k < e.count; k++) if (e.flags[e.pool.activeIds[k]] & ENEMY_FLAG.BOSS) n++;
  return n;
}

/** Context with a boss placed `dist` px right of the player, ready to attack. */
function bossSetup(seed: number, dist = 300): { state: RunState; ctx: SimContext; id: number } {
  const state = createRunState(seed);
  const ctx = createSimContext(state);
  state.clock.bossSpawned = true;
  const id = spawnEnemy(state, BOSS_TYPE, dist, 0);
  bossAttackState(ctx, id).cooldown = 0;
  return { state, ctx, id };
}

/** Steps the boss behaviour (no integration) until aiState leaves `from`; returns seconds spent. */
function stepWhile(ctx: SimContext, id: number, from: number, maxSec = 10): number {
  let t = 0;
  while (ctx.state.enemies.aiState[id] === from && t < maxSec) {
    bossBehaviour(ctx, id, DT);
    t += DT;
  }
  return t;
}

beforeAll(() => {
  installBoss();
  installBoss(); // idempotent
});

describe('Boss spawn (Req 24.1)', () => {
  it('spawns exactly once at duration − bossLeadSec, above the view, emitting bossSpawn', () => {
    const state = createRunState(11);
    const ctx = createSimContext(state);
    const at = state.clock.duration - LEAD;
    state.clock.elapsed = at - 1;
    let spawnedAt = -1;
    while (state.clock.elapsed < at + 30) {
      bossSpawnSystem(ctx, DT);
      if (spawnedAt < 0 && state.clock.bossSpawned) spawnedAt = state.clock.elapsed;
      state.clock.elapsed += DT;
    }
    expect(spawnedAt).toBeGreaterThanOrEqual(at);
    expect(spawnedAt).toBeLessThan(at + DT * 1.5);
    expect(countBosses(state)).toBe(1);
    const id = bossId(state);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(state.enemies.typeId[id]).toBe(BOSS_TYPE);
    expect(state.enemies.y[id]).toBeLessThan(state.player.y - ctx.view.height / 2);
    const spawns = events(state).filter(([t]) => t === EventType.bossSpawn);
    expect(spawns).toEqual([[EventType.bossSpawn, id, 0]]);

    // Killed boss never comes back.
    state.enemies.free(id);
    for (let i = 0; i < 120; i++) bossSpawnSystem(ctx, DT);
    expect(countBosses(state)).toBe(0);
  });

  it('frees the farthest non-boss enemy when the store is full', () => {
    const state = createRunState(12);
    const ctx = createSimContext(state);
    const e = state.enemies;
    let far = -1;
    for (let i = 0; e.count < e.capacity; i++) {
      const id = spawnEnemy(state, 0, 100 + i, 0);
      far = id;
    }
    e.x[far] = 5000;
    state.clock.elapsed = state.clock.duration - LEAD;
    bossSpawnSystem(ctx, DT);
    expect(bossId(state)).toBeGreaterThanOrEqual(0);
    expect(e.count).toBe(e.capacity);
    expect(e.isAlive(far) && e.x[far] === 5000).toBe(false);
  });
});

describe('Boss attacks (Req 24.3)', () => {
  it('slam telegraph lasts ≥ 0.5 s, locks the centre, damages only inside slamRadius', () => {
    // Inside: player stays at the locked centre.
    {
      const { state, ctx, id } = bossSetup(21);
      bossBehaviour(ctx, id, DT);
      const e = state.enemies;
      expect(e.aiState[id]).toBe(BOSS_STATE.slam);
      expect(e.aiDirX[id]).toBe(state.player.x);
      expect(e.aiDirY[id]).toBe(state.player.y);
      const tg = bossTelegraph(state, id);
      expect(tg.kind).toBe('slam');
      expect(tg.radius).toBe(P.slamRadius);
      const hp = state.player.hp;
      const t = stepWhile(ctx, id, BOSS_STATE.slam);
      expect(t).toBeGreaterThanOrEqual(BOSS_MIN_TELEGRAPH_SEC);
      expect(t).toBeGreaterThanOrEqual(P.slamTelegraphSec - 1e-3);
      expect(state.player.hp).toBeCloseTo(hp - P.slamDmg, 4);
      expect(e.aiState[id]).toBe(BOSS_STATE.recover);
    }
    // Outside: the player moves out of the locked radius during the telegraph.
    {
      const { state, ctx, id } = bossSetup(22);
      bossBehaviour(ctx, id, DT);
      state.player.x = -(P.slamRadius + 5);
      const hp = state.player.hp;
      stepWhile(ctx, id, BOSS_STATE.slam);
      expect(state.player.hp).toBe(hp);
    }
  });

  it('alternates slam → summon; summon telegraph ≥ 0.5 s and spawns summonCount enemies', () => {
    const { state, ctx, id } = bossSetup(23);
    const e = state.enemies;
    bossBehaviour(ctx, id, DT);
    expect(e.aiState[id]).toBe(BOSS_STATE.slam);
    stepWhile(ctx, id, BOSS_STATE.slam);
    stepWhile(ctx, id, BOSS_STATE.recover);
    expect(e.aiState[id]).toBe(BOSS_STATE.approach);
    // Wait out the cooldown.
    stepWhile(ctx, id, BOSS_STATE.approach);
    expect(e.aiState[id]).toBe(BOSS_STATE.summon);
    expect(bossTelegraph(state, id).kind).toBe('summon');
    const before = e.count;
    const t = stepWhile(ctx, id, BOSS_STATE.summon);
    expect(t).toBeGreaterThanOrEqual(BOSS_MIN_TELEGRAPH_SEC);
    expect(t).toBeGreaterThanOrEqual(P.summonTelegraphSec - 1e-3);
    expect(e.count - before).toBe(P.summonCount);
    const summon = summonTypeIndex(state);
    expect(GAME_CONFIG.enemies[summon].id).toBe('imp');
    let imps = 0;
    for (let k = 0; k < e.count; k++) {
      const s = e.pool.activeIds[k];
      if (s === id) continue;
      expect(e.typeId[s]).toBe(summon);
      expect(Math.hypot(e.x[s] - e.x[id], e.y[s] - e.y[id])).toBeCloseTo(80, 3);
      imps++;
    }
    expect(imps).toBe(P.summonCount);
  });

  it('summons (not slams) from mid range, so kiting players still get pressure', () => {
    const { state, ctx, id } = bossSetup(25, 700); // beyond slam range, within summon range
    bossBehaviour(ctx, id, DT);
    expect(state.enemies.aiState[id]).toBe(BOSS_STATE.summon);
  });

  it('blinks back toward a player who has left it far behind', () => {
    const { state, ctx, id } = bossSetup(26, 3000);
    bossBehaviour(ctx, id, DT);
    const e = state.enemies;
    expect(Math.hypot(e.x[id] - state.player.x, e.y[id] - state.player.y)).toBeCloseTo(800, 0);
  });

  it('stands still while telegraphing and approaches when far', () => {
    const { state, ctx, id } = bossSetup(24, 1000); // beyond summon range, below blink distance
    const e = state.enemies;
    bossBehaviour(ctx, id, DT);
    expect(e.aiState[id]).toBe(BOSS_STATE.approach); // out of attack range
    expect(e.vx[id]).toBeLessThan(0);
    e.x[id] = 300;
    bossBehaviour(ctx, id, DT);
    expect(e.aiState[id]).toBe(BOSS_STATE.slam);
    bossBehaviour(ctx, id, DT);
    expect(e.vx[id]).toBe(0);
    expect(e.vy[id]).toBe(0);
  });
});

describe('Boss kill and dawn (Req 24.4, 24.5)', () => {
  it('killing the boss emits bossKilled, drops a token and ≥ 10 extra orbs', () => {
    const { state, ctx, id } = bossSetup(31);
    const x = state.enemies.x[id];
    const y = state.enemies.y[id];
    state.events.clear();
    ctx.damage.push(id, 1e7);
    damageSystem(ctx, DT);
    expect(state.enemies.isAlive(id)).toBe(false);
    expect(state.tokens.count).toBe(1);
    const t = state.tokens.pool.activeIds[0];
    expect(state.tokens.x[t]).toBeCloseTo(x);
    expect(state.tokens.y[t]).toBeCloseTo(y);
    expect(state.orbs.count).toBeGreaterThanOrEqual(11); // normal orb + 10 bonus
    let total = 0;
    for (let k = 0; k < state.orbs.count; k++) total += state.orbs.value[state.orbs.pool.activeIds[k]];
    expect(total - BOSS_DEF.energy).toBeGreaterThanOrEqual(20);
    const killed = events(state).filter(([type]) => type === EventType.bossKilled);
    expect(killed.length).toBe(1);
    expect(killed[0][1]).toBeCloseTo(x);
    expect(killed[0][2]).toBeCloseTo(y);
    expect(bossId(state)).toBe(-1);
  });

  it('dawn with the boss alive is a victory and the boss flees', () => {
    const { state, ctx, id } = bossSetup(32);
    expect(bossFleeing(state)).toBe(false);
    state.clock.elapsed = state.clock.duration - DT / 2;
    clockSystem(ctx, DT);
    bossSpawnSystem(ctx, DT);
    expect(state.outcome).toBe('victory');
    expect(state.enemies.isAlive(id)).toBe(true);
    expect(bossFleeing(state)).toBe(true);
    expect(state.enemies.aiState[id]).toBe(BOSS_STATE.fleeing);
    expect(bossTelegraph(state, id).kind).toBe('none');
  });

  it('the spawn director never despawns the boss for distance', () => {
    const { state, ctx, id } = bossSetup(33, 50_000);
    const plain = spawnEnemy(state, 0, -50_000, 0);
    state.clock.elapsed = 200;
    spawnDirector(ctx, DT);
    expect(state.enemies.isAlive(id)).toBe(true);
    // The far non-boss is culled (its slot may be reused by a fresh spawn near the player).
    expect(state.enemies.isAlive(plain) && state.enemies.x[plain] === -50_000).toBe(false);
    enemyAISystem(ctx, DT); // registered boss behaviour runs without error
    expect(state.enemies.isAlive(id)).toBe(true);
  });
});
