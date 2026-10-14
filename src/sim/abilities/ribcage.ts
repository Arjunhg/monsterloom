/**
 * Ribcage (orbital, Req 11.1): `count` bones evenly spaced on a circle of
 * `radius` px around the player, rotating at `speed` rad/s. Each step every
 * bone damages the alive enemies it overlaps (bone radius RIB_BONE_RADIUS).
 *
 * Hit interval: each enemy can be hit by this part at most once per
 * `cooldown` s (default RIB_HIT_INTERVAL; ribcage data defines no cooldown).
 * Tracked in a per-ctx Float32Array keyed by `partIndex × enemyCapacity + id`
 * holding the part-local time of the next allowed hit. A freshly spawned enemy
 * reusing a slot may inherit up to one interval of immunity (accepted).
 *
 * Data slots: 0 orbit angle (rad), 1 part-local time (s), 2 bone count,
 * 3 orbit radius (last tick, for rendering).
 */
import type { SimContext } from '../SimContext';
import { HIT_QUERY_PAD } from '../systems/ProjectileSystem';
import type { AbilityRuntime } from './types';
import { ABILITY_DATA_SLOTS, getAbilityState } from './types';

export const RIB_BONE_RADIUS = 12;
export const RIB_HIT_INTERVAL = 0.5;
export const RIB_DEFAULT_RADIUS = 60;
export const RIB_DEFAULT_SPEED = 2.5;
export const RIB_MAX_BONES = 16;

const S_ANGLE = 0;
const S_TIME = 1;
const S_COUNT = 2;
const S_RADIUS = 3;

const NEXT_HIT = new WeakMap<SimContext, Float32Array>();

function nextHit(ctx: SimContext): Float32Array {
  let a = NEXT_HIT.get(ctx);
  if (a === undefined) {
    a = new Float32Array(ctx.state.config.bodyParts.length * ctx.state.enemies.capacity);
    NEXT_HIT.set(ctx, a);
  }
  return a;
}

/**
 * Writes bone world positions as [x0, y0, x1, y1, …] into `out` (length is
 * set to 2 × count) and returns the bone count (0 before the first tick).
 */
export function ribcageBonePositions(ctx: SimContext, partIndex: number, out: number[]): number {
  const data = getAbilityState(ctx).data;
  const base = partIndex * ABILITY_DATA_SLOTS;
  const count = data[base + S_COUNT] | 0;
  const radius = data[base + S_RADIUS];
  const angle = data[base + S_ANGLE];
  const p = ctx.state.player;
  out.length = count * 2;
  for (let k = 0; k < count; k++) {
    const a = angle + (k / count) * Math.PI * 2;
    out[2 * k] = p.x + Math.cos(a) * radius;
    out[2 * k + 1] = p.y + Math.sin(a) * radius;
  }
  return count;
}

export const ribcage: AbilityRuntime = {
  onEquip(ctx, partIndex) {
    const base = partIndex * ABILITY_DATA_SLOTS;
    getAbilityState(ctx).data.fill(0, base, base + ABILITY_DATA_SLOTS);
    const cap = ctx.state.enemies.capacity;
    nextHit(ctx).fill(0, partIndex * cap, partIndex * cap + cap);
  },
  onLevel() {
    // Count / radius / speed are re-read from params every tick.
  },
  tick(ctx, dt, partIndex, params) {
    const data = getAbilityState(ctx).data;
    const base = partIndex * ABILITY_DATA_SLOTS;
    const count = Math.min(RIB_MAX_BONES, Math.max(1, Math.floor(params.count ?? 1)));
    const radius = Math.max(0, params.radius ?? RIB_DEFAULT_RADIUS);
    const speed = params.speed ?? RIB_DEFAULT_SPEED;
    const interval = Math.max(0.05, params.cooldown ?? RIB_HIT_INTERVAL);

    let angle = data[base + S_ANGLE] + speed * dt;
    angle %= Math.PI * 2;
    data[base + S_ANGLE] = angle;
    const now = data[base + S_TIME] + dt;
    data[base + S_TIME] = now;
    data[base + S_COUNT] = count;
    data[base + S_RADIUS] = radius;

    const p = ctx.state.player;
    const e = ctx.state.enemies;
    const hits = nextHit(ctx);
    const hitBase = partIndex * e.capacity;
    const scratch = ctx.scratch;
    for (let k = 0; k < count; k++) {
      const a = angle + (k / count) * Math.PI * 2;
      const bx = p.x + Math.cos(a) * radius;
      const by = p.y + Math.sin(a) * radius;
      const n = ctx.enemyHash.queryRadius(bx, by, RIB_BONE_RADIUS + HIT_QUERY_PAD, scratch);
      for (let j = 0; j < n; j++) {
        const id = scratch[j];
        if (!e.isAlive(id) || hits[hitBase + id] > now) continue;
        const dx = e.x[id] - bx;
        const dy = e.y[id] - by;
        const r = RIB_BONE_RADIUS + e.radius[id];
        if (dx * dx + dy * dy > r * r) continue;
        hits[hitBase + id] = now + interval;
        ctx.damage.push(id, params.damage, partIndex);
      }
    }
  },
};
