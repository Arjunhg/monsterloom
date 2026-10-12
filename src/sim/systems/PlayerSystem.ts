/**
 * PlayerSystem (design "Systems" #2): moves the player from the analog input
 * vector and ticks down invulnerability (Req 2, 3.3).
 * Player damage/heal goes through damagePlayer/healPlayer in SimContext.
 */
import type { System } from '../SimContext';

export interface MoveInput {
  x: number;
  y: number;
}

export function createPlayerSystem(getInput: () => MoveInput): System {
  return (ctx, dt) => {
    const state = ctx.state;
    if (state.outcome !== null) return;
    const p = state.player;
    const step = dt > 0 && Number.isFinite(dt) ? dt : 0;

    p.prevX = p.x;
    p.prevY = p.y;

    const input = getInput();
    let ix = Number.isFinite(input.x) ? input.x : 0;
    let iy = Number.isFinite(input.y) ? input.y : 0;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }

    const speed = p.speed * p.stats.moveSpeed;
    p.vx = ix * speed;
    p.vy = iy * speed;
    p.x += p.vx * step;
    p.y += p.vy * step;

    if (len > 0) {
      const n = Math.hypot(ix, iy);
      p.lastDirX = ix / n;
      p.lastDirY = iy / n;
    }

    if (p.invuln > 0) {
      p.invuln -= step;
      // Snap float residue so the window ends exactly after invulnSec.
      if (p.invuln < 1e-9) p.invuln = 0;
    }
  };
}
