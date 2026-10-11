import { BALANCE } from './balance';
import { ENEMIES } from './enemies';
import { STAGES } from './stages';
import { BODY_PARTS } from './bodyParts';
import { MUTATIONS } from './mutations';
import type { GameConfig } from './validateConfig';

export * from './balance';
export * from './enemies';
export * from './stages';
export * from './bodyParts';
export * from './mutations';
export * from './validateConfig';

/** Default config bundle used by the game and tests. */
export const GAME_CONFIG: GameConfig = {
  balance: BALANCE,
  enemies: ENEMIES,
  stages: STAGES,
  bodyParts: BODY_PARTS,
  mutations: MUTATIONS,
};
