/**
 * Swarm steering overrides (Req 23.2–23.4). Registered by installSwarmBehaviours().
 *
 * ringInward (code 6):
 *   moves toward the ring centre (aiDirX, aiDirY) at speed × RING_SPEED_MULT × (1 − slowAmt).
 *   aiTimer counts seconds up. Within RING_ARRIVE_DIST of the centre or after
 *   RING_MAX_SEC it reverts to the type's own behaviour (aiState/aiTimer/aiDir
 *   zeroed, SWARM cleared, NO_MERGE restored to the type's default).
 * stampede (code 7):
 *   velocity = aiDir × speed × STAMPEDE_SPEED_MULT every step (ignores slow; no
 *   steering, so bats in a stampede never telegraph). aiTimer accumulates the
 *   distance travelled; past (view span along the travel axis) +
 *   2 × marginMax + STAMPEDE_EXIT_PAD it is freed (no kill, no orb, no event).
 *   The axis is the dominant component of aiDir. aiState stays 0 so renderers that
 *   read the bat aiState contract (1 = telegraph) never show a telegraph.
 */
import { BEHAVIOUR_CODE } from '../entities';
import { ENEMY_FLAG } from '../RunState';
import { registerBehaviour, type BehaviourFn } from '../systems/EnemyAISystem';

export const RING_SPEED_MULT = 1.1;
export const RING_ARRIVE_DIST = 60;
export const RING_MAX_SEC = 12;
export const STAMPEDE_SPEED_MULT = 2.2;
/** Extra distance (px) a stampede member runs past the far edge before it is freed. */
export const STAMPEDE_EXIT_PAD = 200;

/** Distance a stampede member travels before it is freed. */
export function stampedeTravel(viewSpan: number, marginMax: number): number {
  return viewSpan + 2 * marginMax + STAMPEDE_EXIT_PAD;
}

export const ringInwardBehaviour: BehaviourFn = (ctx, id, dt) => {
  const state = ctx.state;
  const e = state.enemies;
  e.aiTimer[id] += dt;
  const dx = e.aiDirX[id] - e.x[id];
  const dy = e.aiDirY[id] - e.y[id];
  const d = Math.hypot(dx, dy);
  if (d <= RING_ARRIVE_DIST || e.aiTimer[id] >= RING_MAX_SEC) {
    const type = state.config.enemies[e.typeId[id]];
    e.behaviour[id] = type ? BEHAVIOUR_CODE[type.behaviour] : BEHAVIOUR_CODE.chaser;
    e.aiState[id] = 0;
    e.aiTimer[id] = 0;
    e.aiDirX[id] = 0;
    e.aiDirY[id] = 0;
    e.flags[id] &= ~ENEMY_FLAG.SWARM;
    if (type?.canMerge && !(e.flags[id] & (ENEMY_FLAG.ELITE | ENEMY_FLAG.BOSS))) e.flags[id] &= ~ENEMY_FLAG.NO_MERGE;
    // Keep the current velocity this step; the type's behaviour steers from the next one.
    return;
  }
  const s = (e.speed[id] * RING_SPEED_MULT * (1 - e.slowAmt[id])) / d;
  e.vx[id] = dx * s;
  e.vy[id] = dy * s;
};

export const stampedeBehaviour: BehaviourFn = (ctx, id, dt) => {
  const e = ctx.state.enemies;
  const v = e.speed[id] * STAMPEDE_SPEED_MULT;
  e.vx[id] = e.aiDirX[id] * v;
  e.vy[id] = e.aiDirY[id] * v;
  e.aiTimer[id] += v * dt;
  const span = Math.abs(e.aiDirX[id]) >= Math.abs(e.aiDirY[id]) ? ctx.view.width : ctx.view.height;
  if (e.aiTimer[id] > stampedeTravel(span, ctx.state.config.balance.spawn.marginMax)) {
    e.vx[id] = e.vy[id] = 0;
    e.free(id);
  }
};

/** Registers the ringInward/stampede steering functions. Idempotent. */
export function installSwarmBehaviours(): void {
  registerBehaviour(BEHAVIOUR_CODE.ringInward, ringInwardBehaviour);
  registerBehaviour(BEHAVIOUR_CODE.stampede, stampedeBehaviour);
}
