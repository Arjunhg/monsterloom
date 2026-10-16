/** Small helpers shared by the v2 enemy behaviours. */
import type { EnemyType } from '../../data/enemies';
import type { SimContext } from '../SimContext';

/** Reads behaviourParams[key] of the enemy's type, or `fallback` when missing / non-finite. */
export function param(ctx: SimContext, id: number, key: string, fallback: number): number {
  const type: EnemyType | undefined = ctx.state.config.enemies[ctx.state.enemies.typeId[id]];
  const v = type?.behaviourParams?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Writes a chaser velocity (toward the player at speed·(1 − slowAmt)). Returns the distance to the player. */
export function steerToPlayer(ctx: SimContext, id: number, speedMul = 1): number {
  const e = ctx.state.enemies;
  const p = ctx.state.player;
  const dx = p.x - e.x[id];
  const dy = p.y - e.y[id];
  const d = Math.hypot(dx, dy);
  if (!(d > 1e-6)) {
    e.vx[id] = 0;
    e.vy[id] = 0;
    return 0;
  }
  const s = (e.speed[id] * speedMul * (1 - e.slowAmt[id])) / d;
  e.vx[id] = dx * s;
  e.vy[id] = dy * s;
  return d;
}
