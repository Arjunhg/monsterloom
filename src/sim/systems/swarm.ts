/**
 * Scripted swarm events (design "SpawnDirector → Swarm events"; Req 23.1–23.5).
 *
 * Spawns ignore threat credits (director.credits / specialCredits are untouched)
 * but still respect balance.spawn.maxActive. Members get
 * flags |= SWARM | NO_MERGE and a scripted behaviour code that overrides their
 * type's own behaviour (see src/sim/behaviours/swarm.ts):
 *
 * - ring: `count` enemies on a circle of RING_RADIUS around the player with a
 *   passable gap (buildRing, Property 21); behaviour 'ringInward' with the ring
 *   centre in aiDirX/aiDirY. They keep separation and revert to their type's
 *   behaviour once they arrive (or after RING_MAX_SEC).
 * - stampede: an edge is drawn with rng.spawn (0 left, 1 right, 2 top, 3 bottom);
 *   members are spread across that edge just outside the view in 2–3 staggered
 *   rows and run straight to the opposite edge (behaviour 'stampede', unit
 *   direction in aiDirX/aiDirY; aiState stays 0 so bats never read as telegraphing).
 */
import type { SwarmEventDef } from '../../data/swarmEvents';
import { BEHAVIOUR_CODE, spawnEnemy } from '../entities';
import { ENEMY_FLAG } from '../RunState';
import type { SimContext } from '../SimContext';
import { effectiveMaxActive, type ViewSize } from './viewScale';

/** Ring radius (px) around the player: off-screen at the sides, visible top/bottom of the portrait view. */
export const RING_RADIUS = 520;
/** Extra distance (px) beyond the short half-axis of the view for the ring on large views. */
export const RING_EDGE_PAD = 160;

/** Actual ring radius for the view: max(RING_RADIUS, min(w, h) / 2 + RING_EDGE_PAD). */
export function ringRadiusFor(view: ViewSize): number {
  return Math.max(RING_RADIUS, Math.min(view.width, view.height) / 2 + RING_EDGE_PAD);
}
/** Required gap arc length as a multiple of the player radius (2.5 × diameter). */
export const RING_GAP_PLAYER_RADII = 5;
/** Distance (px) between stampede rows. */
export const STAMPEDE_ROW_GAP = 50;

export interface RingLayout {
  /** Angles (radians, in [0, 2π)) of the occupied slots, in order around the circle starting after the gap. */
  angles: number[];
  /** Index of the first skipped slot. */
  gapStart: number;
  /** Number of consecutive skipped slots. */
  gapSlots: number;
}

const TAU = Math.PI * 2;

/**
 * Lays out `count` enemies on a circle of `radius` with one passable gap (Property 21).
 * totalSlots = count + gapSlots evenly spaced slots; gapSlots consecutive slots are
 * skipped, where gapSlots is the minimal integer ≥ 1 with
 * (gapSlots + 1) × (2πR / totalSlots) ≥ 5 × playerRadius. The gap begins at slot
 * floor(rotation01 × totalSlots). If even an (almost) empty circle can't fit the
 * gap (2πR ≤ 5·playerRadius), every enemy is placed on one angle (gap = whole circle).
 */
export function buildRing(count: number, radius: number, playerRadius: number, rotation01 = 0): RingLayout {
  const n = Math.max(0, Math.floor(count));
  const circ = TAU * radius;
  // Tiny safety factor so float rounding never puts the gap a hair under the requirement.
  const need = RING_GAP_PLAYER_RADII * playerRadius * (1 + 1e-9);
  if (n === 0) return { angles: [], gapStart: 0, gapSlots: 0 };
  if (!(circ > need)) {
    return { angles: new Array<number>(n).fill(0), gapStart: 0, gapSlots: 0 };
  }
  // (g + 1)·C/(n + g) ≥ k  ⇔  g ≥ (k·n − C)/(C − k)
  let g = Math.max(1, Math.ceil((need * n - circ) / (circ - need)));
  // Float guard in both directions: minimal g satisfying (g + 1)·C/(n + g) ≥ k.
  while (g > 1 && (g * circ) / (n + g - 1) >= need) g--;
  while (((g + 1) * circ) / (n + g) < need) g++;
  const total = n + g;
  const r01 = Number.isFinite(rotation01) ? rotation01 - Math.floor(rotation01) : 0;
  const gapStart = Math.min(total - 1, Math.floor(r01 * total));
  const step = TAU / total;
  const angles: number[] = [];
  for (let j = 0; j < n; j++) angles.push(((gapStart + g + j) % total) * step);
  return { angles, gapStart, gapSlots: g };
}

/** Free enemy slots under the view-dependent active cap (balance.spawn.maxActive on the default view). */
function room(ctx: SimContext): number {
  return Math.max(0, effectiveMaxActive(ctx.view, ctx.state.config.balance) - ctx.state.enemies.count);
}

function typeIndexOf(ctx: SimContext, typeId: string): number {
  return ctx.state.config.enemies.findIndex((t) => t.id === typeId);
}

function markSwarm(ctx: SimContext, id: number, code: number): void {
  const e = ctx.state.enemies;
  e.behaviour[id] = code;
  e.flags[id] |= ENEMY_FLAG.SWARM | ENEMY_FLAG.NO_MERGE;
  e.aiState[id] = 0;
  e.aiTimer[id] = 0;
}

/** Spawns a closing ring around the player. Returns the number of enemies spawned. */
export function spawnRing(ctx: SimContext, def: SwarmEventDef): number {
  const state = ctx.state;
  const typeIndex = typeIndexOf(ctx, def.typeId);
  if (typeIndex < 0) return 0;
  const p = state.player;
  const radius = ringRadiusFor(ctx.view);
  const layout = buildRing(def.count, radius, p.radius, state.rng.spawn.next());
  const n = Math.min(layout.angles.length, room(ctx));
  const e = state.enemies;
  const cx = p.x;
  const cy = p.y;
  let spawned = 0;
  for (let k = 0; k < n; k++) {
    const a = layout.angles[k];
    const id = spawnEnemy(state, typeIndex, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    if (id < 0) break;
    markSwarm(ctx, id, BEHAVIOUR_CODE.ringInward);
    e.aiDirX[id] = cx;
    e.aiDirY[id] = cy;
    spawned++;
  }
  return spawned;
}

/** Spawns a stampede from a random view edge. Returns the number of enemies spawned. */
export function spawnStampede(ctx: SimContext, def: SwarmEventDef): number {
  const state = ctx.state;
  const typeIndex = typeIndexOf(ctx, def.typeId);
  if (typeIndex < 0) return 0;
  const rng = state.rng.spawn;
  const edge = rng.int(0, 3); // 0 left, 1 right, 2 top, 3 bottom
  const n = Math.min(Math.max(0, Math.floor(def.count)), room(ctx));
  if (n === 0) return 0;
  const p = state.player;
  const e = state.enemies;
  const margin = state.config.balance.spawn.marginMax;
  const horizontal = edge <= 1; // travels along x
  // Unit direction: from the chosen edge towards the opposite one.
  const dirX = edge === 0 ? 1 : edge === 1 ? -1 : 0;
  const dirY = edge === 2 ? 1 : edge === 3 ? -1 : 0;
  const halfAlong = (horizontal ? ctx.view.width : ctx.view.height) / 2;
  const across = horizontal ? ctx.view.height : ctx.view.width;
  const rows = n >= 20 ? 3 : n >= 2 ? 2 : 1;
  const perRow = Math.ceil(n / rows);
  const spacing = across / perRow;
  let spawned = 0;
  for (let k = 0; k < n; k++) {
    const row = k % rows;
    const slot = Math.floor(k / rows);
    // Staggered rows: each row is shifted by a fraction of the spacing.
    const offAcross = -across / 2 + (slot + 0.5 + row / rows - 0.5 / rows) * spacing;
    // Distance from the player along the travel axis (negative = behind, start side).
    const back = halfAlong + margin + row * STAMPEDE_ROW_GAP;
    const x = horizontal ? p.x - dirX * back : p.x + offAcross;
    const y = horizontal ? p.y + offAcross : p.y - dirY * back;
    const id = spawnEnemy(state, typeIndex, x, y);
    if (id < 0) break;
    markSwarm(ctx, id, BEHAVIOUR_CODE.stampede);
    e.aiDirX[id] = dirX;
    e.aiDirY[id] = dirY;
    spawned++;
  }
  return spawned;
}

/** Spawns one swarm event (ignores credits, respects maxActive). Returns the number spawned. */
export function spawnSwarmEvent(ctx: SimContext, def: SwarmEventDef): number {
  return def.kind === 'ring' ? spawnRing(ctx, def) : spawnStampede(ctx, def);
}
