/**
 * Energy orb magnet, collection and cap (Req 7).
 *
 * - Cap (7.5): while orbs.count > balance.orbs.max, the oldest orb's value is
 *   folded into its nearest alive orb and the oldest is freed, so total
 *   uncollected energy is preserved.
 * - Magnet (7.2, 7.4): orbs within pickupRadius × stats.pickupRadius move toward
 *   the player at magnetSpeed (with mild acceleration when close); others stay put.
 * - Collection (7.3): dist ≤ player.radius + ORB_RADIUS → collectEnergy, event, free.
 */
import { EventType } from '../EventBus';
import type { RunState } from '../RunState';
import type { System } from '../SimContext';
import { collectEnergy } from './EnergySystem';

export const ORB_RADIUS = 8;

/** Folds oldest orbs into their nearest neighbour until the count is within the cap. */
export function enforceOrbCap(state: RunState): void {
  const orbs = state.orbs;
  const max = Math.max(0, state.config.balance.orbs.max);
  const ids = orbs.pool.activeIds;
  while (orbs.count > max) {
    const oldest = orbs.oldest();
    if (oldest < 0) return;
    const ox = orbs.x[oldest]!;
    const oy = orbs.y[oldest]!;
    let best = -1;
    let bestD2 = Infinity;
    const n = orbs.count;
    for (let k = 0; k < n; k++) {
      const id = ids[k]!;
      if (id === oldest) continue;
      const dx = orbs.x[id]! - ox;
      const dy = orbs.y[id]! - oy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = id;
      }
    }
    if (best < 0) return; // only one orb left (max = 0): nothing to merge into
    orbs.value[best] = orbs.value[best]! + orbs.value[oldest]!;
    orbs.free(oldest);
  }
}

export const orbSystem: System = (ctx, dt) => {
  const state = ctx.state;
  enforceOrbCap(state);

  const orbs = state.orbs;
  const p = state.player;
  const bal = state.config.balance.orbs;
  const magnetR = p.pickupRadius * p.stats.pickupRadius * (p.viewBoost || 1);
  const magnetR2 = magnetR * magnetR;
  const collectR = p.radius + ORB_RADIUS;
  const collectR2 = collectR * collectR;
  const ids = orbs.pool.activeIds;

  // Iterate backwards: free() swap-removes the last active id into the freed
  // slot, and that id has already been processed.
  for (let k = orbs.count - 1; k >= 0; k--) {
    const id = ids[k]!;
    let dx = p.x - orbs.x[id]!;
    let dy = p.y - orbs.y[id]!;
    let d2 = dx * dx + dy * dy;

    if (d2 <= magnetR2 && d2 > collectR2 && dt > 0) {
      const d = Math.sqrt(d2);
      // Mild acceleration: up to +50% speed as the orb nears the player.
      const speed = bal.magnetSpeed * (1 + 0.5 * (1 - d / Math.max(magnetR, 1e-6)));
      const step = Math.min(d, speed * dt);
      orbs.x[id] = orbs.x[id]! + (dx / d) * step;
      orbs.y[id] = orbs.y[id]! + (dy / d) * step;
      dx = p.x - orbs.x[id]!;
      dy = p.y - orbs.y[id]!;
      d2 = dx * dx + dy * dy;
    }

    if (d2 <= collectR2) {
      const value = orbs.value[id]!;
      const x = orbs.x[id]!;
      const y = orbs.y[id]!;
      orbs.free(id);
      collectEnergy(state, value * (p.viewBoost || 1));
      state.events.push(EventType.orbCollected, value, x, y);
    }
  }
};
