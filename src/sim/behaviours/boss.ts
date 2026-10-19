/**
 * The dawn boss "The Night Mother" (design "Enemy behaviours"; Req 24.1–24.5).
 *
 * - bossSpawnSystem: once per run, when elapsed ≥ duration − bossLeadSec (and no
 *   outcome yet), spawns the config's single `boss: true` enemy just outside the
 *   view above the player, sets clock.bossSpawned and emits bossSpawn(id). If the
 *   enemy store is full, the farthest non-boss enemy is freed first (no kill/orb).
 *   At dawn (outcome 'victory') with the boss alive it is put into aiState 4.
 * - bossBehaviour (aiState contract, read by renderers):
 *     0 approach  — chase until within BOSS_HOLD_DIST of the player;
 *     1 slam      — stand still; aiTimer = seconds left; aiDirX/aiDirY = locked slam centre;
 *     2 summon    — stand still; aiTimer = seconds left;
 *     3 recover   — stand still for BOSS_RECOVER_SEC;
 *     4 fleeing   — dawn arrived; renderer flies it off-screen upward.
 *   The attack cooldown ticks during approach; at ≤ 0 within BOSS_ATTACK_RANGE the
 *   boss alternates slam / summon (slam first). Telegraphs last ≥ 0.5 s (Req 24.3).
 *   Slam: damagePlayer(slamDmg) if the player is within slamRadius of the locked
 *   centre. Summon: summonCount imps (or the first non-boss type) in a ring of
 *   BOSS_SUMMON_RING px around the boss.
 * - bossKillHook: emits bossKilled(x, y), drops one Upgrade_Token and
 *   BOSS_BONUS_ORBS extra orbs around the boss (on top of the normal orb, Req 24.4).
 */
import type { EnemyType } from '../../data/enemies';
import { BEHAVIOUR_CODE, damagePlayer, spawnEnemy, spawnOrb } from '../entities';
import { EventType } from '../EventBus';
import { ENEMY_FLAG, type RunState } from '../RunState';
import type { SimContext, System } from '../SimContext';
import { onEnemyKilled, type EnemyKilledHook } from '../systems/DamageSystem';
import { registerBehaviour, type BehaviourFn } from '../systems/EnemyAISystem';

export const BOSS_STATE = { approach: 0, slam: 1, summon: 2, recover: 3, fleeing: 4 } as const;

/** The boss stops approaching inside this distance (px). */
export const BOSS_HOLD_DIST = 260;
/** Attacks start only when the player is within this distance (px). */
export const BOSS_ATTACK_RANGE = 420;
export const BOSS_RECOVER_SEC = 0.6;
export const BOSS_MIN_TELEGRAPH_SEC = 0.5;
export const BOSS_SUMMON_RING = 80;
/** Spawn offset above the top edge of the view (px). */
export const BOSS_SPAWN_MARGIN = 120;
export const BOSS_BONUS_ORBS = 10;
/** Beyond this distance the boss moves at speed × BOSS_CATCHUP_MULT. */
export const BOSS_CATCHUP_DIST = 600;
export const BOSS_CATCHUP_MULT = 3;
/** Beyond this distance the boss blinks to BOSS_BLINK_TO px from the player, along the same line. */
export const BOSS_BLINK_DIST = 1100;
export const BOSS_BLINK_TO = 800;
/** Summons (unlike slams) can be cast from this far away. */
export const BOSS_SUMMON_RANGE = 900;
/** Minimum value per bonus orb (10 × 2 = 20 total at least). */
export const BOSS_BONUS_ORB_MIN = 2;

const DEFAULTS: Record<string, number> = {
  slamTelegraphSec: 0.8,
  slamRadius: 190,
  slamDmg: 28,
  summonTelegraphSec: 0.6,
  summonCount: 8,
  attackCooldown: 3.2,
};

/** Per-ctx attack bookkeeping. `next`: 0 = slam, 1 = summon. */
export interface BossAttackState {
  cooldown: number;
  next: 0 | 1;
}

const attackStates = new WeakMap<SimContext, BossAttackState>();

function bossType(state: RunState, id: number): EnemyType | undefined {
  return state.config.enemies[state.enemies.typeId[id]];
}

/** behaviourParams[key] of the enemy's type, or the boss default. */
export function bossParam(state: RunState, id: number, key: string): number {
  const v = bossType(state, id)?.behaviourParams?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (DEFAULTS[key] ?? 0);
}

function slamTelegraphSec(state: RunState, id: number): number {
  return Math.max(BOSS_MIN_TELEGRAPH_SEC, bossParam(state, id, 'slamTelegraphSec'));
}

function summonTelegraphSec(state: RunState, id: number): number {
  return Math.max(BOSS_MIN_TELEGRAPH_SEC, bossParam(state, id, 'summonTelegraphSec'));
}

/** Attack bookkeeping for `ctx` (created on first use with a full cooldown). */
export function bossAttackState(ctx: SimContext, id: number): BossAttackState {
  let s = attackStates.get(ctx);
  if (!s) {
    s = { cooldown: bossParam(ctx.state, id, 'attackCooldown'), next: 0 };
    attackStates.set(ctx, s);
  }
  return s;
}

function resetAttackState(ctx: SimContext, id: number): void {
  attackStates.set(ctx, { cooldown: bossParam(ctx.state, id, 'attackCooldown'), next: 0 });
}

/** Index of the boss enemy type in config.enemies (−1 if none). */
export function bossTypeIndex(state: RunState): number {
  return state.config.enemies.findIndex((e) => e.boss === true);
}

/** Enemy type spawned by the summon: 'imp' if present, else the first non-boss type (−1 if none). */
export function summonTypeIndex(state: RunState): number {
  const enemies = state.config.enemies;
  const imp = enemies.findIndex((e) => e.id === 'imp' && !e.boss);
  if (imp >= 0) return imp;
  return enemies.findIndex((e) => !e.boss);
}

/** Id of the alive boss, or −1. */
export function bossId(state: RunState): number {
  if (!state.clock.bossSpawned) return -1;
  const e = state.enemies;
  const ids = e.pool.activeIds;
  for (let k = 0; k < e.count; k++) {
    const id = ids[k];
    if (e.flags[id] & ENEMY_FLAG.BOSS) return id;
  }
  return -1;
}

/** True when dawn arrived (victory) with the boss still alive (Req 24.5). */
export function bossFleeing(state: RunState): boolean {
  return state.outcome === 'victory' && bossId(state) >= 0;
}

export type BossTelegraphKind = 'none' | 'slam' | 'summon';

export interface BossTelegraph {
  kind: BossTelegraphKind;
  /** Charge progress 0 (start) → 1 (about to resolve). */
  t01: number;
  /** Telegraph centre (slam: locked centre; summon: boss position). */
  x: number;
  y: number;
  /** Slam radius, or the summon ring radius. */
  radius: number;
}

const scratchTelegraph: BossTelegraph = { kind: 'none', t01: 0, x: 0, y: 0, radius: 0 };

/**
 * Current telegraph of boss `id`. Writes into `out` (defaults to a shared scratch
 * object — do not hold on to it across calls).
 */
export function bossTelegraph(state: RunState, id: number, out: BossTelegraph = scratchTelegraph): BossTelegraph {
  const e = state.enemies;
  out.kind = 'none';
  out.t01 = 0;
  out.x = out.y = out.radius = 0;
  if (id < 0 || !e.isAlive(id) || !(e.flags[id] & ENEMY_FLAG.BOSS)) return out;
  const ai = e.aiState[id];
  if (ai === BOSS_STATE.slam) {
    const dur = slamTelegraphSec(state, id);
    out.kind = 'slam';
    out.t01 = Math.min(1, Math.max(0, 1 - e.aiTimer[id] / dur));
    out.x = e.aiDirX[id];
    out.y = e.aiDirY[id];
    out.radius = bossParam(state, id, 'slamRadius');
  } else if (ai === BOSS_STATE.summon) {
    const dur = summonTelegraphSec(state, id);
    out.kind = 'summon';
    out.t01 = Math.min(1, Math.max(0, 1 - e.aiTimer[id] / dur));
    out.x = e.x[id];
    out.y = e.y[id];
    out.radius = BOSS_SUMMON_RING;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

/** Frees the alive non-boss enemy farthest from the player (no kill, no orb). Returns false if none. */
function freeFarthestNonBoss(state: RunState): boolean {
  const e = state.enemies;
  const p = state.player;
  const ids = e.pool.activeIds;
  let best = -1;
  let bestD2 = -1;
  for (let k = 0; k < e.count; k++) {
    const id = ids[k];
    if (e.flags[id] & ENEMY_FLAG.BOSS) continue;
    const dx = e.x[id] - p.x;
    const dy = e.y[id] - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > bestD2 || (d2 === bestD2 && id < best)) {
      bestD2 = d2;
      best = id;
    }
  }
  if (best < 0) return false;
  return e.free(best);
}

export const bossSpawnSystem: System = (ctx) => {
  const state = ctx.state;
  const clock = state.clock;

  // Dawn with the boss alive: mark it fleeing (renderers fly it off-screen, Req 24.5).
  if (state.outcome === 'victory' && clock.bossSpawned) {
    const id = bossId(state);
    if (id >= 0 && state.enemies.aiState[id] !== BOSS_STATE.fleeing) {
      const e = state.enemies;
      e.aiState[id] = BOSS_STATE.fleeing;
      e.aiTimer[id] = 0;
      e.vx[id] = 0;
      e.vy[id] = 0;
    }
    return;
  }

  if (clock.bossSpawned || state.outcome !== null) return;
  const lead = state.config.balance.run.bossLeadSec;
  if (clock.elapsed < clock.duration - lead) return;

  clock.bossSpawned = true; // never retried, even if the config has no boss
  const type = bossTypeIndex(state);
  if (type < 0) return;

  const p = state.player;
  const x = p.x;
  const y = p.y - ctx.view.height / 2 - BOSS_SPAWN_MARGIN;
  let id = spawnEnemy(state, type, x, y);
  if (id < 0 && freeFarthestNonBoss(state)) id = spawnEnemy(state, type, x, y);
  if (id < 0) return;

  const e = state.enemies;
  e.aiState[id] = BOSS_STATE.approach;
  e.aiTimer[id] = 0;
  resetAttackState(ctx, id);
  state.events.push(EventType.bossSpawn, id);
};

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

function resolveSlam(ctx: SimContext, id: number): void {
  const state = ctx.state;
  const e = state.enemies;
  const p = state.player;
  const r = bossParam(state, id, 'slamRadius');
  const dx = p.x - e.aiDirX[id];
  const dy = p.y - e.aiDirY[id];
  if (dx * dx + dy * dy <= r * r) damagePlayer(state, bossParam(state, id, 'slamDmg'));
}

function resolveSummon(ctx: SimContext, id: number): void {
  const state = ctx.state;
  const e = state.enemies;
  const type = summonTypeIndex(state);
  if (type < 0) return;
  const n = Math.max(0, Math.floor(bossParam(state, id, 'summonCount')));
  const cx = e.x[id];
  const cy = e.y[id];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (spawnEnemy(state, type, cx + Math.cos(a) * BOSS_SUMMON_RING, cy + Math.sin(a) * BOSS_SUMMON_RING) < 0) break;
  }
}

function enterRecover(ctx: SimContext, id: number): void {
  const e = ctx.state.enemies;
  e.aiState[id] = BOSS_STATE.recover;
  e.aiTimer[id] = BOSS_RECOVER_SEC;
  bossAttackState(ctx, id).cooldown = bossParam(ctx.state, id, 'attackCooldown');
}

export const bossBehaviour: BehaviourFn = (ctx, id, dt) => {
  const state = ctx.state;
  const e = state.enemies;
  const p = state.player;
  const ai = e.aiState[id];

  if (ai !== BOSS_STATE.approach) {
    e.vx[id] = 0;
    e.vy[id] = 0;
    if (ai === BOSS_STATE.fleeing) return;
    e.aiTimer[id] -= dt;
    if (e.aiTimer[id] > 0) return;
    if (ai === BOSS_STATE.slam) {
      resolveSlam(ctx, id);
      enterRecover(ctx, id);
    } else if (ai === BOSS_STATE.summon) {
      resolveSummon(ctx, id);
      enterRecover(ctx, id);
    } else {
      e.aiState[id] = BOSS_STATE.approach;
      e.aiTimer[id] = 0;
    }
    return;
  }

  // Approach.
  let dx = p.x - e.x[id];
  let dy = p.y - e.y[id];
  let d = Math.hypot(dx, dy);
  // Keep up with a kiting player (the player is ~3× faster): blink back just
  // off-screen when far behind, and speed up while closing in.
  if (d > BOSS_BLINK_DIST) {
    const k = BOSS_BLINK_TO / d;
    e.x[id] = e.prevX[id] = p.x - dx * k;
    e.y[id] = e.prevY[id] = p.y - dy * k;
    dx = p.x - e.x[id];
    dy = p.y - e.y[id];
    d = Math.hypot(dx, dy);
  }
  if (d > BOSS_HOLD_DIST) {
    const catchUp = d > BOSS_CATCHUP_DIST ? BOSS_CATCHUP_MULT : 1;
    const s = (e.speed[id] * catchUp * (1 - e.slowAmt[id])) / d;
    e.vx[id] = dx * s;
    e.vy[id] = dy * s;
  } else {
    e.vx[id] = 0;
    e.vy[id] = 0;
  }

  const atk = bossAttackState(ctx, id);
  atk.cooldown -= dt;
  if (atk.cooldown > 0) return;
  // Slams need the player in range; summons can be cast from further away, so a
  // kiting player still gets pressure. Out of slam range, the summon goes first.
  if (d > BOSS_SUMMON_RANGE) return;
  if (atk.next === 0 && d > BOSS_ATTACK_RANGE) atk.next = 1;

  e.vx[id] = 0;
  e.vy[id] = 0;
  if (atk.next === 0) {
    e.aiState[id] = BOSS_STATE.slam;
    e.aiTimer[id] = slamTelegraphSec(state, id);
    e.aiDirX[id] = p.x;
    e.aiDirY[id] = p.y;
    atk.next = 1;
  } else {
    e.aiState[id] = BOSS_STATE.summon;
    e.aiTimer[id] = summonTelegraphSec(state, id);
    atk.next = 0;
  }
};

// ---------------------------------------------------------------------------
// Kill
// ---------------------------------------------------------------------------

export const bossKillHook: EnemyKilledHook = (ctx, id) => {
  const state = ctx.state;
  const e = state.enemies;
  if (!(e.flags[id] & ENEMY_FLAG.BOSS)) return;
  const x = e.x[id];
  const y = e.y[id];
  state.events.push(EventType.bossKilled, x, y);

  const tokens = state.tokens;
  const t = tokens.alloc();
  if (t >= 0) {
    tokens.x[t] = x;
    tokens.y[t] = y;
  }

  const each = Math.max(BOSS_BONUS_ORB_MIN, e.energyValue[id] / BOSS_BONUS_ORBS);
  for (let i = 0; i < BOSS_BONUS_ORBS; i++) {
    const a = (i / BOSS_BONUS_ORBS) * Math.PI * 2;
    const r = 40 + (i & 1) * 30;
    spawnOrb(state, x + Math.cos(a) * r, y + Math.sin(a) * r, each);
  }
};

/** Registers the boss behaviour and kill hook. Idempotent. */
export function installBoss(): void {
  registerBehaviour(BEHAVIOUR_CODE.boss, bossBehaviour);
  if (!onEnemyKilled.includes(bossKillHook)) onEnemyKilled.push(bossKillHook);
}
