/**
 * Bog Kraken mutation ability (Req 20.3, swamp_gut ≥ 3 + tentacle ≥ 2).
 *
 * Every BOG_KRAKEN_INTERVAL s (first pulse on the first owned tick) grabs the
 * BOG_KRAKEN_GRABS nearest alive non-boss enemies whose centre lies inside the
 * active Swamp Gut puddle (or within BOG_KRAKEN_FALLBACK_RADIUS of the player
 * when no puddle is active). Each grabbed enemy is stunned BOG_KRAKEN_STUN_SEC,
 * given a velocity toward the area centre (pull) and takes
 * BOG_KRAKEN_DAMAGE × capped stats.damage.
 *
 * Pull speed = min(BOG_KRAKEN_PULL_MAX_SPEED, distance × BOG_KRAKEN_PULL_GAIN):
 * with EnemyAISystem's stun damping (0.9/step at 60 Hz) the enemy ends ~90 %
 * of the way to the centre.
 *
 * State lives in a per-SimContext record (no per-tick allocation).
 */
import { ENEMY_FLAG } from '../RunState';
import type { SimContext } from '../SimContext';
import { clampStats } from '../StatCaps';
import type { MutationAbilityRuntime } from '../systems/MutationAbilitySystem';
import { BEHOLDER_DAMAGE_SOURCE } from './beholderGaze';
import { swampGutPuddle, type SwampPuddleView } from './swampGut';

export const BOG_KRAKEN_ABILITY_ID = 'bog_kraken';
export const BOG_KRAKEN_INTERVAL = 1.2;
export const BOG_KRAKEN_GRABS = 2;
export const BOG_KRAKEN_STUN_SEC = 0.8;
export const BOG_KRAKEN_DAMAGE = 18;
export const BOG_KRAKEN_FALLBACK_RADIUS = 140;
export const BOG_KRAKEN_PULL_GAIN = 6;
export const BOG_KRAKEN_PULL_MAX_SPEED = 900;
/** Duration of the tentacle-line visual after a pulse. */
export const BOG_KRAKEN_VISUAL_SEC = 0.3;
export const BOG_KRAKEN_DAMAGE_SOURCE = BEHOLDER_DAMAGE_SOURCE;

export interface BogKrakenView {
  active: boolean;
  /** Anchor (area centre) of the last pulse. */
  x: number;
  y: number;
  /** Visual progress 0..1. */
  t01: number;
}

interface BogKrakenRecord {
  /** swamp_gut part index (−1 when absent), resolved once. */
  swampIdx: number;
  timer: number;
  visual: number;
  ax: number;
  ay: number;
  grabCount: number;
  readonly grabIds: Int32Array;
  /** Positions at grab time (used when the enemy has since died). */
  readonly grabPos: Float32Array;
  /** Total enemies grabbed since the last reset (tests/debug). */
  total: number;
  readonly puddle: SwampPuddleView;
  readonly view: BogKrakenView;
}

const RECORDS = new WeakMap<SimContext, BogKrakenRecord>();

function record(ctx: SimContext): BogKrakenRecord {
  let r = RECORDS.get(ctx);
  if (r === undefined) {
    const parts = ctx.state.config.bodyParts;
    let swampIdx = -1;
    for (let i = 0; i < parts.length; i++) if (parts[i].id === 'swamp_gut') swampIdx = i;
    r = {
      swampIdx,
      timer: 0,
      visual: 0,
      ax: 0,
      ay: 0,
      grabCount: 0,
      grabIds: new Int32Array(BOG_KRAKEN_GRABS).fill(-1),
      grabPos: new Float32Array(BOG_KRAKEN_GRABS * 2),
      total: 0,
      puddle: { active: false, x: 0, y: 0, radius: 0, timeLeft: 0 },
      view: { active: false, x: 0, y: 0, t01: 0 },
    };
    RECORDS.set(ctx, r);
  }
  return r;
}

function pulse(ctx: SimContext, r: BogKrakenRecord): void {
  const s = ctx.state;
  const p = s.player;
  const e = s.enemies;
  let cx = p.x;
  let cy = p.y;
  let radius = BOG_KRAKEN_FALLBACK_RADIUS;
  if (r.swampIdx >= 0 && s.build.parts.has('swamp_gut')) {
    const pd = swampGutPuddle(ctx, r.swampIdx, r.puddle);
    if (pd.active && pd.radius > 0) {
      cx = pd.x;
      cy = pd.y;
      radius = pd.radius;
    }
  }

  // Two-best selection (ids tie-broken by hash order, which is deterministic).
  let best0 = -1;
  let best1 = -1;
  let d0 = Infinity;
  let d1 = Infinity;
  const r2 = radius * radius;
  const out = ctx.scratch;
  const n = ctx.enemyHash.queryRadius(cx, cy, radius, out);
  for (let k = 0; k < n; k++) {
    const id = out[k];
    if (!e.isAlive(id) || (e.flags[id] & ENEMY_FLAG.BOSS) !== 0) continue;
    const dx = e.x[id] - cx;
    const dy = e.y[id] - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    if (d2 < d0) {
      best1 = best0;
      d1 = d0;
      best0 = id;
      d0 = d2;
    } else if (d2 < d1) {
      best1 = id;
      d1 = d2;
    }
  }

  const stats = clampStats(p.stats, s.config.balance.caps);
  const amount = BOG_KRAKEN_DAMAGE * stats.damage;
  r.grabCount = 0;
  r.ax = cx;
  r.ay = cy;
  for (let g = 0; g < BOG_KRAKEN_GRABS; g++) {
    const id = g === 0 ? best0 : best1;
    if (id < 0) continue;
    const dx = cx - e.x[id];
    const dy = cy - e.y[id];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-6) {
      const speed = Math.min(BOG_KRAKEN_PULL_MAX_SPEED, d * BOG_KRAKEN_PULL_GAIN);
      e.vx[id] = (dx / d) * speed;
      e.vy[id] = (dy / d) * speed;
    } else {
      e.vx[id] = 0;
      e.vy[id] = 0;
    }
    e.stun[id] = Math.max(e.stun[id], BOG_KRAKEN_STUN_SEC);
    ctx.damage.push(id, amount, BOG_KRAKEN_DAMAGE_SOURCE);
    const slot = r.grabCount++;
    r.grabIds[slot] = id;
    r.grabPos[2 * slot] = e.x[id];
    r.grabPos[2 * slot + 1] = e.y[id];
    r.total++;
  }
  r.visual = r.grabCount > 0 ? BOG_KRAKEN_VISUAL_SEC : 0;
}

export const bogKraken: MutationAbilityRuntime = {
  tick(ctx, dt) {
    const r = record(ctx);
    if (r.visual > 0) r.visual = Math.max(0, r.visual - dt);
    r.timer -= dt;
    if (r.timer > 0) return;
    pulse(ctx, r);
    r.timer += BOG_KRAKEN_INTERVAL;
    if (r.timer <= 0) r.timer = BOG_KRAKEN_INTERVAL;
  },
};

/**
 * Writes [x, y] pairs of the enemies grabbed by the latest pulse into `out`
 * (length set to 2 × count) while its visual is live; returns the count
 * (0 when no visual). Alive grabbed enemies report their current position.
 */
export function bogKrakenGrabs(ctx: SimContext, out: number[]): number {
  const r = record(ctx);
  const live = ctx.state.outcome === null && r.visual > 0;
  const count = live ? r.grabCount : 0;
  const e = ctx.state.enemies;
  out.length = count * 2;
  for (let g = 0; g < count; g++) {
    const id = r.grabIds[g];
    if (id >= 0 && e.isAlive(id)) {
      out[2 * g] = e.x[id];
      out[2 * g + 1] = e.y[id];
    } else {
      out[2 * g] = r.grabPos[2 * g];
      out[2 * g + 1] = r.grabPos[2 * g + 1];
    }
  }
  return count;
}

/** Anchor + progress of the latest pulse visual (reused object). */
export function bogKrakenView(ctx: SimContext): BogKrakenView {
  const r = record(ctx);
  const v = r.view;
  v.active = ctx.state.outcome === null && r.visual > 0 && r.grabCount > 0;
  v.x = r.ax;
  v.y = r.ay;
  v.t01 = v.active ? 1 - r.visual / BOG_KRAKEN_VISUAL_SEC : 0;
  return v;
}

/** Total enemies grabbed since the last reset. */
export function bogKrakenGrabTotal(ctx: SimContext): number {
  return record(ctx).total;
}

export function resetBogKraken(ctx: SimContext): void {
  const r = record(ctx);
  r.timer = 0;
  r.visual = 0;
  r.ax = r.ay = 0;
  r.grabCount = 0;
  r.grabIds.fill(-1);
  r.grabPos.fill(0);
  r.total = 0;
  r.view.active = false;
}
