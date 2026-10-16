/**
 * Upgrade_Token drops and pickup (Req 22.7, 22.8, 21.4).
 *
 * - installEliteTokenDrops(): registers (once) an onEnemyKilled hook that drops
 *   one token at an ELITE enemy's position. If the token store is full the drop
 *   is skipped.
 * - tokenSystem: tokens within the player's effective pickup radius move toward
 *   the player at balance.orbs.magnetSpeed; at dist ≤ player.radius + TOKEN_RADIUS
 *   the token is collected: energy.pendingTokens++, tokenCollected(x, y), free.
 *   Energy value / level-ups are never touched (22.8); EnergySystem then opens
 *   the upgrade menu. Skipped once the run has an outcome.
 */
import { playerPickupRadius } from '../entities';
import { EventType } from '../EventBus';
import { ENEMY_FLAG } from '../RunState';
import type { SimContext, System } from '../SimContext';
import { onEnemyKilled, type EnemyKilledHook } from './DamageSystem';

export const TOKEN_RADIUS = 14;

/** Kill hook: one token per killed Elite. */
export const eliteTokenDrop: EnemyKilledHook = (ctx: SimContext, id: number) => {
  const state = ctx.state;
  const e = state.enemies;
  if (!(e.flags[id] & ENEMY_FLAG.ELITE)) return;
  const tokens = state.tokens;
  const t = tokens.alloc();
  if (t < 0) return; // store full: skip
  tokens.x[t] = e.x[id];
  tokens.y[t] = e.y[id];
};

/** Registers the elite token drop hook. Idempotent. */
export function installEliteTokenDrops(): void {
  if (!onEnemyKilled.includes(eliteTokenDrop)) onEnemyKilled.push(eliteTokenDrop);
}

export const tokenSystem: System = (ctx, dt) => {
  const state = ctx.state;
  if (state.outcome !== null) return;
  const tokens = state.tokens;
  if (tokens.count === 0) return;

  const p = state.player;
  const magnetR = playerPickupRadius(state);
  const magnetR2 = magnetR * magnetR;
  const collectR = p.radius + TOKEN_RADIUS;
  const collectR2 = collectR * collectR;
  const speed = state.config.balance.orbs.magnetSpeed;
  const ids = tokens.pool.activeIds;

  // Backwards: free() swap-removes the last active id into the freed slot (already visited).
  for (let k = tokens.count - 1; k >= 0; k--) {
    const id = ids[k]!;
    let dx = p.x - tokens.x[id]!;
    let dy = p.y - tokens.y[id]!;
    let d2 = dx * dx + dy * dy;

    if (d2 <= magnetR2 && d2 > collectR2 && dt > 0) {
      const d = Math.sqrt(d2);
      const step = Math.min(d, speed * dt);
      tokens.x[id] = tokens.x[id]! + (dx / d) * step;
      tokens.y[id] = tokens.y[id]! + (dy / d) * step;
      dx = p.x - tokens.x[id]!;
      dy = p.y - tokens.y[id]!;
      d2 = dx * dx + dy * dy;
    }

    if (d2 <= collectR2) {
      const x = tokens.x[id]!;
      const y = tokens.y[id]!;
      tokens.free(id);
      state.energy.pendingTokens++;
      state.events.push(EventType.tokenCollected, x, y);
    }
  }
};
