/**
 * Projectile movement, lifetime, hit tests and pierce (Req 4.5–4.6, 16.2–16.3).
 *
 * - prevX/Y are stored before integrating (render interpolation).
 * - lifetime −= dt; the projectile is freed when it reaches ≤ 0.
 * - Player-side: hash query around the projectile (radius + HIT_QUERY_PAD),
 *   circle overlap with alive enemies not already hit by this projectile.
 *   Each hit queues damage (source = ability part index) and decrements pierce;
 *   the projectile is freed when pierce < 0.
 * - Enemy-side: overlap with the player → damagePlayer, then freed.
 *
 * Per-projectile hit memory: a ring of the last HIT_MEMORY enemy ids per slot,
 * allocated once per SimContext. Abilities must create projectiles through
 * spawnProjectile() so the slot's hit memory is cleared.
 */
import { damagePlayer } from '../entities';
import { PROJECTILE_SIDE } from '../RunState';
import type { SimContext, System } from '../SimContext';

export const HIT_MEMORY = 8;
export const HIT_QUERY_PAD = 40;

interface HitMemory {
  ids: Int32Array;
  /** Number of entries written (ring head = n % HIT_MEMORY). */
  n: Uint8Array;
}

const HITS = new WeakMap<SimContext, HitMemory>();

function hitMemory(ctx: SimContext): HitMemory {
  let m = HITS.get(ctx);
  if (m === undefined) {
    const cap = ctx.state.projectiles.capacity;
    m = { ids: new Int32Array(cap * HIT_MEMORY).fill(-1), n: new Uint8Array(cap) };
    HITS.set(ctx, m);
  }
  return m;
}

function clearHits(m: HitMemory, pid: number): void {
  m.n[pid] = 0;
  m.ids.fill(-1, pid * HIT_MEMORY, pid * HIT_MEMORY + HIT_MEMORY);
}

function wasHit(m: HitMemory, pid: number, eid: number): boolean {
  const base = pid * HIT_MEMORY;
  for (let k = 0; k < HIT_MEMORY; k++) if (m.ids[base + k] === eid) return true;
  return false;
}

function recordHit(m: HitMemory, pid: number, eid: number): void {
  const n = m.n[pid];
  m.ids[pid * HIT_MEMORY + (n % HIT_MEMORY)] = eid;
  m.n[pid] = (n + 1) % 256;
}

/** Clears all per-projectile hit memory (call on restart alongside resetRunState). */
export function resetProjectileHits(ctx: SimContext): void {
  const m = hitMemory(ctx);
  m.ids.fill(-1);
  m.n.fill(0);
}

/**
 * Allocates and initialises a projectile. `ability` is the owning part index
 * (255 for none). Returns the id, or −1 when the store is full.
 */
export function spawnProjectile(
  ctx: SimContext,
  side: number,
  ability: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  radius: number,
  damage: number,
  pierce: number,
  lifetime: number,
): number {
  const pr = ctx.state.projectiles;
  const id = pr.alloc();
  if (id < 0) return -1;
  pr.side[id] = side;
  pr.ability[id] = ability;
  pr.x[id] = pr.prevX[id] = x;
  pr.y[id] = pr.prevY[id] = y;
  pr.vx[id] = vx;
  pr.vy[id] = vy;
  pr.radius[id] = radius;
  pr.damage[id] = damage;
  pr.pierce[id] = pierce;
  pr.lifetime[id] = lifetime;
  clearHits(hitMemory(ctx), id);
  return id;
}

function freeProjectile(ctx: SimContext, m: HitMemory, id: number): void {
  ctx.state.projectiles.free(id);
  clearHits(m, id);
}

export const projectileSystem: System = (ctx, dt) => {
  const state = ctx.state;
  if (state.outcome !== null) return;
  const pr = state.projectiles;
  const enemies = state.enemies;
  const player = state.player;
  const m = hitMemory(ctx);
  const ids = pr.pool.activeIds;
  const scratch = ctx.scratch;

  // Backwards: free() swap-removes the last active id (already processed) into this slot.
  for (let k = pr.count - 1; k >= 0; k--) {
    const id = ids[k];
    pr.prevX[id] = pr.x[id];
    pr.prevY[id] = pr.y[id];
    pr.x[id] += pr.vx[id] * dt;
    pr.y[id] += pr.vy[id] * dt;
    pr.lifetime[id] -= dt;
    if (pr.lifetime[id] <= 0) {
      freeProjectile(ctx, m, id);
      continue;
    }

    const px = pr.x[id];
    const py = pr.y[id];
    const pRad = pr.radius[id];

    if (pr.side[id] === PROJECTILE_SIDE.ENEMY) {
      const dx = player.x - px;
      const dy = player.y - py;
      const r = player.radius + pRad;
      if (dx * dx + dy * dy <= r * r) {
        damagePlayer(state, pr.damage[id]);
        freeProjectile(ctx, m, id);
      }
      continue;
    }

    const n = ctx.enemyHash.queryRadius(px, py, pRad + HIT_QUERY_PAD, scratch);
    for (let j = 0; j < n; j++) {
      const eid = scratch[j];
      if (!enemies.isAlive(eid) || wasHit(m, id, eid)) continue;
      const dx = enemies.x[eid] - px;
      const dy = enemies.y[eid] - py;
      const r = enemies.radius[eid] + pRad;
      if (dx * dx + dy * dy > r * r) continue;
      ctx.damage.push(eid, pr.damage[id], pr.ability[id]);
      recordHit(m, id, eid);
      pr.pierce[id]--;
      if (pr.pierce[id] < 0) {
        freeProjectile(ctx, m, id);
        break;
      }
    }
  }
};
