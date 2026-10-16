/**
 * Drives owned mutation abilities (Req 20.3).
 *
 * For each recipe in config.mutations order (deterministic) that the player
 * owns, looks up the runtime registered for its abilityId and ticks it.
 * Body-part abilities (including merged parts) are still driven by AbilitySystem.
 */
import { beholderGaze, BEHOLDER_ABILITY_ID, resetMutationAbilities } from '../abilities/beholderGaze';
import { BOG_KRAKEN_ABILITY_ID, bogKraken, resetBogKraken } from '../abilities/bogKraken';
import { BONE_STORM_ABILITY_ID, boneStorm, resetBoneStorm } from '../abilities/boneStorm';
import { resetWerewolfFrenzy, WEREWOLF_ABILITY_ID, werewolfFrenzy } from '../abilities/werewolfFrenzy';
import type { SimContext, System } from '../SimContext';

export interface MutationAbilityRuntime {
  tick(ctx: SimContext, dt: number): void;
}

const registry = new Map<string, MutationAbilityRuntime>();

/** Registers (or replaces) the runtime for a mutation abilityId. */
export function registerMutationAbility(abilityId: string, runtime: MutationAbilityRuntime): void {
  registry.set(abilityId, runtime);
}

export function getMutationAbility(abilityId: string): MutationAbilityRuntime | undefined {
  return registry.get(abilityId);
}

registerMutationAbility(BEHOLDER_ABILITY_ID, beholderGaze);
registerMutationAbility(WEREWOLF_ABILITY_ID, werewolfFrenzy);
registerMutationAbility(BONE_STORM_ABILITY_ID, boneStorm);
registerMutationAbility(BOG_KRAKEN_ABILITY_ID, bogKraken);

/** Clears every built-in mutation ability's per-ctx state in place (call on restart). */
export function resetAllMutationAbilities(ctx: SimContext): void {
  resetMutationAbilities(ctx);
  resetWerewolfFrenzy(ctx);
  resetBoneStorm(ctx);
  resetBogKraken(ctx);
}

export const mutationAbilitySystem: System = (ctx, dt) => {
  const state = ctx.state;
  if (state.outcome !== null) return;
  const owned = state.build.mutations;
  if (owned.size === 0) return;
  const recipes = state.config.mutations;
  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];
    if (!owned.has(r.id)) continue;
    const runtime = registry.get(r.abilityId);
    if (runtime !== undefined) runtime.tick(ctx, dt);
  }
};
