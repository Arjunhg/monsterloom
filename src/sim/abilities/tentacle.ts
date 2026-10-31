/**
 * Tentacle (grab, Req 11.1): on cooldown grabs up to `count` nearest alive
 * enemies within `range` of the player and hurls them away from the player.
 *
 * Simplest deterministic version (impact resolved at grab time):
 * - each grabbed enemy takes `damage`, gets stun = TENTACLE_STUN_SEC and
 *   velocity TENTACLE_HURL_SPEED away from the player (EnemyAISystem integrates
 *   and damps it while stunned). Bosses take the damage but are not hurled.
 * - every other alive enemy within `radius` of a grabbed enemy (at grab time)
 *   takes `damage × TENTACLE_SPLASH_MULT`, once per grabbed enemy.
 * When no enemy is in range the ability stays ready (cooldown is not spent).
 */
import type { AbilityParams } from '../../data/bodyParts';
import { ENEMY_FLAG } from '../RunState';
import type { SimContext } from '../SimContext';
import type { AbilityRuntime } from './types';
import { ABILITY_DATA_SLOTS, getAbilityState } from './types';

export const TENTACLE_STUN_SEC = 0.6;
export const TENTACLE_HURL_SPEED = 600;
export const TENTACLE_SPLASH_MULT = 0.5;
export const TENTACLE_DEFAULT_RANGE = 140;
export const TENTACLE_DEFAULT_RADIUS = 50;
export const TENTACLE_MAX_GRABS = 8;
/** Duration of the grab-lash visual after a grab. */
export const TENTACLE_VISUAL_SEC = 0.3;
/** Grabs the visual can show (data slots bound; catalogue count peaks at 2). */
export const TENTACLE_VISUAL_MAX = 2;

// Data slots: 0 visual time left, 1 visual grab count, 2–5 grab x/y pairs.
const S_VISUAL_LEFT = 0;
const S_VISUAL_COUNT = 1;
const S_VISUAL_POS = 2;

export interface TentacleView {
  active: boolean;
  /** Visual progress 0..1. */
  t01: number;
}

const view: TentacleView = { active: false, t01: 0 };

/** Latest grab-lash visual state (for rendering). Reused object — copy to keep. */
export function tentacleView(ctx: SimContext, partIndex: number, out: TentacleView = view): TentacleView {
  const data = getAbilityState(ctx).data;
  const left = data[partIndex * ABILITY_DATA_SLOTS + S_VISUAL_LEFT];
  out.active = left > 0;
  out.t01 = out.active ? 1 - left / TENTACLE_VISUAL_SEC : 0;
  return out;
}

/**
 * Writes the latest grab positions (x/y pairs, length 2 × count) into `out`
 * while the visual is live; returns the count (0 when no visual).
 */
export function tentacleGrabs(ctx: SimContext, partIndex: number, out: number[]): number {
  const data = getAbilityState(ctx).data;
  const base = partIndex * ABILITY_DATA_SLOTS;
  if (!(data[base + S_VISUAL_LEFT] > 0)) {
    out.length = 0;
    return 0;
  }
  const n = Math.min(TENTACLE_VISUAL_MAX, Math.max(0, Math.floor(data[base + S_VISUAL_COUNT])));
  out.length = 2 * n;
  for (let i = 0; i < n; i++) {
    out[2 * i] = data[base + S_VISUAL_POS + 2 * i];
    out[2 * i + 1] = data[base + S_VISUAL_POS + 2 * i + 1];
  }
  return n;
}

const grabbed = new Int32Array(TENTACLE_MAX_GRABS);
const grabX = new Float32Array(TENTACLE_MAX_GRABS);
const grabY = new Float32Array(TENTACLE_MAX_GRABS);

function isGrabbed(id: number, n: number): boolean {
  for (let i = 0; i < n; i++) if (grabbed[i] === id) return true;
  return false;
}

/** Grabs and hurls; returns the number of enemies grabbed. */
function grab(ctx: SimContext, partIndex: number, params: AbilityParams): number {
  const p = ctx.state.player;
  const e = ctx.state.enemies;
  const range = params.range ?? TENTACLE_DEFAULT_RANGE;
  const radius = params.radius ?? TENTACLE_DEFAULT_RADIUS;
  const count = Math.min(TENTACLE_MAX_GRABS, Math.max(1, Math.floor(params.count ?? 1)));
  const scratch = ctx.scratch;

  // Pick the `count` nearest (selection; ties keep hash order → deterministic).
  const n = ctx.enemyHash.queryRadius(p.x, p.y, range, scratch);
  let g = 0;
  while (g < count) {
    let best = -1;
    let bestD2 = Infinity;
    for (let j = 0; j < n; j++) {
      const id = scratch[j];
      if (!e.isAlive(id) || isGrabbed(id, g)) continue;
      const dx = e.x[id] - p.x;
      const dy = e.y[id] - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = id;
      }
    }
    if (best < 0) break;
    grabbed[g] = best;
    grabX[g] = e.x[best];
    grabY[g] = e.y[best];
    g++;
  }

  for (let i = 0; i < g; i++) {
    const id = grabbed[i];
    ctx.damage.push(id, params.damage, partIndex);
    if ((e.flags[id] & ENEMY_FLAG.BOSS) === 0) {
      let dx = e.x[id] - p.x;
      let dy = e.y[id] - p.y;
      let len = Math.hypot(dx, dy);
      if (!(len > 1e-6)) {
        dx = p.lastDirX;
        dy = p.lastDirY;
        len = Math.hypot(dx, dy);
        if (!(len > 1e-6)) {
          dx = 1;
          dy = 0;
          len = 1;
        }
      }
      e.vx[id] = (dx / len) * TENTACLE_HURL_SPEED;
      e.vy[id] = (dy / len) * TENTACLE_HURL_SPEED;
      e.stun[id] = Math.max(e.stun[id], TENTACLE_STUN_SEC);
    }
  }

  // Record the lash visual before splash reuses scratch.
  if (g > 0) {
    const data = getAbilityState(ctx).data;
    const base = partIndex * ABILITY_DATA_SLOTS;
    const shown = Math.min(TENTACLE_VISUAL_MAX, g);
    data[base + S_VISUAL_LEFT] = TENTACLE_VISUAL_SEC;
    data[base + S_VISUAL_COUNT] = shown;
    for (let i = 0; i < shown; i++) {
      data[base + S_VISUAL_POS + 2 * i] = grabX[i];
      data[base + S_VISUAL_POS + 2 * i + 1] = grabY[i];
    }
  }

  // Impact splash around each grabbed enemy (scratch is reused; grabbed ids were copied).
  const splash = params.damage * TENTACLE_SPLASH_MULT;
  for (let i = 0; i < g; i++) {
    const m = ctx.enemyHash.queryRadius(grabX[i], grabY[i], radius, scratch);
    for (let j = 0; j < m; j++) {
      const id = scratch[j];
      if (id === grabbed[i] || !e.isAlive(id)) continue;
      ctx.damage.push(id, splash, partIndex);
    }
  }
  return g;
}

export const tentacle: AbilityRuntime = {
  onEquip(ctx, partIndex) {
    const s = getAbilityState(ctx);
    s.cooldown[partIndex] = 0;
    const base = partIndex * ABILITY_DATA_SLOTS;
    s.data.fill(0, base, base + ABILITY_DATA_SLOTS);
  },
  onLevel() {
    // All level effects come from params.
  },
  tick(ctx, dt, partIndex, params) {
    const data = getAbilityState(ctx).data;
    const vBase = partIndex * ABILITY_DATA_SLOTS + S_VISUAL_LEFT;
    if (data[vBase] > 0) data[vBase] = Math.max(0, data[vBase] - dt);
    const cd = getAbilityState(ctx).cooldown;
    if (cd[partIndex] > 0) cd[partIndex] -= dt;
    if (cd[partIndex] > 0) return;
    if (grab(ctx, partIndex, params) === 0) {
      cd[partIndex] = 0; // stay ready until something is in range
      return;
    }
    cd[partIndex] = Math.max(0.05, params.cooldown ?? 1);
  },
};
