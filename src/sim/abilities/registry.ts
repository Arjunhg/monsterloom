/**
 * Body_Part id → AbilityRuntime registry (design "Abilities and v1 content").
 *
 * Runtimes are stateless singletons; per-run state lives in getAbilityState(ctx).
 * Parts without a registered runtime are skipped silently by AbilitySystem.
 */
import type { AbilityRuntime } from './types';
import { blobSpit } from './blobSpit';

const REGISTRY = new Map<string, AbilityRuntime>();

/** Registers (or replaces) the runtime for a body part id. */
export function registerAbility(partId: string, runtime: AbilityRuntime): void {
  REGISTRY.set(partId, runtime);
}

/** Runtime for a body part id, or undefined if none is registered. */
export function getAbility(partId: string): AbilityRuntime | undefined {
  return REGISTRY.get(partId);
}

registerAbility('blob_spit', blobSpit);
