/**
 * Beholder Gaze mutation ability (Req 20.3): a beam centred on the player that
 * rotates continuously. Every BEAM_TICK_SEC it deals BEAM_DPS × BEAM_TICK_SEC ×
 * capped stats.damage to every enemy whose circle intersects the beam segment
 * (segment-vs-circle distance test). Candidates come from the enemy hash.
 *
 * State lives in a per-SimContext record (no per-tick allocation).
 */
import type { MutationAbilityRuntime } from '../systems/MutationAbilitySystem';
import type { SimContext } from '../SimContext';
import { clampStats } from '../StatCaps';

export const BEHOLDER_ABILITY_ID = 'beholder_gaze';
export const BEAM_LENGTH = 420;
export const BEAM_WIDTH = 28;
/** Radians per second. */
export const BEAM_ANGULAR_SPEED = 2.2;
export const BEAM_DPS = 60;
export const BEAM_TICK_SEC = 0.1;
/** Damage source code for mutation damage (no body part index). */
export const BEHOLDER_DAMAGE_SOURCE = 255;
/** Extra query margin so enemies whose centre is just past the tip are found. */
const QUERY_MARGIN = 40;
const TWO_PI = Math.PI * 2;

export interface BeamView {
  active: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

interface BeamRecord {
  angle: number;
  timer: number;
  readonly view: BeamView;
}

const RECORDS = new WeakMap<SimContext, BeamRecord>();

function record(ctx: SimContext): BeamRecord {
  let r = RECORDS.get(ctx);
  if (r === undefined) {
    r = { angle: 0, timer: 0, view: { active: false, x1: 0, y1: 0, x2: 0, y2: 0, width: BEAM_WIDTH } };
    RECORDS.set(ctx, r);
  }
  return r;
}

function isOwned(ctx: SimContext): boolean {
  const s = ctx.state;
  const recipes = s.config.mutations;
  for (let i = 0; i < recipes.length; i++) {
    if (recipes[i].abilityId === BEHOLDER_ABILITY_ID && s.build.mutations.has(recipes[i].id)) return true;
  }
  return false;
}

function hitBeam(ctx: SimContext, angle: number, amount: number): void {
  const p = ctx.state.player;
  const e = ctx.state.enemies;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const half = BEAM_WIDTH / 2;
  const out = ctx.scratch;
  const n = ctx.enemyHash.queryRadius(p.x, p.y, BEAM_LENGTH + QUERY_MARGIN, out);
  for (let k = 0; k < n; k++) {
    const id = out[k];
    if (!e.isAlive(id)) continue;
    const rx = e.x[id] - p.x;
    const ry = e.y[id] - p.y;
    // Closest point on the segment [0, BEAM_LENGTH] along the unit direction.
    let t = rx * dx + ry * dy;
    if (t < 0) t = 0;
    else if (t > BEAM_LENGTH) t = BEAM_LENGTH;
    const cx = rx - dx * t;
    const cy = ry - dy * t;
    const reach = half + e.radius[id];
    if (cx * cx + cy * cy <= reach * reach) ctx.damage.push(id, amount, BEHOLDER_DAMAGE_SOURCE);
  }
}

export const beholderGaze: MutationAbilityRuntime = {
  tick(ctx, dt) {
    const r = record(ctx);
    r.angle += BEAM_ANGULAR_SPEED * dt;
    if (r.angle >= TWO_PI) r.angle -= TWO_PI * Math.floor(r.angle / TWO_PI);
    r.timer -= dt;
    if (r.timer > 0) return;
    const s = ctx.state;
    const stats = clampStats(s.player.stats, s.config.balance.caps);
    hitBeam(ctx, r.angle, BEAM_DPS * BEAM_TICK_SEC * stats.damage);
    r.timer += BEAM_TICK_SEC;
    if (r.timer <= 0) r.timer = BEAM_TICK_SEC; // long dt: no burst
  },
};

/** Current beam geometry for rendering (reused object; do not hold across frames). */
export function beholderBeam(ctx: SimContext): BeamView {
  const r = record(ctx);
  const v = r.view;
  const p = ctx.state.player;
  v.active = ctx.state.outcome === null && isOwned(ctx);
  v.x1 = p.x;
  v.y1 = p.y;
  v.x2 = p.x + Math.cos(r.angle) * BEAM_LENGTH;
  v.y2 = p.y + Math.sin(r.angle) * BEAM_LENGTH;
  v.width = BEAM_WIDTH;
  return v;
}

/** Resets all mutation ability state for `ctx` in place (call on restart). */
export function resetMutationAbilities(ctx: SimContext): void {
  const r = record(ctx);
  r.angle = 0;
  r.timer = 0;
  r.view.active = false;
}
