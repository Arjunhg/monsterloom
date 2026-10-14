/**
 * MutationSystem (design "MutationSystem", Req 20.1a–20.5).
 *
 * - `isEligible` is pure: a recipe is eligible when it is not yet owned and
 *   every required part is owned at or above its minimum level.
 * - Eligible mutations are fed to UpgradeSystem through its hooks; UpgradeSystem
 *   forces them into the first offer slots as Epic offers (Req 20.2).
 * - Applying a mutation records it in `build.mutations`, flags each consumed
 *   part as `merged` (sprite hidden, ability still active; the part still counts
 *   toward maxParts) and emits a `mutation` event with the recipe index.
 *   The mutation's ability is driven by MutationAbilitySystem.
 *
 * Importing this module installs the hooks (installMutationHooks is idempotent).
 */
import type { MutationRecipe } from '../../data/mutations';
import { EventType } from '../EventBus';
import type { RunState } from '../RunState';
import { registerMutationApplier, registerMutationCandidates, type Candidate } from './UpgradeSystem';

/** True when `recipe` is not owned and every requirement is met by `owned`. */
export function isEligible(
  recipe: MutationRecipe,
  owned: ReadonlyMap<string, { level: number }>,
  ownedMutations: ReadonlySet<string>,
): boolean {
  if (ownedMutations.has(recipe.id)) return false;
  for (const req of recipe.requires) {
    const part = owned.get(req.partId);
    if (part === undefined || part.level < req.minLevel) return false;
  }
  return true;
}

/** Eligible recipes in config order. */
export function eligibleMutations(state: RunState): MutationRecipe[] {
  const out: MutationRecipe[] = [];
  for (const recipe of state.config.mutations) {
    if (isEligible(recipe, state.build.parts, state.build.mutations)) out.push(recipe);
  }
  return out;
}

/** Applies mutation `mutationId` if eligible. Returns true when applied. */
export function applyMutation(state: RunState, mutationId: string): boolean {
  const index = state.config.mutations.findIndex((m) => m.id === mutationId);
  if (index < 0) return false;
  const recipe = state.config.mutations[index];
  if (!isEligible(recipe, state.build.parts, state.build.mutations)) return false;
  state.build.mutations.add(recipe.id);
  for (const partId of recipe.consumes) {
    const part = state.build.parts.get(partId);
    if (part !== undefined) part.merged = true;
  }
  state.events.push(EventType.mutation, index);
  return true;
}

function mutationCandidates(state: RunState): Candidate[] {
  return eligibleMutations(state).map((recipe) => ({
    kind: 'mutation' as const,
    mutationId: recipe.id,
    rarities: ['epic'] as const,
    name: recipe.name,
    icon: recipe.spriteKey,
    descriptionKey: `mutation.${recipe.id}`,
  }));
}

let installed = false;

/** Registers the mutation candidate provider and applier with UpgradeSystem (idempotent). */
export function installMutationHooks(): void {
  if (installed) return;
  installed = true;
  registerMutationCandidates(mutationCandidates);
  registerMutationApplier((state, offer) => {
    if (offer.mutationId !== undefined) applyMutation(state, offer.mutationId);
  });
}

installMutationHooks();

export const MutationSystem = { isEligible, eligibleMutations, apply: applyMutation, install: installMutationHooks };
