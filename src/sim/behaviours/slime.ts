/**
 * Slime behaviour (Req 22.5).
 *
 * Size contract (renderers read this): slime size = aiState (1..N). A freshly
 * spawned slime has aiState 0 and is initialised on its first tick (or on kill)
 * to behaviourParams.size (default 3). Per size:
 *   scale  = 0.55 + 0.25 × size
 *   radius = type.radius × (0.5 + size / 6)
 * Movement: chaser.
 *
 * Split (onEnemyKilled hook): a slime killed with size > minSize (default 1)
 * spawns 2 slimes at its position ± 12 px (perpendicular to the player
 * direction), each size − 1, hp = maxHp = parent maxHp × 0.45, energyValue =
 * max(1, floor(parent energy / 2)), stun 0.25 s and ±160 px/s perpendicular
 * velocity (EnemyAISystem integrates/damps it while stunned). Children that
 * don't fit in the store are skipped.
 */
import { BEHAVIOUR_CODE, spawnEnemy } from '../entities';
import type { SimContext } from '../SimContext';
import type { EnemyKilledHook } from '../systems/DamageSystem';
import type { BehaviourFn } from '../systems/EnemyAISystem';
import { param, steerToPlayer } from './shared';

export const SLIME_DEFAULT_SIZE = 3;
export const SLIME_CHILD_HP_FRAC = 0.45;
export const SLIME_SPLIT_OFFSET = 12;
export const SLIME_SPLIT_SPEED = 160;
export const SLIME_SPLIT_STUN = 0.25;

export function slimeScale(size: number): number {
  return 0.55 + 0.25 * size;
}

export function slimeRadius(typeRadius: number, size: number): number {
  return typeRadius * (0.5 + size / 6);
}

/** Sets size (aiState) and the derived scale/radius. Size is clamped to 1..255. */
export function applySlimeSize(ctx: SimContext, id: number, size: number): void {
  const e = ctx.state.enemies;
  const s = Math.max(1, Math.min(255, Math.round(size)));
  const type = ctx.state.config.enemies[e.typeId[id]];
  e.aiState[id] = s;
  e.scale[id] = slimeScale(s);
  e.radius[id] = slimeRadius(type ? type.radius : e.radius[id], s);
}

/** Current size of a slime, initialising it from behaviourParams.size when still 0. */
export function slimeSize(ctx: SimContext, id: number): number {
  const e = ctx.state.enemies;
  if (e.aiState[id] === 0) applySlimeSize(ctx, id, param(ctx, id, 'size', SLIME_DEFAULT_SIZE));
  return e.aiState[id];
}

export const slimeBehaviour: BehaviourFn = (ctx, id) => {
  slimeSize(ctx, id);
  steerToPlayer(ctx, id);
};

export const slimeKillHook: EnemyKilledHook = (ctx, id) => {
  const state = ctx.state;
  const e = state.enemies;
  if (e.behaviour[id] !== BEHAVIOUR_CODE.slime) return;
  const size = slimeSize(ctx, id);
  const minSize = param(ctx, id, 'minSize', 1);
  if (!(size > minSize)) return;

  const x = e.x[id];
  const y = e.y[id];
  const typeIndex = e.typeId[id];
  const childHp = e.maxHp[id] * SLIME_CHILD_HP_FRAC;
  const childEnergy = Math.max(1, Math.floor(e.energyValue[id] / 2));

  // Split perpendicular to the player direction (fallback: vertical split).
  const dx = state.player.x - x;
  const dy = state.player.y - y;
  const d = Math.hypot(dx, dy);
  const px = d > 1e-6 ? -dy / d : 0;
  const py = d > 1e-6 ? dx / d : 1;

  for (let k = 0; k < 2; k++) {
    const sign = k === 0 ? 1 : -1;
    const c = spawnEnemy(state, typeIndex, x + px * SLIME_SPLIT_OFFSET * sign, y + py * SLIME_SPLIT_OFFSET * sign);
    if (c < 0) continue;
    applySlimeSize(ctx, c, size - 1);
    e.hp[c] = e.maxHp[c] = childHp;
    e.energyValue[c] = childEnergy;
    e.stun[c] = SLIME_SPLIT_STUN;
    e.vx[c] = px * SLIME_SPLIT_SPEED * sign;
    e.vy[c] = py * SLIME_SPLIT_SPEED * sign;
  }
};
