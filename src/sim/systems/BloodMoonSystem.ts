/**
 * BloodMoonSystem (Req 31, task 27): 2–3 seeded 20 s surge windows per night.
 * During a surge the SpawnDirector accrues credits faster (it reads
 * `state.bloodMoon.active`), the sky tints red, and kills pay bonus score
 * (`stats.bonusKills`, shared with Frenzy) plus bonus Bones at run end
 * (`stats.surgeKills` × BLOOD_MOON_BONES_PER_KILL via rewardFor).
 *
 * The schedule is a pure function of the run seed — Daily/Challenge fairness
 * holds because every player on a seed gets identical windows. Runs before
 * SpawnDirector so the active flag is current when credits accrue.
 */
import { EventType } from '../EventBus';
import type { RunState } from '../RunState';
import type { System } from '../SimContext';

export const BLOOD_MOON_SURGE_SEC = 20;
export const BLOOD_MOON_SPAWN_MULT = 1.8;
export const BLOOD_MOON_BONES_PER_KILL = 1;
/** No surge may start before this many seconds into the night. */
export const BLOOD_MOON_FIRST_START_SEC = 45;
/** Last surge must end at least this long before the boss spawns. */
export const BLOOD_MOON_BOSS_CLEARANCE_SEC = 30;

export interface BloodMoonWindow {
  start: number;
  end: number;
}

/** Small deterministic PRNG (mulberry32) for schedule derivation. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Surge windows for a run: 2–3 windows of BLOOD_MOON_SURGE_SEC, start times
 * jittered inside equal slots spanning [FIRST_START, bossAt − CLEARANCE], so
 * windows are sorted, non-overlapping, and clear of the boss by construction.
 */
export function bloodMoonSchedule(seed: number, durationSec: number, bossLeadSec: number): BloodMoonWindow[] {
  const rng = mulberry32((seed ^ 0xb100d) >>> 0);
  const count = rng() < 0.5 ? 2 : 3;
  const lo = BLOOD_MOON_FIRST_START_SEC;
  const hi = Math.max(lo, durationSec - bossLeadSec - BLOOD_MOON_BOSS_CLEARANCE_SEC);
  const slotW = (hi - lo) / count;
  const windows: BloodMoonWindow[] = [];
  for (let i = 0; i < count; i++) {
    const slotStart = lo + i * slotW;
    const jitterRoom = Math.max(0, slotW - BLOOD_MOON_SURGE_SEC);
    const start = Math.floor(slotStart + rng() * jitterRoom);
    windows.push({ start, end: start + BLOOD_MOON_SURGE_SEC });
  }
  return windows;
}

/** Fills `state.bloodMoon.starts` from the schedule when the seed changed. */
function ensureSchedule(state: RunState): void {
  const bm = state.bloodMoon;
  if (bm.seed === state.seed) return;
  bm.seed = state.seed;
  bm.starts.length = 0;
  for (const w of bloodMoonSchedule(state.seed, state.clock.duration, state.config.balance.run.bossLeadSec)) {
    bm.starts.push(w.start);
  }
}

export const bloodMoonSystem: System = (ctx) => {
  const state = ctx.state;
  if (state.outcome !== null) return;
  ensureSchedule(state);
  const bm = state.bloodMoon;
  const t = state.clock.elapsed;

  let active = false;
  for (let i = 0; i < bm.starts.length; i++) {
    if (t >= bm.starts[i] && t < bm.starts[i] + BLOOD_MOON_SURGE_SEC) {
      active = true;
      break;
    }
  }
  if (active !== bm.active) {
    bm.active = active;
    state.events.push(active ? EventType.bloodMoonStarted : EventType.bloodMoonEnded);
  }

  const kills = state.stats.kills;
  const delta = kills > bm.lastKills ? kills - bm.lastKills : 0;
  bm.lastKills = kills;
  if (active && delta > 0) {
    state.stats.bonusKills += delta;
    state.stats.surgeKills += delta;
  }
};
