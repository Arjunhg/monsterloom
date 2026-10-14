/**
 * Extra Eye (projectile, Req 11.1): `count` eyes, each firing its own homing
 * eye-bolt on its own timer (cooldown s). Eye timers live in the part's data
 * slots (one slot per eye, so at most EYE_MAX = ABILITY_DATA_SLOTS eyes) and
 * are staggered (eye k starts at k/count · cooldown) so eyes don't fire on the
 * same tick.
 *
 * Homing: projectiles have no target field, so a per-SimContext Int32Array
 * (indexed by projectile id) remembers the Auto_Aim target at fire time. Each
 * tick this ability steers its own bolts (pr.ability === partIndex) toward the
 * target by at most EYE_TURN_RATE rad/s. Bolts whose target died fly straight.
 * ProjectileSystem is untouched.
 */
import type { AbilityParams } from '../../data/bodyParts';
import type { MutVec2 } from '../math';
import { PROJECTILE_SIDE } from '../RunState';
import type { SimContext } from '../SimContext';
import { spawnProjectile } from '../systems/ProjectileSystem';
import { autoAim } from './autoAim';
import type { AbilityRuntime } from './types';
import { ABILITY_DATA_SLOTS, getAbilityState } from './types';

export const EYE_MAX = ABILITY_DATA_SLOTS;
export const EYE_RADIUS = 7;
export const EYE_DEFAULT_SPEED = 300;
export const EYE_DEFAULT_RANGE = 380;
/** Bolts fly slightly faster than the listed speed to compensate for curving. */
export const EYE_SPEED_MULT = 1.15;
/** Lifetime = range / speed × this (homing paths are longer than straight lines). */
export const EYE_LIFETIME_MULT = 1.5;
/** Maximum homing turn rate (rad/s). */
export const EYE_TURN_RATE = 6;

interface EyeCtxState {
  /** Homing target enemy id per projectile id (−1 = none). */
  target: Int32Array;
  /** Number of eyes whose timers have been initialised, per part index. */
  knownCount: Uint8Array;
}

const EYE_STATE = new WeakMap<SimContext, EyeCtxState>();

function eyeState(ctx: SimContext): EyeCtxState {
  let s = EYE_STATE.get(ctx);
  if (s === undefined) {
    s = {
      target: new Int32Array(ctx.state.projectiles.capacity).fill(-1),
      knownCount: new Uint8Array(ctx.state.config.bodyParts.length),
    };
    EYE_STATE.set(ctx, s);
  }
  return s;
}

const aim: MutVec2 = { x: 1, y: 0 };

function fireEye(ctx: SimContext, partIndex: number, params: AbilityParams, es: EyeCtxState): void {
  const p = ctx.state.player;
  const range = params.range ?? EYE_DEFAULT_RANGE;
  const speed = (params.speed ?? EYE_DEFAULT_SPEED) * EYE_SPEED_MULT;
  const lifetime = speed > 0 ? (range / speed) * EYE_LIFETIME_MULT : 0;
  const pierce = Math.max(0, Math.floor(params.pierce ?? 0));
  const target = autoAim(ctx, range, aim);
  const id = spawnProjectile(
    ctx,
    PROJECTILE_SIDE.PLAYER,
    partIndex,
    p.x,
    p.y,
    aim.x * speed,
    aim.y * speed,
    EYE_RADIUS,
    params.damage,
    pierce,
    lifetime,
  );
  if (id >= 0) es.target[id] = target;
}

function steer(ctx: SimContext, dt: number, partIndex: number, es: EyeCtxState): void {
  const pr = ctx.state.projectiles;
  const enemies = ctx.state.enemies;
  const ids = pr.pool.activeIds;
  const maxTurn = EYE_TURN_RATE * dt;
  for (let k = 0; k < pr.count; k++) {
    const id = ids[k];
    if (pr.ability[id] !== partIndex || pr.side[id] !== PROJECTILE_SIDE.PLAYER) continue;
    const t = es.target[id];
    if (t < 0) continue;
    if (!enemies.isAlive(t)) {
      es.target[id] = -1;
      continue;
    }
    const dx = enemies.x[t] - pr.x[id];
    const dy = enemies.y[t] - pr.y[id];
    if (dx * dx + dy * dy < 1e-6) continue;
    const vx = pr.vx[id];
    const vy = pr.vy[id];
    const speed = Math.hypot(vx, vy);
    if (!(speed > 0)) continue;
    const cur = Math.atan2(vy, vx);
    let diff = Math.atan2(dy, dx) - cur;
    if (diff > Math.PI) diff -= 2 * Math.PI;
    else if (diff < -Math.PI) diff += 2 * Math.PI;
    if (diff > maxTurn) diff = maxTurn;
    else if (diff < -maxTurn) diff = -maxTurn;
    const a = cur + diff;
    pr.vx[id] = Math.cos(a) * speed;
    pr.vy[id] = Math.sin(a) * speed;
  }
}

export const extraEye: AbilityRuntime = {
  onEquip(ctx, partIndex) {
    const base = partIndex * ABILITY_DATA_SLOTS;
    getAbilityState(ctx).data.fill(0, base, base + ABILITY_DATA_SLOTS);
    eyeState(ctx).knownCount[partIndex] = 0;
  },
  onLevel() {
    // New eyes are picked up (and staggered) by tick when `count` grows.
  },
  tick(ctx, dt, partIndex, params) {
    const es = eyeState(ctx);
    steer(ctx, dt, partIndex, es);

    const data = getAbilityState(ctx).data;
    const base = partIndex * ABILITY_DATA_SLOTS;
    const count = Math.min(EYE_MAX, Math.max(1, Math.floor(params.count ?? 1)));
    const interval = Math.max(0.05, params.cooldown ?? 1);

    // Initialise timers of newly gained eyes with a stagger.
    const known = es.knownCount[partIndex];
    if (count > known) {
      for (let k = known; k < count; k++) data[base + k] = (k / count) * interval;
      es.knownCount[partIndex] = count;
    } else if (count < known) {
      es.knownCount[partIndex] = count;
    }

    for (let k = 0; k < count; k++) {
      const i = base + k;
      data[i] -= dt;
      if (data[i] > 0) continue;
      fireEye(ctx, partIndex, params, es);
      data[i] += interval;
      if (data[i] <= 0) data[i] = interval; // long dt: don't burst-fire
    }
  },
};
