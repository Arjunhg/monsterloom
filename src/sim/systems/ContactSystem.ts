/**
 * Enemy body contact → player damage (Req 3.2).
 *
 * Queries ctx.enemyHash around the player (player.radius + CONTACT_QUERY_PAD),
 * and applies the highest contactDmg among overlapping alive enemies once per
 * step via damagePlayer (which ignores hits while invulnerable).
 * Enemy projectiles are handled in ProjectileSystem.
 */
import { damagePlayer } from '../entities';
import type { System } from '../SimContext';

export const CONTACT_QUERY_PAD = 60;

export const contactSystem: System = (ctx) => {
  const state = ctx.state;
  if (state.outcome !== null) return;
  const p = state.player;
  const enemies = state.enemies;
  const scratch = ctx.scratch;
  const n = ctx.enemyHash.queryRadius(p.x, p.y, p.radius + CONTACT_QUERY_PAD, scratch);
  let maxDmg = 0;
  for (let j = 0; j < n; j++) {
    const id = scratch[j];
    if (!enemies.isAlive(id)) continue;
    const dx = enemies.x[id] - p.x;
    const dy = enemies.y[id] - p.y;
    const r = enemies.radius[id] + p.radius;
    if (dx * dx + dy * dy > r * r) continue;
    if (enemies.contactDmg[id] > maxDmg) maxDmg = enemies.contactDmg[id];
  }
  if (maxDmg > 0) damagePlayer(state, maxDmg);
};
