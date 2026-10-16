/**
 * Werewolf Frenzy mutation ability (Req 20.3, fangs ≥ 3 + bat_wings ≥ 2).
 *
 * Whenever a Bat Wings dash ends (batWingsDashing true → false for the
 * bat_wings part index, observed once per step after AbilitySystem), a bite
 * shockwave is emitted at the player: WEREWOLF_DAMAGE × capped stats.damage to
 * every alive enemy within WEREWOLF_RADIUS (centre distance ≤ radius + enemy
 * radius). Non-boss enemies are knocked back: stun WEREWOLF_STUN_SEC and
 * velocity WEREWOLF_KNOCKBACK_SPEED away from the player.
 *
 * State lives in a per-SimContext record (no per-tick allocation).
 */
import { ENEMY_FLAG } from '../RunState';
import type { SimContext } from '../SimContext';
import { clampStats } from '../StatCaps';
import type { MutationAbilityRuntime } from '../systems/MutationAbilitySystem';
import { batWingsDashing } from './batWings';
import { BEHOLDER_DAMAGE_SOURCE } from './beholderGaze';

export const WEREWOLF_ABILITY_ID = 'werewolf_frenzy';
export const WEREWOLF_DAMAGE = 40;
export const WEREWOLF_RADIUS = 150;
export const WEREWOLF_STUN_SEC = 0.3;
export const WEREWOLF_KNOCKBACK_SPEED = 420;
/** Duration of the expanding ring visual. */
export const WEREWOLF_VISUAL_SEC = 0.35;
export const WEREWOLF_DAMAGE_SOURCE = BEHOLDER_DAMAGE_SOURCE;
const QUERY_MARGIN = 40;

export interface WerewolfShockwaveView {
  active: boolean;
  x: number;
  y: number;
  /** Current ring radius (expands 0 → WEREWOLF_RADIUS over the visual). */
  radius: number;
  /** Visual progress 0..1. */
  t01: number;
}

interface WerewolfRecord {
  /** bat_wings part index in config.bodyParts (−1 when absent), resolved once. */
  batIdx: number;
  wasDashing: boolean;
  /** Seconds left on the ring visual. */
  visual: number;
  x: number;
  y: number;
  /** Number of shockwaves emitted this run (tests/debug). */
  count: number;
  readonly view: WerewolfShockwaveView;
}

const RECORDS = new WeakMap<SimContext, WerewolfRecord>();

function record(ctx: SimContext): WerewolfRecord {
  let r = RECORDS.get(ctx);
  if (r === undefined) {
    const parts = ctx.state.config.bodyParts;
    let batIdx = -1;
    for (let i = 0; i < parts.length; i++) if (parts[i].id === 'bat_wings') batIdx = i;
    r = {
      batIdx,
      wasDashing: false,
      visual: 0,
      x: 0,
      y: 0,
      count: 0,
      view: { active: false, x: 0, y: 0, radius: 0, t01: 0 },
    };
    RECORDS.set(ctx, r);
  }
  return r;
}

function shockwave(ctx: SimContext, amount: number): void {
  const s = ctx.state;
  const p = s.player;
  const e = s.enemies;
  const out = ctx.scratch;
  const n = ctx.enemyHash.queryRadius(p.x, p.y, WEREWOLF_RADIUS + QUERY_MARGIN, out);
  for (let k = 0; k < n; k++) {
    const id = out[k];
    if (!e.isAlive(id)) continue;
    const dx = e.x[id] - p.x;
    const dy = e.y[id] - p.y;
    const reach = WEREWOLF_RADIUS + e.radius[id];
    const d2 = dx * dx + dy * dy;
    if (d2 > reach * reach) continue;
    ctx.damage.push(id, amount, WEREWOLF_DAMAGE_SOURCE);
    if ((e.flags[id] & ENEMY_FLAG.BOSS) !== 0) continue;
    const d = Math.sqrt(d2);
    let ux = p.lastDirX;
    let uy = p.lastDirY;
    if (d > 1e-6) {
      ux = dx / d;
      uy = dy / d;
    }
    e.vx[id] = ux * WEREWOLF_KNOCKBACK_SPEED;
    e.vy[id] = uy * WEREWOLF_KNOCKBACK_SPEED;
    e.stun[id] = Math.max(e.stun[id], WEREWOLF_STUN_SEC);
  }
}

export const werewolfFrenzy: MutationAbilityRuntime = {
  tick(ctx, dt) {
    const r = record(ctx);
    if (r.visual > 0) r.visual = Math.max(0, r.visual - dt);
    const s = ctx.state;
    const dashing = r.batIdx >= 0 && s.build.parts.has('bat_wings') && batWingsDashing(ctx, r.batIdx);
    if (r.wasDashing && !dashing) {
      const stats = clampStats(s.player.stats, s.config.balance.caps);
      shockwave(ctx, WEREWOLF_DAMAGE * stats.damage);
      r.visual = WEREWOLF_VISUAL_SEC;
      r.x = s.player.x;
      r.y = s.player.y;
      r.count++;
    }
    r.wasDashing = dashing;
  },
};

/** Current shockwave ring for rendering (reused object; do not hold across frames). */
export function werewolfShockwave(ctx: SimContext): WerewolfShockwaveView {
  const r = record(ctx);
  const v = r.view;
  v.active = ctx.state.outcome === null && r.visual > 0;
  v.t01 = v.active ? 1 - r.visual / WEREWOLF_VISUAL_SEC : 0;
  v.x = r.x;
  v.y = r.y;
  v.radius = WEREWOLF_RADIUS * v.t01;
  return v;
}

/** Number of shockwaves emitted since the last reset. */
export function werewolfShockwaveCount(ctx: SimContext): number {
  return record(ctx).count;
}

export function resetWerewolfFrenzy(ctx: SimContext): void {
  const r = record(ctx);
  r.wasDashing = false;
  r.visual = 0;
  r.x = r.y = 0;
  r.count = 0;
  r.view.active = false;
}
