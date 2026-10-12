/**
 * SpatialIndexSystem (design "Systems" #5; Req 16.3): rebuilds ctx.enemyHash
 * from every alive enemy once per step, after enemy movement.
 */
import type { System } from '../SimContext';

export const spatialIndexSystem: System = (ctx) => {
  const hash = ctx.enemyHash;
  const e = ctx.state.enemies;
  const ids = e.pool.activeIds;
  hash.clear();
  for (let k = 0, n = e.pool.count; k < n; k++) {
    const id = ids[k];
    hash.insert(id, e.x[id], e.y[id]);
  }
};
