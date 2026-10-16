/**
 * Bat behaviour (Req 22.3).
 *
 * aiState contract (renderers read this):
 * - 0 BAT_APPROACH: chaser until within BAT_TRIGGER_DIST of the player.
 * - 1 BAT_TELEGRAPH: vx = vy = 0 for telegraphSec (aiTimer counts down);
 *   aiDirX/aiDirY = unit vector toward the player at telegraph start (locked).
 * - 2 BAT_CHARGE: velocity = aiDir × speed × chargeMult, no steering.
 *   aiTimer counts the distance travelled up from 0; once it exceeds
 *   BAT_DESPAWN_VIEW_MULT × view diagonal the bat is freed (no kill, no orb).
 */
import type { BehaviourFn } from '../systems/EnemyAISystem';
import { param, steerToPlayer } from './shared';

export const BAT_APPROACH = 0;
export const BAT_TELEGRAPH = 1;
export const BAT_CHARGE = 2;
/** Distance (px) at which an approaching bat starts its telegraph. */
export const BAT_TRIGGER_DIST = 420;
/** Charging bats despawn after travelling this many view diagonals. */
export const BAT_DESPAWN_VIEW_MULT = 1.6;
/** Tolerance for float32 timer accumulation. */
const TIMER_EPS = 1e-4;

export const batBehaviour: BehaviourFn = (ctx, id, dt) => {
  const e = ctx.state.enemies;
  const p = ctx.state.player;
  const st = e.aiState[id];

  if (st === BAT_CHARGE) {
    const mult = param(ctx, id, 'chargeMult', 3);
    const v = e.speed[id] * mult;
    // Re-asserted every step so a stun knock-back doesn't permanently bend the charge.
    e.vx[id] = e.aiDirX[id] * v;
    e.vy[id] = e.aiDirY[id] * v;
    e.aiTimer[id] += v * dt;
    if (e.aiTimer[id] > BAT_DESPAWN_VIEW_MULT * Math.hypot(ctx.view.width, ctx.view.height)) {
      e.vx[id] = e.vy[id] = 0;
      e.free(id);
    }
    return;
  }

  if (st === BAT_TELEGRAPH) {
    e.vx[id] = e.vy[id] = 0;
    e.aiTimer[id] -= dt;
    if (e.aiTimer[id] <= TIMER_EPS) {
      e.aiState[id] = BAT_CHARGE;
      e.aiTimer[id] = 0;
      const v = e.speed[id] * param(ctx, id, 'chargeMult', 3);
      e.vx[id] = e.aiDirX[id] * v;
      e.vy[id] = e.aiDirY[id] * v;
    }
    return;
  }

  // Approach.
  const dx = p.x - e.x[id];
  const dy = p.y - e.y[id];
  const d = Math.hypot(dx, dy);
  if (d <= BAT_TRIGGER_DIST) {
    e.aiState[id] = BAT_TELEGRAPH;
    e.aiTimer[id] = param(ctx, id, 'telegraphSec', 0.75);
    if (d > 1e-6) {
      e.aiDirX[id] = dx / d;
      e.aiDirY[id] = dy / d;
    } else {
      e.aiDirX[id] = 1;
      e.aiDirY[id] = 0;
    }
    e.vx[id] = e.vy[id] = 0;
    return;
  }
  steerToPlayer(ctx, id);
};
