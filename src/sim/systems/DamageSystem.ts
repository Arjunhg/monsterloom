/**
 * Applies queued enemy damage in push order (Req 4.5–4.6, 7.1).
 *
 * For each entry: skip dead enemies; hp −= amount; stats.damageDealt += amount;
 * hitFlash = HIT_FLASH_SEC; emit enemyHit. When hp ≤ 0: emit enemyKilled
 * (id, x, y, typeId), kills++, run onEnemyKilled hooks, drop an orb worth
 * energyValue at the enemy's position, free the enemy. The queue is then cleared.
 * Before draining, hitFlash of alive enemies is ticked down.
 */
import { spawnOrb } from '../entities';
import { EventType } from '../EventBus';
import type { SimContext, System } from '../SimContext';

export const HIT_FLASH_SEC = 0.08;

/** Called with (ctx, enemyId) for every kill, after enemyKilled is emitted and before the enemy is freed. */
export type EnemyKilledHook = (ctx: SimContext, id: number) => void;

/** Kill hooks (v2: slime split, elite tokens). Push to register. */
export const onEnemyKilled: EnemyKilledHook[] = [];

export const damageSystem: System = (ctx, dt) => {
  const state = ctx.state;
  const enemies = state.enemies;
  const q = ctx.damage;

  const ids = enemies.pool.activeIds;
  for (let k = 0; k < enemies.count; k++) {
    const id = ids[k];
    if (enemies.hitFlash[id] > 0) enemies.hitFlash[id] = Math.max(0, enemies.hitFlash[id] - dt);
  }

  for (let i = 0; i < q.count; i++) {
    const id = q.enemy[i];
    if (!enemies.isAlive(id)) continue;
    // All queued damage is player damage; scale it for wide screens (1 on portrait).
    const amount = q.amount[i] * (state.player.viewBoost || 1);
    enemies.hp[id] -= amount;
    state.stats.damageDealt += amount;
    enemies.hitFlash[id] = HIT_FLASH_SEC;
    state.events.push(EventType.enemyHit, id, amount);
    if (enemies.hp[id] <= 0) {
      const x = enemies.x[id];
      const y = enemies.y[id];
      state.events.push(EventType.enemyKilled, id, x, y, enemies.typeId[id]);
      state.stats.kills++;
      for (let h = 0; h < onEnemyKilled.length; h++) onEnemyKilled[h](ctx, id);
      spawnOrb(state, x, y, enemies.energyValue[id]);
      enemies.free(id);
    }
  }
  q.clear();
};
