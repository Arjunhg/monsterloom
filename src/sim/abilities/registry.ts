/**
 * Body_Part id → AbilityRuntime registry (design "Abilities and v1 content").
 *
 * Runtimes are stateless singletons; per-run state lives in getAbilityState(ctx).
 * Parts without a registered runtime are skipped silently by AbilitySystem.
 */
import type { AbilityRuntime } from './types';
import { batWings } from './batWings';
import { blobSpit } from './blobSpit';
import { extraEye } from './extraEye';
import { fangs } from './fangs';
import { ribcage } from './ribcage';
import { swampGut } from './swampGut';
import { tentacle } from './tentacle';

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
registerAbility('extra_eye', extraEye);
registerAbility('fangs', fangs);
registerAbility('tentacle', tentacle);
registerAbility('bat_wings', batWings);
registerAbility('ribcage', ribcage);
registerAbility('swamp_gut', swampGut);
