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
 *  2b. Swarm events (Req 23, see ./swarm.ts and runSwarms): 2 s warning, then a
 *     credit-free ring/stampede spawn (bounded by maxActive); director.swarmIdx++.
 *  3. Credits, in two independent lanes (steps 3–5 run once per lane):
 *     - horde lane (types without `special`): director.credits += creditRate(t)·dt
 *     - special lane (bats, slimes, ghosts, witches): director.specialCredits +=
 *       creditRate(t)·specialRate·dt
 *     Each lane is capped at maxCarry + (max threatCost in that lane's pool), so
 *     spawned cost per window ≤ ∫(rate) + cap per lane (5.3, 5.4). The lanes keep
 *     expensive v2 monsters from starving the regular horde.
 *  4. Spawning: while credits ≥ cheapest cost in pool and active < maxActive,
 *     pick a type uniformly (weight 1) from the whole pool via rng.spawn. If it
 *     costs more than the current credits it stays pending and the director
 *     saves up (otherwise cheap types would always consume credits first and
 *     costlier types would never appear). Once affordable: spend, spawn (5.6).
 *     Types with behaviourParams.groupSize > 1 (bats) save up for the whole
 *     group (min(groupSize, free slots) × cost, bounded by the carry cap) and
 *     spawn it clustered within ~CLUSTER_RADIUS px; threatCost is charged per member.
 *  5. Elites (22.7, 22.9): every credit-funded spawn (each group member) of a
 *     non-boss type rolls rng.spawn < eliteChance(elapsed) → makeElite(). No roll
 *     (and no RNG draw) while the chance is 0, i.e. before elite.startSec.
 *
 * Position (5.1, 5.2): quadrant q is drawn from a shuffle bag [0,1,2,3]
 * (refilled + shuffled with rng.spawn when empty). Quadrant q covers angles
 * [−90° + 90°·q, 90°·q) in screen space (y down): 0 = right-up, 1 = right-down,
 * 2 = left-down, 3 = left-up. A random angle in that range and a random margin
 * m ∈ [marginMin, marginMax) are chosen; the point is where the ray from the
 * player hits the view rect (centred on the player) expanded by m.
 */
import { creditRate, eliteChance } from '../../data/balance';
import { EventType } from '../EventBus';
import { spawnEnemy } from '../entities';
import { ENEMY_FLAG, type RunState } from '../RunState';
import type { SeededRNG } from '../rng/SeededRNG';
import type { SimContext, System } from '../SimContext';
import { spawnSwarmEvent } from './swarm';

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

/** One spawn lane: its slice of the stage pool and its pending pick. */
interface Lane {
  types: number[];
  minCost: number;
  maxCost: number;
  /** Type index chosen but not yet affordable (−1 = none). */
  pending: number;
}

/**
 * Per-state cache: the two lanes' pools (rebuilt when stageIdx changes) and
 * pending picks. Keyed on the state but invalidated when state.rng.spawn is
 * replaced (resetRunState creates new streams), so nothing leaks across runs.
 */
interface PoolCache {
  rng: SeededRNG;
  stageIdx: number;
  horde: Lane;
  special: Lane;
  /** Number of swarm events whose 2 s warning has fired (Req 23.5). */
  swarmWarned: number;
}
const poolCache = new WeakMap<RunState, PoolCache>();

function newLane(): Lane {
  return { types: [], minCost: Infinity, maxCost: 0, pending: -1 };
}

function resetLane(l: Lane): void {
  l.types.length = 0;
  l.minCost = Infinity;
  l.maxCost = 0;
}

function getPool(state: RunState): PoolCache {
  const d = state.director;
  let cache = poolCache.get(state);
  if (cache && cache.rng !== state.rng.spawn) {
    cache.rng = state.rng.spawn;
    cache.stageIdx = -1;
    cache.horde.pending = -1;
    cache.special.pending = -1;
    cache.swarmWarned = 0;
  }
  if (cache && cache.stageIdx === d.stageIdx) return cache;
  if (!cache) {
    cache = { rng: state.rng.spawn, stageIdx: -1, horde: newLane(), special: newLane(), swarmWarned: 0 };
    poolCache.set(state, cache);
  }
  const { stages, enemies } = state.config;
  cache.stageIdx = d.stageIdx;
  resetLane(cache.horde);
  resetLane(cache.special);
  const n = Math.min(d.stageIdx, stages.length);
  for (let s = 0; s < n; s++) {
    for (const id of stages[s].addTypes) {
      const idx = enemies.findIndex((e) => e.id === id);
      if (idx < 0) continue;
      const lane = enemies[idx].special ? cache.special : cache.horde;
      if (lane.types.includes(idx)) continue;
      lane.types.push(idx);
      const c = enemies[idx].threatCost;
      if (c < lane.minCost) lane.minCost = c;
      if (c > lane.maxCost) lane.maxCost = c;
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

  const pools = getPool(state);
  runSwarms(ctx, pools);
  const b = state.config.balance;
  const d = state.director;
  const rate = creditRate(state.clock.elapsed, b);

  // Horde lane first so the regular monsters keep their v1 density.
  if (pools.horde.types.length > 0) {
    d.credits = Math.min(d.credits + rate * dt, b.credits.maxCarry + pools.horde.maxCost);
    d.credits = runLane(ctx, pools.horde, d.credits);
  }
  if (pools.special.types.length > 0) {
    const cap = b.credits.maxCarry + pools.special.maxCost;
    d.specialCredits = Math.min(d.specialCredits + rate * b.credits.specialRate * dt, cap);
    d.specialCredits = runLane(ctx, pools.special, d.specialCredits);
  }
};

/** Seconds before a swarm event at which its warning fires (Req 23.5). */
export const SWARM_WARNING_SEC = 2;

/**
 * Swarm events (Req 23): each config.swarmEvents[i] emits swarmWarning(i, secondsUntilStart)
 * once when elapsed ≥ atSec − SWARM_WARNING_SEC, then spawns once when elapsed ≥ atSec
 * (director.swarmIdx counts started events). Spawns ignore credits but respect maxActive.
 */
function runSwarms(ctx: SimContext, cache: PoolCache): void {
  const state = ctx.state;
  const swarms = state.config.swarmEvents;
  if (!swarms || swarms.length === 0) return;
  const d = state.director;
  const t = state.clock.elapsed;
  if (cache.swarmWarned < d.swarmIdx) cache.swarmWarned = d.swarmIdx;
  while (cache.swarmWarned < swarms.length && t >= swarms[cache.swarmWarned].atSec - SWARM_WARNING_SEC) {
    const i = cache.swarmWarned++;
    state.events.push(EventType.swarmWarning, i, Math.max(0, swarms[i].atSec - t));
  }
  while (d.swarmIdx < swarms.length && t >= swarms[d.swarmIdx].atSec) {
    spawnSwarmEvent(ctx, swarms[d.swarmIdx]);
    d.swarmIdx++;
  }
}

/** Spends a lane's credits on spawns (steps 4–5 above). Returns the remaining credits. */
function runLane(ctx: SimContext, pool: Lane, credits: number): number {
  const state = ctx.state;
  const b = state.config.balance;
  const t = state.clock.elapsed;
  const cap = b.credits.maxCarry + pool.maxCost;
  const d = { credits };
  const enemies = state.config.enemies;
  const rng = state.rng.spawn;
  const p = state.player;
  const chance = eliteChance(t, b);
  while (d.credits >= pool.minCost && state.enemies.count < b.spawn.maxActive) {
    if (pool.pending < 0) pool.pending = rng.weighted(pool.types, () => 1) ?? -1;
    const typeIndex = pool.pending;
    if (typeIndex < 0) break;
    const type = enemies[typeIndex];
    const cost = type.threatCost;
    // Groups (bats, Req 22.3) spawn together: save up for the whole group (bounded
    // by free slots and by the carry cap so the pick can always be afforded).
    const room = b.spawn.maxActive - state.enemies.count;
    const groupSize = Math.max(1, Math.floor(type.behaviourParams?.groupSize ?? 1));
    const want = Math.min(groupSize, room);
    // Save up for the pending pick (the credit cap always leaves room for the max cost).
    if (Math.min(cost * want, cap) > d.credits || cost > d.credits) break;
    const n = cost > 0 ? Math.max(1, Math.min(want, Math.floor(d.credits / cost))) : want;

    const q = nextQuadrant(state);
    const qStart = quadrantStartAngle(q);
    const angle = qStart + rng.next() * HALF_PI;
    const margin = rng.range(b.spawn.marginMin, b.spawn.marginMax);
    const pt = spawnPointFor(p.x, p.y, angle, margin, ctx.view);
    const x0 = pt.x;
    const y0 = pt.y;
    const dist = Math.max(1, Math.hypot(x0 - p.x, y0 - p.y));

    let spawned = 0;
    for (let k = 0; k < n; k++) {
      let x = x0;
      let y = y0;
      if (k > 0) {
        // Cluster members: small angle/margin jitter around the leader, kept inside
        // the same quadrant and margin band (≈ CLUSTER_RADIUS px from the leader).
        const a = clampAngle(angle + rng.range(-1, 1) * (CLUSTER_RADIUS * 0.6) / dist, qStart);
        const m = Math.min(
          b.spawn.marginMax,
          Math.max(b.spawn.marginMin, margin + rng.range(-1, 1) * CLUSTER_RADIUS * 0.4),
        );
        const cp = spawnPointFor(p.x, p.y, a, m, ctx.view);
        x = cp.x;
        y = cp.y;
      }
      const id = spawnEnemy(state, typeIndex, x, y);
      if (id < 0) break;
      d.credits -= cost;
      spawned++;
      if (!type.boss && chance > 0 && rng.next() < chance) makeElite(state, id);
      if (recorder) recorder(t, cost, x, y, q, typeIndex);
    }
    if (spawned === 0) break;
    pool.pending = -1;
  }
  return d.credits;
}

/** Max distance (px) of a group member from the group's leader spawn point. */
export const CLUSTER_RADIUS = 40;

function clampAngle(a: number, qStart: number): number {
  const lo = qStart;
  const hi = qStart + HALF_PI - 1e-6;
  return a < lo ? lo : a > hi ? hi : a;
}

/**
 * Turns an alive enemy into an Elite (Req 22.7): hp/maxHp × elite.hpMult,
 * scale × elite.scale, radius × 1.15, energyValue × 3, flags |= ELITE | NO_MERGE.
 * No-op for dead ids, bosses and enemies that are already elite.
 */
export function makeElite(state: RunState, id: number): void {
  const e = state.enemies;
  if (!e.isAlive(id) || e.flags[id] & (ENEMY_FLAG.BOSS | ENEMY_FLAG.ELITE)) return;
  const cfg = state.config.balance.elite;
  e.hp[id] *= cfg.hpMult;
  e.maxHp[id] *= cfg.hpMult;
  e.scale[id] *= cfg.scale;
  e.radius[id] *= 1.15;
  e.energyValue[id] *= 3;
  e.flags[id] |= ENEMY_FLAG.ELITE | ENEMY_FLAG.NO_MERGE;
}
