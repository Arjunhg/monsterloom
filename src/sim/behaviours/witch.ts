/**
 * Witch behaviour (Req 22.6).
 *
 * aiState: 0 = uninitialised, 1 = active. aiTimer = fire cooldown remaining
 * (initially fireCooldown × (0.5 + rng.ai × 0.5)).
 * Movement by distance d to the player:
 *   d > keepDist + WITCH_BAND → approach; d < keepDist − WITCH_BAND → back away;
 *   otherwise strafe perpendicular at speed × WITCH_STRAFE_MUL (side by id parity).
 * Firing: when aiTimer ≤ 0 and d ≤ range, spawns an ENEMY-side projectile aimed at
 * the player's current position (speed projectileSpeed, radius 9, damage
 * projectileDmg, pierce 0, lifetime range / projectileSpeed + 0.5) and resets
 * aiTimer = fireCooldown.
 */
import { PROJECTILE_SIDE } from '../RunState';
import type { BehaviourFn } from '../systems/EnemyAISystem';
import { spawnProjectile } from '../systems/ProjectileSystem';
import { param } from './shared';

export const WITCH_BAND = 40;
export const WITCH_STRAFE_MUL = 0.3;
export const WITCH_PROJECTILE_RADIUS = 9;

export const witchBehaviour: BehaviourFn = (ctx, id, dt) => {
  const state = ctx.state;
  const e = state.enemies;
  const p = state.player;
  const cooldown = param(ctx, id, 'fireCooldown', 2.2);

  if (e.aiState[id] === 0) {
    e.aiState[id] = 1;
    e.aiTimer[id] = cooldown * (0.5 + state.rng.ai.next() * 0.5);
  }

  const dx = p.x - e.x[id];
  const dy = p.y - e.y[id];
  const d = Math.hypot(dx, dy);
  const keep = param(ctx, id, 'keepDist', 300);
  const speed = e.speed[id] * (1 - e.slowAmt[id]);

  if (!(d > 1e-6)) {
    // On top of the player: back off along +x.
    e.vx[id] = -speed;
    e.vy[id] = 0;
  } else {
    const ux = dx / d;
    const uy = dy / d;
    if (d > keep + WITCH_BAND) {
      e.vx[id] = ux * speed;
      e.vy[id] = uy * speed;
    } else if (d < keep - WITCH_BAND) {
      e.vx[id] = -ux * speed;
      e.vy[id] = -uy * speed;
    } else {
      const side = (id & 1) === 0 ? 1 : -1;
      const s = speed * WITCH_STRAFE_MUL * side;
      e.vx[id] = -uy * s;
      e.vy[id] = ux * s;
    }
  }

  e.aiTimer[id] = Math.max(0, e.aiTimer[id] - dt);
  const range = param(ctx, id, 'range', 460);
  if (e.aiTimer[id] <= 0 && d <= range && d > 1e-6) {
    const ps = param(ctx, id, 'projectileSpeed', 260);
    const dmg = param(ctx, id, 'projectileDmg', 10);
    spawnProjectile(
      ctx,
      PROJECTILE_SIDE.ENEMY,
      255,
      e.x[id],
      e.y[id],
      (dx / d) * ps,
      (dy / d) * ps,
      WITCH_PROJECTILE_RADIUS,
      dmg,
      0,
      range / ps + 0.5,
    );
    e.aiTimer[id] = cooldown;
  }
};
