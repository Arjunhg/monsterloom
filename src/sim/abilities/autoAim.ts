/**
 * Auto_Aim (Req 4.2–4.3): nearest alive enemy within range, else the
 * player's last movement direction.
 */
import type { MutVec2 } from '../math';
import type { SimContext } from '../SimContext';

/**
 * Writes the unit aim direction into `out` and returns the target enemy id,
 * or −1 (direction = player's lastDir) when no alive enemy is within `range`.
 * Uses ctx.enemyHash, so it sees positions from the latest SpatialIndex rebuild.
 */
export function autoAim(ctx: SimContext, range: number, out: MutVec2): number {
  const p = ctx.state.player;
  const enemies = ctx.state.enemies;
  const id = ctx.enemyHash.nearest(p.x, p.y, range, (eid) => enemies.isAlive(eid));
  if (id >= 0) {
    const dx = enemies.x[id] - p.x;
    const dy = enemies.y[id] - p.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6 && Number.isFinite(len)) {
      out.x = dx / len;
      out.y = dy / len;
      return id;
    }
    // Enemy exactly on the player: keep the target, aim along lastDir.
    writeLastDir(ctx, out);
    return id;
  }
  writeLastDir(ctx, out);
  return -1;
}

function writeLastDir(ctx: SimContext, out: MutVec2): void {
  const p = ctx.state.player;
  const len = Math.hypot(p.lastDirX, p.lastDirY);
  if (len > 1e-6 && Number.isFinite(len)) {
    out.x = p.lastDirX / len;
    out.y = p.lastDirY / len;
  } else {
    out.x = 1;
    out.y = 0;
  }
}
