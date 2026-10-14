/**
 * Bat Wings (dash, Req 11.1): every `cooldown` s while the player is moving
 * (|v| > 0) performs a dash along the movement direction covering `distance`
 * px over `duration` s (on top of normal movement, applied in tick — this runs
 * after PlayerSystem). The player is invulnerable for at least the dash time.
 *
 * Path damage: each step of the dash, alive enemies whose centre is within
 * player.radius + BAT_HIT_PAD + enemy radius take `damage`, at most once per
 * dash (per-ctx stamp array keyed by enemy id; a stamp equal to the current
 * dash serial means "already hit").
 * Lingering (L5, `lingering` = 1): stationary player projectiles are dropped
 * every distance / BAT_TRAIL_DROPS px along the path (speed 0, lifetime
 * BAT_TRAIL_LIFETIME, high pierce, damage × BAT_TRAIL_DAMAGE_MULT).
 *
 * Data slots: 0 dash time left, 1–2 dash dir, 3 dash speed, 4 distance since
 * last trail drop, 5 dash serial.
 */
import type { AbilityParams } from '../../data/bodyParts';
import { PROJECTILE_SIDE } from '../RunState';
import type { SimContext } from '../SimContext';
import { HIT_QUERY_PAD, spawnProjectile } from '../systems/ProjectileSystem';
import type { AbilityRuntime } from './types';
import { ABILITY_DATA_SLOTS, getAbilityState } from './types';

export const BAT_DEFAULT_DURATION = 0.18;
export const BAT_DEFAULT_DISTANCE = 120;
export const BAT_HIT_PAD = 20;
export const BAT_TRAIL_DROPS = 4;
export const BAT_TRAIL_LIFETIME = 0.6;
export const BAT_TRAIL_RADIUS = 18;
export const BAT_TRAIL_PIERCE = 999;
export const BAT_TRAIL_DAMAGE_MULT = 0.5;

const S_LEFT = 0;
const S_DIRX = 1;
const S_DIRY = 2;
const S_SPEED = 3;
const S_TRAIL = 4;
const S_SERIAL = 5;

const HIT_STAMPS = new WeakMap<SimContext, Int32Array>();

function hitStamps(ctx: SimContext): Int32Array {
  let s = HIT_STAMPS.get(ctx);
  if (s === undefined) {
    s = new Int32Array(ctx.state.enemies.capacity);
    HIT_STAMPS.set(ctx, s);
  }
  return s;
}

/** True while the part at `partIndex` is mid-dash (for rendering). */
export function batWingsDashing(ctx: SimContext, partIndex: number): boolean {
  return getAbilityState(ctx).data[partIndex * ABILITY_DATA_SLOTS + S_LEFT] > 0;
}

function hitAlongPath(ctx: SimContext, partIndex: number, serial: number, damage: number): void {
  const p = ctx.state.player;
  const e = ctx.state.enemies;
  const stamps = hitStamps(ctx);
  const reach = p.radius + BAT_HIT_PAD;
  const scratch = ctx.scratch;
  const n = ctx.enemyHash.queryRadius(p.x, p.y, reach + HIT_QUERY_PAD, scratch);
  for (let j = 0; j < n; j++) {
    const id = scratch[j];
    if (!e.isAlive(id) || stamps[id] === serial) continue;
    const dx = e.x[id] - p.x;
    const dy = e.y[id] - p.y;
    const r = reach + e.radius[id];
    if (dx * dx + dy * dy > r * r) continue;
    stamps[id] = serial;
    ctx.damage.push(id, damage, partIndex);
  }
}

function dashStep(ctx: SimContext, dt: number, partIndex: number, params: AbilityParams, base: number): void {
  const data = getAbilityState(ctx).data;
  const p = ctx.state.player;
  const step = Math.min(dt, data[base + S_LEFT]);
  const move = data[base + S_SPEED] * step;
  p.x += data[base + S_DIRX] * move;
  p.y += data[base + S_DIRY] * move;
  data[base + S_LEFT] -= step;
  if (data[base + S_LEFT] < 1e-6) data[base + S_LEFT] = 0;

  hitAlongPath(ctx, partIndex, data[base + S_SERIAL], params.damage);

  if ((params.lingering ?? 0) >= 1) {
    const spacing = (params.distance ?? BAT_DEFAULT_DISTANCE) / BAT_TRAIL_DROPS;
    data[base + S_TRAIL] += move;
    while (data[base + S_TRAIL] >= spacing && spacing > 0) {
      data[base + S_TRAIL] -= spacing;
      spawnProjectile(
        ctx,
        PROJECTILE_SIDE.PLAYER,
        partIndex,
        p.x,
        p.y,
        0,
        0,
        BAT_TRAIL_RADIUS,
        params.damage * BAT_TRAIL_DAMAGE_MULT,
        BAT_TRAIL_PIERCE,
        BAT_TRAIL_LIFETIME,
      );
    }
  }
}

export const batWings: AbilityRuntime = {
  onEquip(ctx, partIndex) {
    const s = getAbilityState(ctx);
    s.cooldown[partIndex] = 0;
    const base = partIndex * ABILITY_DATA_SLOTS;
    s.data.fill(0, base, base + ABILITY_DATA_SLOTS);
    // Serial restarts at 1, so clear stamps left over from a previous run.
    hitStamps(ctx).fill(0);
  },
  onLevel() {
    // All level effects come from params (read at dash start).
  },
  tick(ctx, dt, partIndex, params) {
    const s = getAbilityState(ctx);
    const data = s.data;
    const base = partIndex * ABILITY_DATA_SLOTS;
    const cd = s.cooldown;
    if (cd[partIndex] > 0) cd[partIndex] = Math.max(0, cd[partIndex] - dt);

    if (data[base + S_LEFT] > 0) {
      dashStep(ctx, dt, partIndex, params, base);
      return;
    }
    if (cd[partIndex] > 0) return;

    const p = ctx.state.player;
    const speed = Math.hypot(p.vx, p.vy);
    if (!(speed > 0) || !Number.isFinite(speed)) return; // ready, waiting for movement

    const duration = Math.max(1e-3, params.duration ?? BAT_DEFAULT_DURATION);
    const distance = Math.max(0, params.distance ?? BAT_DEFAULT_DISTANCE);
    data[base + S_DIRX] = p.vx / speed;
    data[base + S_DIRY] = p.vy / speed;
    data[base + S_SPEED] = distance / duration;
    data[base + S_LEFT] = duration;
    data[base + S_TRAIL] = 0;
    data[base + S_SERIAL] = (data[base + S_SERIAL] + 1) % 0x7fffff || 1; // never 0 (fresh stamps)
    p.invuln = Math.max(p.invuln, duration);
    cd[partIndex] = Math.max(0.05, params.cooldown ?? 1);

    dashStep(ctx, dt, partIndex, params, base);
  },
};
