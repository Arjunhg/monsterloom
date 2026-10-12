/**
 * SpawnDirector (design "SpawnDirector", Req 5, 12.2).
 *
 * Per step (skipped once the run has an outcome), in this order:
 *  1. Despawn: alive non-boss enemies farther than despawnMul × view diagonal
 *     from the player are freed (no kill, no orb, no event) (5.7).
 *  2. Stages: every stage whose atSec ≤ elapsed and not yet applied is applied
 *     once (director.stageIdx = number of applied stages). Its types join the
 *     pool; the first time a type id is added, behaviourIntroduced fires with
 *     the type index (5.5, 22.1). Pool = union of addTypes of stages[0..stageIdx).
 *  3. Credits: credits += creditRate(elapsed) · dt, then capped at
 *     balance.credits.maxCarry + (max threatCost in pool). The cap bounds the
 *     carry-over so that spawned cost over any window ≤ ∫creditRate + cap (5.3, 5.4).
 *  4. Spawning: while credits ≥ cheapest cost in pool and active < maxActive,
 *     pick a type uniformly (weight 1) from the whole pool via rng.spawn. If it
 *     costs more than the current credits it stays pending and the director
 *     saves up (otherwise cheap types would always consume credits first and
 *     costlier types would never appear). Once affordable: spend, spawn (5.6).
 *
 * Position (5.1, 5.2): quadrant q is drawn from a shuffle bag [0,1,2,3]
 * (refilled + shuffled with rng.spawn when empty). Quadrant q covers angles
 * [−90° + 90°·q, 90°·q) in screen space (y down): 0 = right-up, 1 = right-down,
 * 2 = left-down, 3 = left-up. A random angle in that range and a random margin
 * m ∈ [marginMin, marginMax) are chosen; the point is where the ray from the
 * player hits the view rect (centred on the player) expanded by m.
 */
import { creditRate } from '../../data/balance';
import { EventType } from '../EventBus';
import { spawnEnemy } from '../entities';
import { ENEMY_FLAG, type RunState } from '../RunState';
import type { SeededRNG } from '../rng/SeededRNG';
import type { SimContext, System } from '../SimContext';

/** Debug/test hook invoked after every credit-funded spawn. */
export type SpawnRecorder = (
  t: number,
  cost: number,
  x: number,
  y: number,
  quadrant: number,
  typeIndex: number,
) => void;

let recorder: SpawnRecorder | null = null;

/** Installs (or clears with null) the module-level spawn recorder. */
export function setSpawnRecorder(fn: SpawnRecorder | null): void {
  recorder = fn;
}

const HALF_PI = Math.PI / 2;

/** Start angle (radians) of quadrant q; the quadrant spans [start, start + π/2). */
export function quadrantStartAngle(q: number): number {
  return -HALF_PI + HALF_PI * q;
}

const POINT_OUT = { x: 0, y: 0 };

/**
 * Point where the ray from (px, py) at `angle` meets the view rect centred on
 * the player expanded by `margin` on every side. Writes into and returns `out`
 * (a shared scratch object by default — copy the values before the next call).
 */
export function spawnPointFor(
  px: number,
  py: number,
  angle: number,
  margin: number,
  view: { width: number; height: number },
  out: { x: number; y: number } = POINT_OUT,
): { x: number; y: number } {
  const hw = view.width / 2 + margin;
  const hh = view.height / 2 + margin;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const tx = adx > 1e-12 ? hw / adx : Infinity;
  const ty = ady > 1e-12 ? hh / ady : Infinity;
  const t = Math.min(tx, ty);
  out.x = px + dx * t;
  out.y = py + dy * t;
  return out;
}

/**
 * Per-state cache: pool of enemy type indices (rebuilt when stageIdx changes)
 * and the pending pick. Keyed on the state but invalidated when state.rng.spawn
 * is replaced (resetRunState creates new streams), so nothing leaks across runs.
 */
interface PoolCache {
  rng: SeededRNG;
  stageIdx: number;
  types: number[];
  minCost: number;
  maxCost: number;
  /** Type index chosen but not yet affordable (−1 = none). */
  pending: number;
}
const poolCache = new WeakMap<RunState, PoolCache>();

function getPool(state: RunState): PoolCache {
  const d = state.director;
  let cache = poolCache.get(state);
  if (cache && cache.rng !== state.rng.spawn) {
    cache.rng = state.rng.spawn;
    cache.stageIdx = -1;
    cache.pending = -1;
  }
  if (cache && cache.stageIdx === d.stageIdx) return cache;
  if (!cache) {
    cache = { rng: state.rng.spawn, stageIdx: -1, types: [], minCost: Infinity, maxCost: 0, pending: -1 };
    poolCache.set(state, cache);
  }
  const { stages, enemies } = state.config;
  cache.stageIdx = d.stageIdx;
  cache.types.length = 0;
  cache.minCost = Infinity;
  cache.maxCost = 0;
  const n = Math.min(d.stageIdx, stages.length);
  for (let s = 0; s < n; s++) {
    for (const id of stages[s].addTypes) {
      const idx = enemies.findIndex((e) => e.id === id);
      if (idx < 0 || cache.types.includes(idx)) continue;
      cache.types.push(idx);
      const c = enemies[idx].threatCost;
      if (c < cache.minCost) cache.minCost = c;
      if (c > cache.maxCost) cache.maxCost = c;
    }
  }
  return cache;
}

function despawnFar(ctx: SimContext): void {
  const { state, view } = ctx;
  const e = state.enemies;
  const p = state.player;
  const maxDist = state.config.balance.spawn.despawnMul * Math.hypot(view.width, view.height);
  const maxSq = maxDist * maxDist;
  const ids = e.pool.activeIds;
  // Backwards: free() swap-removes, moving the last id into the freed slot (already visited).
  for (let i = e.pool.count - 1; i >= 0; i--) {
    const id = ids[i];
    if (e.flags[id] & ENEMY_FLAG.BOSS) continue;
    const dx = e.x[id] - p.x;
    const dy = e.y[id] - p.y;
    if (dx * dx + dy * dy > maxSq) e.free(id);
  }
}

function applyStages(state: RunState): void {
  const d = state.director;
  const { stages, enemies } = state.config;
  const t = state.clock.elapsed;
  while (d.stageIdx < stages.length && stages[d.stageIdx].atSec <= t) {
    for (const id of stages[d.stageIdx].addTypes) {
      if (d.introduced.has(id)) continue;
      const idx = enemies.findIndex((e) => e.id === id);
      if (idx < 0) continue;
      d.introduced.add(id);
      state.events.push(EventType.behaviourIntroduced, idx);
    }
    d.stageIdx++;
  }
}

function nextQuadrant(state: RunState): number {
  const bag = state.director.quadrantBag;
  if (bag.length === 0) {
    bag.push(0, 1, 2, 3);
    state.rng.spawn.shuffle(bag);
  }
  return bag.pop() as number;
}

export const spawnDirector: System = (ctx, dt) => {
  const state = ctx.state;
  if (state.outcome !== null) return;

  despawnFar(ctx);
  applyStages(state);

  const pool = getPool(state);
  if (pool.types.length === 0) return;

  const b = state.config.balance;
  const d = state.director;
  const t = state.clock.elapsed;
  d.credits = Math.min(d.credits + creditRate(t, b) * dt, b.credits.maxCarry + pool.maxCost);

  const enemies = state.config.enemies;
  const rng = state.rng.spawn;
  const p = state.player;
  while (d.credits >= pool.minCost && state.enemies.count < b.spawn.maxActive) {
    if (pool.pending < 0) pool.pending = rng.weighted(pool.types, () => 1) ?? -1;
    const typeIndex = pool.pending;
    if (typeIndex < 0) break;
    // Save up for the pending pick (the credit cap always leaves room for the max cost).
    if (enemies[typeIndex].threatCost > d.credits) break;

    const q = nextQuadrant(state);
    const angle = quadrantStartAngle(q) + rng.next() * HALF_PI;
    const margin = rng.range(b.spawn.marginMin, b.spawn.marginMax);
    const pt = spawnPointFor(p.x, p.y, angle, margin, ctx.view);
    const x = pt.x;
    const y = pt.y;

    if (spawnEnemy(state, typeIndex, x, y) < 0) break;
    const cost = enemies[typeIndex].threatCost;
    d.credits -= cost;
    pool.pending = -1;
    if (recorder) recorder(t, cost, x, y, q, typeIndex);
  }
};
