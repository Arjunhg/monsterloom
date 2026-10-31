/**
 * ClockSystem (design "Systems" #1): advances the run clock and declares
 * victory at dawn when the player is still alive (Req 3.6, 13.1–13.3).
 */
import { EventType } from '../EventBus';
import type { RunState } from '../RunState';
import type { System } from '../SimContext';
import { clamp } from '../math';

export const clockSystem: System = (ctx, dt) => {
  const state = ctx.state;
  if (state.outcome !== null) return;
  const clock = state.clock;
  const step = dt > 0 && Number.isFinite(dt) ? dt : 0;
  clock.elapsed = Math.min(clock.duration, clock.elapsed + step);
  // No-damage streak for the Untouchable achievement (Req 32).
  state.stats.noDamageSec += step;
  if (state.stats.noDamageSec > state.stats.bestNoDamageSec) state.stats.bestNoDamageSec = state.stats.noDamageSec;
  if (clock.elapsed >= clock.duration && state.player.hp > 0) {
    state.outcome = 'victory';
    state.events.push(EventType.runEnded, 1);
  }
};

/** Night→dawn progress in [0, 1]; non-decreasing in `elapsed`. */
export function skyPhase(elapsed: number, duration: number): number {
  if (!(duration > 0)) return 1;
  const p = elapsed / duration;
  return Number.isFinite(p) ? clamp(p, 0, 1) : p > 0 ? 1 : 0;
}

/**
 * Sky brightness in [0, 1] for a phase; monotone non-decreasing.
 * Smoothstep (3p² − 2p³) has a non-negative derivative on [0, 1], so it is monotone.
 */
export function skyBrightness(phase: number): number {
  const p = Number.isNaN(phase) ? 0 : clamp(phase, 0, 1);
  return p * p * (3 - 2 * p);
}

/** Seconds left until dawn (≥ 0). */
export function timeRemaining(state: RunState): number {
  return Math.max(0, state.clock.duration - state.clock.elapsed);
}
