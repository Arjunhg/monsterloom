/**
 * Swamp Gut (aoe, Req 11.1): every `cooldown` s pulses at the player's
 * position, damaging every alive enemy within `radius` and slowing it:
 * slowAmt = max(current, slow), slowTimer = max(current, duration).
 *
 * Puddle (`lingering` = 1, L4+): the pulse leaves one puddle per part at the
 * pulse position (a new pulse replaces the old puddle) lasting `duration` s.
 * Every SWAMP_PUDDLE_TICK s it re-applies the slow (for SWAMP_PUDDLE_TICK s)
 * and deals damage × SWAMP_PUDDLE_DAMAGE_MULT to enemies inside it.
 *
 * Data slots: 0 puddle time left, 1–2 puddle x/y, 3 puddle radius,
 * 4 time until next puddle tick, 5 puddle slow, 6 pulse visual left,
 * 7 pulse visual radius.
 */
import type { AbilityParams } from '../../data/bodyParts';
import type { SimContext } from '../SimContext';
import type { AbilityRuntime } from './types';
import { ABILITY_DATA_SLOTS, getAbilityState } from './types';

export const SWAMP_DEFAULT_RADIUS = 90;
export const SWAMP_DEFAULT_SLOW = 0.2;
export const SWAMP_DEFAULT_DURATION = 1.5;
export const SWAMP_PUDDLE_TICK = 0.5;
export const SWAMP_PUDDLE_DAMAGE_MULT = 0.25;
/** Duration of the pulse flash visual (all levels; the puddle itself is L4+). */
export const SWAMP_PULSE_VISUAL_SEC = 0.35;

const S_LEFT = 0;
const S_X = 1;
const S_Y = 2;
const S_RADIUS = 3;
const S_TICK = 4;
const S_SLOW = 5;
const S_PULSE_LEFT = 6;
const S_PULSE_RADIUS = 7;

export interface SwampPuddleView {
  active: boolean;
  x: number;
  y: number;
  radius: number;
  /** Seconds remaining. */
  timeLeft: number;
}

const puddleView: SwampPuddleView = { active: false, x: 0, y: 0, radius: 0, timeLeft: 0 };

/**
 * Current puddle of the part (for rendering). Writes into `out` (defaults to
 * a shared module-level object — copy it if you need to keep it) and returns it.
 */
export function swampGutPuddle(ctx: SimContext, partIndex: number, out: SwampPuddleView = puddleView): SwampPuddleView {
  const data = getAbilityState(ctx).data;
  const base = partIndex * ABILITY_DATA_SLOTS;
  out.timeLeft = data[base + S_LEFT];
  out.active = out.timeLeft > 0;
  out.x = data[base + S_X];
  out.y = data[base + S_Y];
  out.radius = data[base + S_RADIUS];
  return out;
}

export interface SwampPulseView {
  active: boolean;
  radius: number;
  /** Visual progress 0..1. */
  t01: number;
}

const pulseView: SwampPulseView = { active: false, radius: 0, t01: 0 };

/** Latest pulse flash (for rendering at every level). Reused object — copy to keep. */
export function swampGutPulse(ctx: SimContext, partIndex: number, out: SwampPulseView = pulseView): SwampPulseView {
  const data = getAbilityState(ctx).data;
  const base = partIndex * ABILITY_DATA_SLOTS;
  const left = data[base + S_PULSE_LEFT];
  out.active = left > 0;
  out.radius = data[base + S_PULSE_RADIUS];
  out.t01 = out.active ? 1 - left / SWAMP_PULSE_VISUAL_SEC : 0;
  return out;
}

/** Damages and slows every alive enemy within `radius` of (x, y). */
function affectArea(
  ctx: SimContext,
  partIndex: number,
  x: number,
  y: number,
  radius: number,
  damage: number,
  slow: number,
  slowTime: number,
): void {
  const e = ctx.state.enemies;
  const scratch = ctx.scratch;
  const n = ctx.enemyHash.queryRadius(x, y, radius, scratch);
  for (let j = 0; j < n; j++) {
    const id = scratch[j];
    if (!e.isAlive(id)) continue;
    if (slow > 0) {
      e.slowAmt[id] = Math.max(e.slowAmt[id], slow);
      e.slowTimer[id] = Math.max(e.slowTimer[id], slowTime);
    }
    ctx.damage.push(id, damage, partIndex);
  }
}

function pulse(ctx: SimContext, partIndex: number, params: AbilityParams, base: number): void {
  const p = ctx.state.player;
  const radius = Math.max(0, params.radius ?? SWAMP_DEFAULT_RADIUS);
  const slow = Math.min(1, Math.max(0, params.slow ?? SWAMP_DEFAULT_SLOW));
  const duration = Math.max(0, params.duration ?? SWAMP_DEFAULT_DURATION);
  affectArea(ctx, partIndex, p.x, p.y, radius, params.damage, slow, duration);

  const data = getAbilityState(ctx).data;
  data[base + S_PULSE_LEFT] = SWAMP_PULSE_VISUAL_SEC;
  data[base + S_PULSE_RADIUS] = radius;

  if ((params.lingering ?? 0) >= 1 && duration > 0) {
    data[base + S_LEFT] = duration;
    data[base + S_X] = p.x;
    data[base + S_Y] = p.y;
    data[base + S_RADIUS] = radius;
    data[base + S_TICK] = SWAMP_PUDDLE_TICK;
    data[base + S_SLOW] = slow;
  }
}

function tickPuddle(ctx: SimContext, dt: number, partIndex: number, params: AbilityParams, base: number): void {
  const data = getAbilityState(ctx).data;
  if (!(data[base + S_LEFT] > 0)) return;
  data[base + S_LEFT] -= dt;
  if (data[base + S_LEFT] <= 0) {
    data[base + S_LEFT] = 0;
    return;
  }
  data[base + S_TICK] -= dt;
  if (data[base + S_TICK] > 0) return;
  data[base + S_TICK] += SWAMP_PUDDLE_TICK;
  if (data[base + S_TICK] <= 0) data[base + S_TICK] = SWAMP_PUDDLE_TICK;
  affectArea(
    ctx,
    partIndex,
    data[base + S_X],
    data[base + S_Y],
    data[base + S_RADIUS],
    params.damage * SWAMP_PUDDLE_DAMAGE_MULT,
    data[base + S_SLOW],
    SWAMP_PUDDLE_TICK,
  );
}

export const swampGut: AbilityRuntime = {
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
    const base = partIndex * ABILITY_DATA_SLOTS;
    const data = getAbilityState(ctx).data;
    if (data[base + S_PULSE_LEFT] > 0) data[base + S_PULSE_LEFT] = Math.max(0, data[base + S_PULSE_LEFT] - dt);
    tickPuddle(ctx, dt, partIndex, params, base);

    const cd = getAbilityState(ctx).cooldown;
    cd[partIndex] -= dt;
    if (cd[partIndex] > 0) return;
    pulse(ctx, partIndex, params, base);
    const interval = Math.max(0.05, params.cooldown ?? 1);
    cd[partIndex] += interval;
    if (cd[partIndex] <= 0) cd[partIndex] = interval;
  },
};
