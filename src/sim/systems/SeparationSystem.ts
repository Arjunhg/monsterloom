/**
 * SeparationSystem (design "Systems" #6; Req 6.2, 22.4).
 *
 * Pushes overlapping enemies apart using ctx.enemyHash (rebuilt by
 * SpatialIndexSystem this step). Each enemy considers at most
 * MAX_SEP_NEIGHBOURS overlapping neighbours and moves by half of the summed
 * overlap (its neighbour moves the other half when it is processed). Enemies
 * flagged NO_SEP (ghosts) neither move nor push others.
 *
 * Pushes are computed for every enemy first and applied afterwards, so the
 * result is independent of iteration order and fully deterministic (no RNG).
 * Coincident pairs separate along a direction derived from their ids.
 */
import type { System } from '../SimContext';
import { ENEMY_FLAG } from '../RunState';

/** Largest enemy radius expected as a neighbour; widens the query to catch big neighbours. */
export const MAX_NEIGHBOUR_RADIUS = 40;
export const MAX_SEP_NEIGHBOURS = 6;

const DEG_TO_RAD = Math.PI / 180;

// Reused push buffers, grown to the store capacity on first use.
let pushX = new Float32Array(0);
let pushY = new Float32Array(0);

/** Deterministic unit direction for coincident ids lo < hi (points from hi towards lo's side). */
function coincidentAngle(lo: number, hi: number): number {
  const h = (Math.imul(lo, 2654435761 | 0) + Math.imul(hi, 40503)) >>> 0;
  return (h % 360) * DEG_TO_RAD;
}

export const separationSystem: System = (ctx) => {
  const e = ctx.state.enemies;
  const n = e.pool.count;
  if (n < 2) return;
  if (pushX.length < e.capacity) {
    pushX = new Float32Array(e.capacity);
    pushY = new Float32Array(e.capacity);
  }
  const ids = e.pool.activeIds;
  const out = ctx.scratch;
  const hash = ctx.enemyHash;

  for (let k = 0; k < n; k++) {
    const i = ids[k];
    pushX[i] = 0;
    pushY[i] = 0;
    if (e.flags[i] & ENEMY_FLAG.NO_SEP) continue;
    const xi = e.x[i];
    const yi = e.y[i];
    const ri = e.radius[i];
    const found = hash.queryRadius(xi, yi, ri + MAX_NEIGHBOUR_RADIUS, out);
    let used = 0;
    let px = 0;
    let py = 0;
    for (let q = 0; q < found && used < MAX_SEP_NEIGHBOURS; q++) {
      const j = out[q]!;
      if (j === i || !e.isAlive(j) || e.flags[j] & ENEMY_FLAG.NO_SEP) continue;
      const dx = xi - e.x[j];
      const dy = yi - e.y[j];
      const minD = ri + e.radius[j];
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      used++;
      const d = Math.sqrt(d2);
      const overlap = minD - d;
      let ux: number;
      let uy: number;
      if (d > 1e-6) {
        ux = dx / d;
        uy = dy / d;
      } else {
        const lo = i < j ? i : j;
        const hi = i < j ? j : i;
        const a = coincidentAngle(lo, hi);
        const sign = i === lo ? 1 : -1;
        ux = Math.cos(a) * sign;
        uy = Math.sin(a) * sign;
      }
      px += ux * overlap * 0.5;
      py += uy * overlap * 0.5;
    }
    // Clamp the per-step push to the enemy's radius.
    const len = Math.hypot(px, py);
    if (len > ri && len > 0) {
      const s = ri / len;
      px *= s;
      py *= s;
    }
    pushX[i] = px;
    pushY[i] = py;
  }

  for (let k = 0; k < n; k++) {
    const i = ids[k];
    e.x[i] += pushX[i];
    e.y[i] += pushY[i];
  }
};
