/**
 * FrenzySystem (Req 30, task 26): kills charge a meter; at full charge a
 * short power window activates (+damage, +move speed, kills count double
 * toward score via `stats.bonusKills`). Runs right after DamageSystem so it
 * can diff `stats.kills`. Fully deterministic: no RNG, no wall-clock.
 *
 * Stat application: on activation the current (capped, bonused) damage and
 * moveSpeed multipliers are saved and scaled; on expiry they are restored
 * exactly, so Req 12/26 caps are untouched outside the window.
 */
import { EventType } from '../EventBus';
import type { RunState } from '../RunState';
import type { System } from '../SimContext';

export const FRENZY_METER_MAX = 100;
export const FRENZY_CHARGE_PER_KILL = 4;
export const FRENZY_DECAY_PER_SEC = 3;
export const FRENZY_WINDOW_SEC = 5;
export const FRENZY_DAMAGE_MULT = 1.5;
export const FRENZY_SPEED_MULT = 1.25;

export interface FrenzyView {
  /** Meter charge 0..FRENZY_METER_MAX (full while active). */
  meter: number;
  /** Meter as a 0..1 fraction for bars. */
  meter01: number;
  active: boolean;
  /** Active-window progress 0..1 (0 while inactive). */
  activeT01: number;
}

const view: FrenzyView = { meter: 0, meter01: 0, active: false, activeT01: 0 };

/** Render/test view of the Frenzy state. Reused object — copy to keep. */
export function frenzyView(state: RunState, out: FrenzyView = view): FrenzyView {
  const f = state.frenzy;
  out.active = f.activeLeft > 0;
  out.meter = out.active ? FRENZY_METER_MAX : f.meter;
  out.meter01 = out.meter / FRENZY_METER_MAX;
  out.activeT01 = out.active ? 1 - f.activeLeft / FRENZY_WINDOW_SEC : 0;
  return out;
}

function activate(state: RunState): void {
  const f = state.frenzy;
  const stats = state.player.stats;
  f.savedDamage = stats.damage;
  f.savedMoveSpeed = stats.moveSpeed;
  stats.damage = f.savedDamage * FRENZY_DAMAGE_MULT;
  stats.moveSpeed = f.savedMoveSpeed * FRENZY_SPEED_MULT;
  f.activeLeft = FRENZY_WINDOW_SEC;
  state.events.push(EventType.frenzyStarted);
}

function deactivate(state: RunState): void {
  const f = state.frenzy;
  const stats = state.player.stats;
  stats.damage = f.savedDamage;
  stats.moveSpeed = f.savedMoveSpeed;
  f.activeLeft = 0;
  f.meter = 0;
  state.events.push(EventType.frenzyEnded);
}

export const frenzySystem: System = (ctx, dt) => {
  const state = ctx.state;
  if (state.outcome !== null) return;
  const step = dt > 0 && Number.isFinite(dt) ? dt : 0;
  const f = state.frenzy;

  const kills = state.stats.kills;
  const delta = kills > f.lastKills ? kills - f.lastKills : 0;
  f.lastKills = kills;

  if (f.activeLeft > 0) {
    state.stats.bonusKills += delta;
    f.activeLeft -= step;
    if (f.activeLeft <= 0) deactivate(state);
    return;
  }

  f.meter += delta * FRENZY_CHARGE_PER_KILL;
  if (delta === 0) f.meter -= FRENZY_DECAY_PER_SEC * step;
  if (f.meter >= FRENZY_METER_MAX) {
    f.meter = FRENZY_METER_MAX;
    activate(state);
  } else if (f.meter < 0) {
    f.meter = 0;
  }
};
