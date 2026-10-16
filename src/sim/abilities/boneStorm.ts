/**
 * Bone Storm mutation ability (Req 20.3, ribcage ≥ 3 + blob_spit ≥ 3).
 *
 * Every BONE_STORM_INTERVAL s (first burst on the first owned tick) spawns
 * BONE_STORM_COUNT player projectiles evenly spaced in a ring around the
 * player, flying outward. Their ability index is the ribcage part index so
 * they render (and attribute damage) as bones.
 *
 * State lives in a per-SimContext record (no per-tick allocation).
 */
import { PROJECTILE_SIDE } from '../RunState';
import type { SimContext } from '../SimContext';
import { clampStats } from '../StatCaps';
import type { MutationAbilityRuntime } from '../systems/MutationAbilitySystem';
import { spawnProjectile } from '../systems/ProjectileSystem';

export const BONE_STORM_ABILITY_ID = 'bone_storm';
export const BONE_STORM_INTERVAL = 2.5;
export const BONE_STORM_COUNT = 12;
export const BONE_STORM_SPEED = 460;
export const BONE_STORM_RADIUS = 9;
export const BONE_STORM_DAMAGE = 14;
export const BONE_STORM_PIERCE = 2;
export const BONE_STORM_LIFETIME = 0.9;
/** Duration of the burst flash visual. */
export const BONE_STORM_FLASH_SEC = 0.25;

export interface BoneStormPulseView {
  active: boolean;
  /** Flash progress 0..1. */
  t01: number;
}

interface BoneStormRecord {
  /** ribcage part index (255 when absent), resolved once. */
  ribIdx: number;
  timer: number;
  flash: number;
  /** Bursts fired since the last reset (tests/debug). */
  count: number;
  readonly view: BoneStormPulseView;
}

const RECORDS = new WeakMap<SimContext, BoneStormRecord>();

function record(ctx: SimContext): BoneStormRecord {
  let r = RECORDS.get(ctx);
  if (r === undefined) {
    const parts = ctx.state.config.bodyParts;
    let ribIdx = 255;
    for (let i = 0; i < parts.length && i < 255; i++) if (parts[i].id === 'ribcage') ribIdx = i;
    r = { ribIdx, timer: 0, flash: 0, count: 0, view: { active: false, t01: 0 } };
    RECORDS.set(ctx, r);
  }
  return r;
}

function burst(ctx: SimContext, ability: number, damage: number): void {
  const p = ctx.state.player;
  // Offset the ring each burst so consecutive volleys interleave.
  const phase = (record(ctx).count % 2) * (Math.PI / BONE_STORM_COUNT);
  for (let k = 0; k < BONE_STORM_COUNT; k++) {
    const a = phase + (k / BONE_STORM_COUNT) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    spawnProjectile(
      ctx,
      PROJECTILE_SIDE.PLAYER,
      ability,
      p.x + c * p.radius,
      p.y + sn * p.radius,
      c * BONE_STORM_SPEED,
      sn * BONE_STORM_SPEED,
      BONE_STORM_RADIUS,
      damage,
      BONE_STORM_PIERCE,
      BONE_STORM_LIFETIME,
    );
  }
}

export const boneStorm: MutationAbilityRuntime = {
  tick(ctx, dt) {
    const r = record(ctx);
    if (r.flash > 0) r.flash = Math.max(0, r.flash - dt);
    r.timer -= dt;
    if (r.timer > 0) return;
    const s = ctx.state;
    const stats = clampStats(s.player.stats, s.config.balance.caps);
    burst(ctx, r.ribIdx, BONE_STORM_DAMAGE * stats.damage);
    r.count++;
    r.flash = BONE_STORM_FLASH_SEC;
    r.timer += BONE_STORM_INTERVAL;
    if (r.timer <= 0) r.timer = BONE_STORM_INTERVAL; // long dt: no burst chain
  },
};

/** Current burst flash for rendering (reused object; do not hold across frames). */
export function boneStormPulse(ctx: SimContext): BoneStormPulseView {
  const r = record(ctx);
  const v = r.view;
  v.active = ctx.state.outcome === null && r.flash > 0;
  v.t01 = v.active ? 1 - r.flash / BONE_STORM_FLASH_SEC : 0;
  return v;
}

/** Bursts fired since the last reset. */
export function boneStormBurstCount(ctx: SimContext): number {
  return record(ctx).count;
}

export function resetBoneStorm(ctx: SimContext): void {
  const r = record(ctx);
  r.timer = 0;
  r.flash = 0;
  r.count = 0;
  r.view.active = false;
}
