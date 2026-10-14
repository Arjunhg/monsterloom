/**
 * Fangs (piercing, Req 11.1): on cooldown fires `count` fang darts spread
 * evenly across a fan of `spread` degrees (total width) centred on the
 * Auto_Aim direction. Each dart pierces `pierce` enemies.
 */
import type { AbilityParams } from '../../data/bodyParts';
import type { MutVec2 } from '../math';
import { PROJECTILE_SIDE } from '../RunState';
import type { SimContext } from '../SimContext';
import { spawnProjectile } from '../systems/ProjectileSystem';
import { autoAim } from './autoAim';
import type { AbilityRuntime } from './types';
import { getAbilityState } from './types';

export const FANG_RADIUS = 6;
export const FANG_DEFAULT_SPEED = 420;
/** Targeting range and travel distance when `range` is absent (fangs data defines none). */
export const FANG_DEFAULT_RANGE = 380;
export const FANG_DEFAULT_SPREAD_DEG = 20;

const aim: MutVec2 = { x: 1, y: 0 };

function fire(ctx: SimContext, partIndex: number, params: AbilityParams): void {
  const p = ctx.state.player;
  const range = params.range ?? FANG_DEFAULT_RANGE;
  const speed = params.speed ?? FANG_DEFAULT_SPEED;
  const count = Math.max(1, Math.floor(params.count ?? 1));
  const pierce = Math.max(0, Math.floor(params.pierce ?? 0));
  const lifetime = speed > 0 ? range / speed : 0;
  const spread = ((params.spread ?? FANG_DEFAULT_SPREAD_DEG) * Math.PI) / 180;

  autoAim(ctx, range, aim);
  const baseAngle = Math.atan2(aim.y, aim.x);
  for (let i = 0; i < count; i++) {
    const a = count === 1 ? baseAngle : baseAngle + (i / (count - 1) - 0.5) * spread;
    const id = spawnProjectile(
      ctx,
      PROJECTILE_SIDE.PLAYER,
      partIndex,
      p.x,
      p.y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      FANG_RADIUS,
      params.damage,
      pierce,
      lifetime,
    );
    if (id < 0) return;
  }
}

export const fangs: AbilityRuntime = {
  onEquip(ctx, partIndex) {
    getAbilityState(ctx).cooldown[partIndex] = 0;
  },
  onLevel() {
    // All level effects come from params.
  },
  tick(ctx, dt, partIndex, params) {
    const cd = getAbilityState(ctx).cooldown;
    cd[partIndex] -= dt;
    if (cd[partIndex] > 0) return;
    fire(ctx, partIndex, params);
    const interval = Math.max(0.05, params.cooldown ?? 1);
    cd[partIndex] += interval;
    if (cd[partIndex] <= 0) cd[partIndex] = interval;
  },
};
