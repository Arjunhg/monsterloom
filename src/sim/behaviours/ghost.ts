/**
 * Ghost behaviour (Req 22.4): chaser plus a sideways sine wobble.
 *
 * lateral velocity = wobbleAmp × sin(2π × wobbleHz × t + phase), perpendicular to
 * the direction toward the player; t = clock.elapsed, phase = ghostPhase(id).
 * slowAmt scales both components. Separation / merge skip ghosts via
 * ENEMY_FLAG.NO_SEP / NO_MERGE (set at spawn from the type).
 */
import type { BehaviourFn } from '../systems/EnemyAISystem';
import { param } from './shared';

/** Deterministic per-id wobble phase (golden-angle spread so neighbours desync). */
export function ghostPhase(id: number): number {
  return (id * 2.399963229728653) % (Math.PI * 2);
}

export const ghostBehaviour: BehaviourFn = (ctx, id) => {
  const e = ctx.state.enemies;
  const p = ctx.state.player;
  const dx = p.x - e.x[id];
  const dy = p.y - e.y[id];
  const d = Math.hypot(dx, dy);
  if (!(d > 1e-6)) {
    e.vx[id] = e.vy[id] = 0;
    return;
  }
  const ux = dx / d;
  const uy = dy / d;
  const slow = 1 - e.slowAmt[id];
  const amp = param(ctx, id, 'wobbleAmp', 60);
  const hz = param(ctx, id, 'wobbleHz', 1.2);
  const lateral = amp * Math.sin(2 * Math.PI * hz * ctx.state.clock.elapsed + ghostPhase(id));
  const fwd = e.speed[id];
  // Perpendicular (−uy, ux).
  e.vx[id] = (ux * fwd - uy * lateral) * slow;
  e.vy[id] = (uy * fwd + ux * lateral) * slow;
};
