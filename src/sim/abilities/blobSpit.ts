/**
 * Blob Spit (starter, Req 4.1–4.4): on cooldown fires `count` globs toward the
 * Auto_Aim target (nearest enemy within `range`, else lastDir). Multiple globs
 * fan out symmetrically by `spread` degrees (default 10°) between neighbours.
 */
import type { AbilityParams } from '../../data/bodyParts';
import type { MutVec2 } from '../math';
import { PROJECTILE_SIDE } from '../RunState';
import type { SimContext } from '../SimContext';
import { spawnProjectile } from '../systems/ProjectileSystem';
import { autoAim } from './autoAim';
import type { AbilityRuntime } from './types';
import { getAbilityState } from './types';

export const BLOB_RADIUS = 8;
export const BLOB_DEFAULT_SPEED = 520;
export const BLOB_DEFAULT_RANGE = 420;
export const BLOB_DEFAULT_SPREAD_DEG = 10;

const aim: MutVec2 = { x: 1, y: 0 };

function fire(ctx: SimContext, partIndex: number, params: AbilityParams): void {
  const p = ctx.state.player;
  const range = params.range ?? BLOB_DEFAULT_RANGE;
  const speed = params.speed ?? BLOB_DEFAULT_SPEED;
  const count = Math.max(1, Math.floor(params.count ?? 1));
  const pierce = Math.max(0, Math.floor(params.pierce ?? 0));
  const lifetime = speed > 0 ? range / speed : 0;
  const step = ((params.spread ?? BLOB_DEFAULT_SPREAD_DEG) * Math.PI) / 180;

  autoAim(ctx, range, aim);
  const baseAngle = Math.atan2(aim.y, aim.x);
  for (let i = 0; i < count; i++) {
    const a = baseAngle + (i - (count - 1) / 2) * step;
    const id = spawnProjectile(
      ctx,
      PROJECTILE_SIDE.PLAYER,
      partIndex,
      p.x,
      p.y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      BLOB_RADIUS,
      params.damage,
      pierce,
      lifetime,
    );
    if (id < 0) return; // store full
  }
}

export const blobSpit: AbilityRuntime = {
  onEquip(ctx, partIndex) {
    // Fire on the first owned tick.
    getAbilityState(ctx).cooldown[partIndex] = 0;
  },
  onLevel() {
    // All level effects come from params; nothing to rebuild.
  },
  tick(ctx, dt, partIndex, params) {
    const cd = getAbilityState(ctx).cooldown;
    cd[partIndex] -= dt;
    if (cd[partIndex] > 0) return;
    fire(ctx, partIndex, params);
    const interval = Math.max(0.05, params.cooldown ?? 1);
    cd[partIndex] += interval;
    if (cd[partIndex] <= 0) cd[partIndex] = interval; // long dt: don't burst-fire
  },
};
