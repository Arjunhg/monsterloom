/**
 * Effective ability parameters (design "Abilities and v1 content", Req 11.3, 12.1).
 *
 * effective = levels[level − 1] + rareBonus × rareBonuses (numeric fields),
 * then damage × capped stats.damage and cooldown ÷ capped stats.attackSpeed.
 * Allocation-free: callers pass a reusable `out` object (see createParams()).
 */
import { NON_DAMAGE_FIELDS, type AbilityParams } from '../../data/bodyParts';
import type { RunState } from '../RunState';
import { clampStats } from '../StatCaps';

/** Fresh params object for use as a reusable `out` buffer. */
export function createParams(): AbilityParams {
  return { damage: 0 };
}

/**
 * Writes the effective params of config.bodyParts[partIndex] at its owned
 * level into `out` and returns `out`. Fields absent from the level entry are
 * left `undefined` (unless the rare bonus supplies them). Returns null when
 * the part is unknown or not owned.
 */
export function effectiveParams(state: RunState, partIndex: number, out: AbilityParams): AbilityParams | null {
  const def = state.config.bodyParts[partIndex];
  if (def === undefined) return null;
  const owned = state.build.parts.get(def.id);
  if (owned === undefined || def.levels.length === 0) return null;

  const lvl = Math.min(def.levels.length, Math.max(1, owned.level | 0));
  const base = def.levels[lvl - 1];
  const bonus = def.rareBonus;
  const n = owned.rareBonuses > 0 ? owned.rareBonuses : 0;

  out.damage = base.damage + (bonus?.damage ?? 0) * n;
  // NON_DAMAGE_FIELDS never contains 'damage', so every written field is optional.
  const w = out as Partial<Record<keyof AbilityParams, number>>;
  for (let i = 0; i < NON_DAMAGE_FIELDS.length; i++) {
    const k = NON_DAMAGE_FIELDS[i];
    const b = base[k];
    const r = bonus === undefined ? undefined : bonus[k];
    if (b === undefined && (r === undefined || n === 0)) {
      w[k] = undefined;
    } else {
      w[k] = (b ?? 0) + (r ?? 0) * n;
    }
  }

  const stats = clampStats(state.player.stats, state.config.balance.caps);
  out.damage *= stats.damage;
  if (out.cooldown !== undefined) out.cooldown /= stats.attackSpeed;
  return out;
}
