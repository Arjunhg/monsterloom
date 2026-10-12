/**
 * Energy accumulation and level-up thresholds (Req 8, design "Energy, Orbs and Thresholds").
 *
 * - collectEnergy(): pure state update used by OrbSystem on orb pickup.
 * - energySystem: opens the upgrade menu (paused = 'menu') while level-ups or
 *   tokens are pending.
 * - resolveLevelUp()/resolveToken(): called by the UpgradeScene after each pick;
 *   the run resumes once nothing is pending.
 */
import { thresholdFor } from '../../data/balance';
import { EventType } from '../EventBus';
import { clamp } from '../math';
import type { RunState } from '../RunState';
import type { System } from '../SimContext';

/** Adds `value` energy, converting every full threshold into a pending level-up (8.1, 8.2, 8.4). */
export function collectEnergy(state: RunState, value: number): void {
  if (!(value > 0) || !Number.isFinite(value)) return;
  const e = state.energy;
  const bal = state.config.balance;
  e.value += value;
  let t = thresholdFor(e.levelUps, bal);
  while (t > 0 && e.value >= t) {
    e.value -= t;
    e.levelUps++;
    e.pendingLevelUps++;
    state.events.push(EventType.levelUp, e.levelUps);
    t = thresholdFor(e.levelUps, bal);
  }
}

/** Energy bar fill in [0, 1] (8.5). */
export function fillFraction(state: RunState): number {
  const t = thresholdFor(state.energy.levelUps, state.config.balance);
  if (!(t > 0)) return 1;
  return clamp(state.energy.value / t, 0, 1);
}

/** Pauses the run for the upgrade menu while level-ups or tokens are pending. */
export const energySystem: System = (ctx) => {
  const s = ctx.state;
  if (s.outcome !== null) return;
  if (s.energy.pendingLevelUps > 0 || s.energy.pendingTokens > 0) s.paused = 'menu';
};

function maybeResume(state: RunState): void {
  if (state.energy.pendingLevelUps === 0 && state.energy.pendingTokens === 0 && state.paused === 'menu') {
    state.paused = false;
  }
}

/** Consumes one pending level-up; unpauses when nothing is pending. */
export function resolveLevelUp(state: RunState): void {
  if (state.energy.pendingLevelUps > 0) state.energy.pendingLevelUps--;
  maybeResume(state);
}

/** Consumes one pending Upgrade_Token; unpauses when nothing is pending (22.8). */
export function resolveToken(state: RunState): void {
  if (state.energy.pendingTokens > 0) state.energy.pendingTokens--;
  maybeResume(state);
}
