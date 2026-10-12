/**
 * Ability framework types (design "Abilities and v1 content", Req 4).
 *
 * Each Body_Part id maps to one AbilityRuntime registered in ./registry.ts.
 * Runtimes are stateless singletons: all per-run state lives in an
 * AbilityRuntimeState allocated ONCE per SimContext (Req 16.2) and indexed by
 * the part's index in `config.bodyParts`.
 */
import type { AbilityParams } from '../../data/bodyParts';
import type { SimContext } from '../SimContext';

export interface AbilityRuntime {
  /** Called the first tick a part is owned (also after a restart re-grants it). */
  onEquip(ctx: SimContext, partIndex: number): void;
  /** Called when an owned part's level changes (after onEquip on the equip tick it is NOT called). */
  onLevel(ctx: SimContext, partIndex: number, level: number): void;
  /** Called every tick while the part is owned (merged parts still tick). */
  tick(ctx: SimContext, dt: number, partIndex: number, params: AbilityParams): void;
}

/** Number of generic float slots each part gets in `AbilityRuntimeState.data`. */
export const ABILITY_DATA_SLOTS = 8;

export interface AbilityRuntimeState {
  readonly partCount: number;
  /** Seconds until each part's next activation. */
  readonly cooldown: Float32Array;
  /** Level last seen by AbilitySystem (0 = not owned). Drives onEquip/onLevel. */
  readonly level: Uint8Array;
  /** Free-form per-part floats (orbit angle, dash timer, …): slot k of part i is `data[i * ABILITY_DATA_SLOTS + k]`. */
  readonly data: Float32Array;
}

const STATES = new WeakMap<SimContext, AbilityRuntimeState>();

/** Returns the ability state for `ctx`, creating it once on first use. */
export function getAbilityState(ctx: SimContext): AbilityRuntimeState {
  let s = STATES.get(ctx);
  if (s === undefined) {
    const n = ctx.state.config.bodyParts.length;
    s = {
      partCount: n,
      cooldown: new Float32Array(n),
      level: new Uint8Array(n),
      data: new Float32Array(n * ABILITY_DATA_SLOTS),
    };
    STATES.set(ctx, s);
  }
  return s;
}

/** Clears all ability state in place (no reallocation). Call on restart. */
export function resetAbilityState(ctx: SimContext): void {
  const s = getAbilityState(ctx);
  s.cooldown.fill(0);
  s.level.fill(0);
  s.data.fill(0);
}
