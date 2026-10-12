/**
 * Drives owned body-part abilities (Req 4.1, 4.4, 11.3).
 *
 * Iterates config.bodyParts in order (deterministic). For each owned part with
 * a registered runtime: onEquip on the first owned tick, onLevel when the owned
 * level changes, then tick with the effective params. Parts that stop being
 * owned have their tracked level reset to 0 so a re-grant calls onEquip again.
 */
import type { AbilityParams } from '../../data/bodyParts';
import { createParams, effectiveParams } from '../abilities/params';
import { getAbility } from '../abilities/registry';
import { getAbilityState } from '../abilities/types';
import type { System } from '../SimContext';

const params: AbilityParams = createParams();

export const abilitySystem: System = (ctx, dt) => {
  const state = ctx.state;
  if (state.outcome !== null) return;
  const parts = state.config.bodyParts;
  const abState = getAbilityState(ctx);
  for (let i = 0; i < parts.length; i++) {
    const def = parts[i];
    const owned = state.build.parts.get(def.id);
    if (owned === undefined) {
      abState.level[i] = 0;
      continue;
    }
    const runtime = getAbility(def.id);
    if (runtime === undefined) continue;

    const level = Math.min(255, Math.max(1, owned.level | 0));
    const seen = abState.level[i];
    if (seen === 0) {
      abState.level[i] = level;
      runtime.onEquip(ctx, i);
    } else if (seen !== level) {
      abState.level[i] = level;
      runtime.onLevel(ctx, i, level);
    }

    if (effectiveParams(state, i, params) === null) continue;
    runtime.tick(ctx, dt, i, params);
  }
};
