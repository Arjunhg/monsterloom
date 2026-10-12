/**
 * Same-type enemy fusion (Req 21, design "MergeSystem").
 *
 * Each enemy tracks a contact partner and a timer. When two same-type,
 * same-tier, mergeable enemies have been touching each other for
 * balance.merge.contactSec, the lower id becomes a tier+1 enemy at the midpoint
 * and the higher id is freed (active count drops by exactly one, 21.6).
 *
 * Reads ctx.enemyHash (rebuilt by SpatialIndexSystem earlier in the step). The
 * hash may contain ids freed by merges earlier in this step, so every
 * candidate is checked with isAlive.
 */
import { EventType } from '../EventBus';
import { ENEMY_FLAG } from '../RunState';
import type { System } from '../SimContext';

/** Extra query slack beyond r_i, covering the partner's radius. */
const QUERY_SLACK = 40;
/** Radius growth per merge. */
const RADIUS_MULT = 1.25;
/** Visual scale growth per tier. */
const SCALE_PER_TIER = 0.35;

export const mergeSystem: System = (ctx, dt) => {
  const state = ctx.state;
  const e = state.enemies;
  const cfg = state.config.balance.merge;
  const out = ctx.scratch;
  let merges = 0;

  // Iterate by id (not activeIds) so swap-removal on free() can't skip or repeat entries.
  for (let i = 0; i < e.capacity; i++) {
    if (!e.isAlive(i)) continue;
    if (e.tier[i]! >= cfg.maxTier || (e.flags[i]! & ENEMY_FLAG.NO_MERGE) !== 0) {
      e.mergePartner[i] = -1;
      e.mergeTimer[i] = 0;
      continue;
    }

    const xi = e.x[i]!;
    const yi = e.y[i]!;
    const ri = e.radius[i]!;
    const type = e.typeId[i]!;
    const tier = e.tier[i]!;

    let j = -1;
    const n = ctx.enemyHash.queryRadius(xi, yi, ri + QUERY_SLACK, out);
    for (let k = 0; k < n; k++) {
      const c = out[k]!;
      if (c === i || !e.isAlive(c)) continue;
      if (e.typeId[c] !== type || e.tier[c] !== tier) continue;
      if ((e.flags[c]! & ENEMY_FLAG.NO_MERGE) !== 0) continue;
      const dx = e.x[c]! - xi;
      const dy = e.y[c]! - yi;
      const rr = ri + e.radius[c]!;
      if (dx * dx + dy * dy < rr * rr) {
        j = c;
        break;
      }
    }

    if (j < 0) {
      e.mergePartner[i] = -1;
      e.mergeTimer[i] = 0;
      continue;
    }
    if (j === e.mergePartner[i]) {
      e.mergeTimer[i] = e.mergeTimer[i]! + dt;
    } else {
      e.mergePartner[i] = j;
      e.mergeTimer[i] = 0;
    }

    if (
      merges < cfg.maxPerStep &&
      i < j &&
      e.mergeTimer[i]! >= cfg.contactSec &&
      e.mergePartner[j] === i &&
      e.mergeTimer[j]! >= cfg.contactSec
    ) {
      const newTier = tier + 1;
      e.x[i] = e.prevX[i] = (xi + e.x[j]!) / 2;
      e.y[i] = e.prevY[i] = (yi + e.y[j]!) / 2;
      e.tier[i] = newTier;
      e.scale[i] = 1 + SCALE_PER_TIER * newTier;
      const hpMult = Math.max(1, cfg.hpMult);
      e.hp[i] = (e.hp[i]! + e.hp[j]!) * hpMult;
      e.maxHp[i] = (e.maxHp[i]! + e.maxHp[j]!) * hpMult;
      e.energyValue[i] = e.energyValue[i]! + e.energyValue[j]!;
      e.radius[i] = ri * RADIUS_MULT;
      e.mergePartner[i] = -1;
      e.mergeTimer[i] = 0;
      e.free(j);
      merges++;
      state.events.push(EventType.merge, i, e.x[i]!, e.y[i]!, newTier);
    }
  }
};
