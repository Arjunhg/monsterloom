/**
 * Shared per-step context passed to every system (design "Systems").
 *
 * Owned and wired by Sim.ts (task 8.1). Systems receive `(ctx, dt)`.
 * - `enemyHash` is rebuilt once per step by SpatialIndexSystem after enemy
 *   movement; later systems (separation, merge, abilities, projectiles,
 *   contact) query it. Ids in the hash are enemy slot ids.
 * - `view` is the visible camera rectangle size in world px, centred on the
 *   player. Defaults to the portrait 720×1560 canvas (tests, headless); GameScene
 *   mutates it every frame to the live camera size before sim.advance(). Systems
 *   must read it at call time (never cache it in module constants).
 * - Damage to enemies is queued and applied by DamageSystem (see damageQueue).
 */
import type { RunState } from './RunState';
import { SpatialHash } from './spatial/SpatialHash';

export const VIEW_WIDTH = 720;
export const VIEW_HEIGHT = 1560;
export const ENEMY_HASH_CELL = 64;

/** Fixed-capacity queue of pending enemy damage, applied in order by DamageSystem. */
export class DamageQueue {
  readonly capacity: number;
  readonly enemy: Int32Array;
  readonly amount: Float32Array;
  /** Ability index (body part index in config.bodyParts, or 255 for none) that dealt the damage. */
  readonly source: Uint8Array;
  count = 0;
  dropped = 0;

  constructor(capacity = 4096) {
    this.capacity = capacity;
    this.enemy = new Int32Array(capacity);
    this.amount = new Float32Array(capacity);
    this.source = new Uint8Array(capacity);
  }

  push(enemyId: number, amount: number, source = 255): void {
    if (!(amount > 0)) return;
    if (this.count === this.capacity) {
      this.dropped++;
      return;
    }
    const i = this.count++;
    this.enemy[i] = enemyId;
    this.amount[i] = amount;
    this.source[i] = source;
  }

  clear(): void {
    this.count = 0;
  }
}

export interface SimContext {
  state: RunState;
  enemyHash: SpatialHash;
  view: { width: number; height: number };
  damage: DamageQueue;
  /** Reusable scratch array for hash.queryRadius results. Do not hold across calls. */
  scratch: number[];
}

/** A simulation system: runs once per fixed step, in the order wired by Sim.ts. */
export type System = (ctx: SimContext, dt: number) => void;

// Player/entity helpers live in ./entities but are re-exported here for convenience.
export { damagePlayer, healPlayer, spawnEnemy, spawnOrb } from './entities';

export function createSimContext(state: RunState): SimContext {
  return {
    state,
    enemyHash: new SpatialHash(ENEMY_HASH_CELL, state.enemies.capacity),
    view: { width: VIEW_WIDTH, height: VIEW_HEIGHT },
    damage: new DamageQueue(),
    scratch: [],
  };
}
