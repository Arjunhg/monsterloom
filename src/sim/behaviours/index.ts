/**
 * v2 enemy behaviours (design "Enemy behaviours"; Req 22.3–22.6).
 * installV2Behaviours() registers bat/ghost/slime/witch steering and the slime
 * split kill hook. Idempotent.
 */
import { BEHAVIOUR_CODE } from '../entities';
import { onEnemyKilled } from '../systems/DamageSystem';
import { registerBehaviour } from '../systems/EnemyAISystem';
import { batBehaviour } from './bat';
import { ghostBehaviour } from './ghost';
import { slimeBehaviour, slimeKillHook } from './slime';
import { witchBehaviour } from './witch';

export * from './bat';
export * from './ghost';
export * from './slime';
export * from './witch';

export function installV2Behaviours(): void {
  registerBehaviour(BEHAVIOUR_CODE.bat, batBehaviour);
  registerBehaviour(BEHAVIOUR_CODE.ghost, ghostBehaviour);
  registerBehaviour(BEHAVIOUR_CODE.slime, slimeBehaviour);
  registerBehaviour(BEHAVIOUR_CODE.witch, witchBehaviour);
  if (!onEnemyKilled.includes(slimeKillHook)) onEnemyKilled.push(slimeKillHook);
}
