/**
 * Shared entity helpers used by several systems. Keep these signatures stable;
 * systems in parallel tasks depend on them.
 */
import { hpScaleAt } from '../data/balance';
import type { BehaviourId } from '../data/enemies';
import { EventType } from './EventBus';
import { ENEMY_FLAG, type RunState } from './RunState';
import { clampStats } from './StatCaps';

/** Numeric codes for EnemyStore.behaviour (index into this array = code). */
export const BEHAVIOUR_IDS: readonly BehaviourId[] = [
  'chaser',
  'bat',
  'ghost',
  'slime',
  'witch',
  'boss',
  'ringInward',
  'stampede',
];
export const BEHAVIOUR_CODE: Record<BehaviourId, number> = {
  chaser: 0,
  bat: 1,
  ghost: 2,
  slime: 3,
  witch: 4,
  boss: 5,
  // Swarm overrides (Req 23), set at spawn by the SpawnDirector's swarm events.
  ringInward: 6,
  stampede: 7,
};

/**
 * Spawns an enemy of config.enemies[typeIndex] at (x, y), applying hpScaleAt(elapsed).
 * Sets typeId, behaviour code, radius, hp/maxHp, speed, contactDmg, energyValue,
 * scale 1, tier 0, prevX/Y = x/y, and NO_MERGE when the type can't merge.
 * Does NOT spend threat credits or emit events. Returns the id, or −1 if the store is full.
 */
export function spawnEnemy(state: RunState, typeIndex: number, x: number, y: number): number {
  const type = state.config.enemies[typeIndex];
  if (!type) return -1;
  const e = state.enemies;
  const id = e.alloc();
  if (id < 0) return -1;
  const hp = type.hp * hpScaleAt(state.clock.elapsed, state.config.balance);
  e.typeId[id] = typeIndex;
  e.behaviour[id] = BEHAVIOUR_CODE[type.behaviour];
  e.x[id] = e.prevX[id] = x;
  e.y[id] = e.prevY[id] = y;
  e.radius[id] = type.radius;
  e.hp[id] = e.maxHp[id] = hp;
  e.speed[id] = type.speed;
  e.contactDmg[id] = type.contactDmg;
  e.energyValue[id] = type.energy;
  if (!type.canMerge) e.flags[id] |= ENEMY_FLAG.NO_MERGE;
  if (type.noSeparation) e.flags[id] |= ENEMY_FLAG.NO_SEP;
  if (type.boss) e.flags[id] |= ENEMY_FLAG.BOSS | ENEMY_FLAG.NO_MERGE;
  return id;
}

/**
 * Applies damage to the player (Req 3.2–3.5). Ignored while invulnerable or
 * after the run ended. Clamps hp to [0, maxHp], starts invulnerability
 * (balance.player.invulnSec), emits playerHurt, and sets outcome 'defeat'
 * (+ runEnded event) when hp reaches 0. Returns true if damage was applied.
 */
export function damagePlayer(state: RunState, amount: number): boolean {
  const p = state.player;
  if (!(amount > 0) || p.invuln > 0 || state.outcome !== null) return false;
  // Wide-screen adaptation: tougher hide against the bigger crowd (1 on portrait).
  amount /= p.viewBoost || 1;
  p.hp = Math.min(p.maxHp, Math.max(0, p.hp - amount));
  p.invuln = state.config.balance.player.invulnSec;
  state.stats.noDamageSec = 0;
  state.events.push(EventType.playerHurt, amount, p.hp);
  if (p.hp <= 0) {
    state.outcome = 'defeat';
    state.events.push(EventType.runEnded, 0);
  }
  return true;
}

/** Heals the player, clamped to maxHp. Returns the amount actually healed. */
export function healPlayer(state: RunState, amount: number): number {
  const p = state.player;
  if (!(amount > 0) || state.outcome !== null) return 0;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  return p.hp - before;
}

/**
 * Drops an energy orb at (x, y). Returns the orb id, or −1 if the store is full
 * (OrbSystem's cap-merge keeps the count ≤ balance.orbs.max so this should not
 * happen; if it does, the value is added to the oldest orb so energy is preserved).
 */
export function spawnOrb(state: RunState, x: number, y: number, value: number): number {
  if (!(value > 0)) return -1;
  const o = state.orbs;
  const id = o.alloc();
  if (id < 0) {
    const oldest = o.oldest();
    if (oldest >= 0) o.value[oldest] += value;
    return -1;
  }
  o.x[id] = x;
  o.y[id] = y;
  o.value[id] = value;
  return id;
}

/** Effective player move speed (base × capped moveSpeed multiplier). */
export function playerMoveSpeed(state: RunState): number {
  clampStats(state.player.stats, state.config.balance.caps);
  return state.player.speed * state.player.stats.moveSpeed;
}

/** Effective pickup radius (base × capped pickupRadius multiplier). */
export function playerPickupRadius(state: RunState): number {
  clampStats(state.player.stats, state.config.balance.caps);
  return state.player.pickupRadius * state.player.stats.pickupRadius * (state.player.viewBoost || 1);
}

/** Index of a body part id in config.bodyParts (−1 if unknown). */
export function partIndex(state: RunState, partId: string): number {
  return state.config.bodyParts.findIndex((p) => p.id === partId);
}
