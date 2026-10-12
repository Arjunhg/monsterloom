/**
 * EnemyAISystem (design "Systems" #4, "Enemy behaviours"; Req 6.1).
 *
 * Per alive enemy, each fixed step:
 * 1. prevX/prevY ← x/y (render interpolation).
 * 2. Tick slowTimer (slowAmt cleared at 0) and stun.
 * 3. If stunned: no steering; existing vx/vy is damped (lets abilities hurl enemies).
 *    Otherwise: dispatch BEHAVIOURS[behaviourCode] (falls back to chaser).
 * 4. Integrate x += vx·dt, y += vy·dt.
 */
import type { SimContext, System } from '../SimContext';
import { BEHAVIOUR_CODE } from '../entities';

/** Steering function: writes enemies.vx/vy[id] (and may use aiState/aiTimer/aiDir). */
export type BehaviourFn = (ctx: SimContext, id: number, dt: number) => void;

/** Per-step velocity damping applied while an enemy is stunned. */
export const STUN_DAMPING = 0.9;

/** Chaser (6.1): vel = normalize(player − pos) · speed · (1 − slowAmt). Zero-distance safe. */
export const chaserBehaviour: BehaviourFn = (ctx, id) => {
  const e = ctx.state.enemies;
  const p = ctx.state.player;
  const dx = p.x - e.x[id];
  const dy = p.y - e.y[id];
  const d = Math.hypot(dx, dy);
  if (!(d > 1e-6)) {
    e.vx[id] = 0;
    e.vy[id] = 0;
    return;
  }
  const s = (e.speed[id] * (1 - e.slowAmt[id])) / d;
  e.vx[id] = dx * s;
  e.vy[id] = dy * s;
};

/** Behaviour table indexed by BEHAVIOUR_CODE. Unregistered codes fall back to chaser. */
export const BEHAVIOURS: Array<BehaviourFn | undefined> = [];
BEHAVIOURS[BEHAVIOUR_CODE.chaser] = chaserBehaviour;

/** Registers (or replaces) the steering function for a behaviour code (v2 behaviours). */
export function registerBehaviour(code: number, fn: BehaviourFn): void {
  BEHAVIOURS[code] = fn;
}

export const enemyAISystem: System = (ctx, dt) => {
  const state = ctx.state;
  if (state.outcome !== null) return;
  const e = state.enemies;
  const ids = e.pool.activeIds;
  // Iterate a snapshot from the end so a behaviour may safely free the current id.
  for (let k = e.pool.count - 1; k >= 0; k--) {
    if (k >= e.pool.count) continue;
    const id = ids[k];

    e.prevX[id] = e.x[id];
    e.prevY[id] = e.y[id];

    if (e.slowTimer[id] > 0) {
      e.slowTimer[id] = Math.max(0, e.slowTimer[id] - dt);
      if (e.slowTimer[id] === 0) e.slowAmt[id] = 0;
    }

    if (e.stun[id] > 0) {
      e.stun[id] = Math.max(0, e.stun[id] - dt);
      e.vx[id] *= STUN_DAMPING;
      e.vy[id] *= STUN_DAMPING;
    } else {
      const fn = BEHAVIOURS[e.behaviour[id]] ?? chaserBehaviour;
      fn(ctx, id, dt);
      if (!e.isAlive(id)) continue;
    }

    e.x[id] += e.vx[id] * dt;
    e.y[id] += e.vy[id] * dt;
  }
};
