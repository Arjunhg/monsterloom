/** Player stat multipliers and their caps (Req 12.1). */
import type { Balance } from '../data/balance';

export interface StatMultipliers {
  damage: number;
  attackSpeed: number;
  moveSpeed: number;
  pickupRadius: number;
}

export const STAT_KEYS: readonly (keyof StatMultipliers)[] = [
  'damage',
  'attackSpeed',
  'moveSpeed',
  'pickupRadius',
];

/**
 * Lower bound for every multiplier. Nothing in the design reduces player stats,
 * but a floor keeps a bad config or debuff from producing zero/negative speed
 * or damage (which would break movement and cooldown maths).
 */
export const STAT_FLOOR = 0.1;

export function defaultStats(): StatMultipliers {
  return { damage: 1, attackSpeed: 1, moveSpeed: 1, pickupRadius: 1 };
}

/** Clamps every multiplier in place to [STAT_FLOOR, cap]. Non-finite values reset to 1. */
export function clampStats(stats: StatMultipliers, caps: Balance['caps']): StatMultipliers {
  for (const k of STAT_KEYS) {
    const v = Number.isFinite(stats[k]) ? stats[k] : 1;
    stats[k] = Math.min(caps[k], Math.max(STAT_FLOOR, v));
  }
  return stats;
}

export const StatCaps = { clamp: clampStats };
