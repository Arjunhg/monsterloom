/** Config invariant checks (design "Config data"; Req 6.3, 11.1, 11.3, 11.4, 12.2, 12.3, 13.2, 20.1a). */
import type { Balance } from './balance';
import type { EnemyType } from './enemies';
import type { Stage } from './stages';
import { ABILITY_KINDS, NON_DAMAGE_FIELDS, type BodyPartDef } from './bodyParts';
import type { MutationRecipe } from './mutations';
import type { SwarmEventDef } from './swarmEvents';

export interface GameConfig {
  balance: Balance;
  enemies: EnemyType[];
  stages: Stage[];
  bodyParts: BodyPartDef[];
  mutations: MutationRecipe[];
  /** v2 scripted swarm events. Optional so v1-shaped configs (tests) still type-check. */
  swarmEvents?: SwarmEventDef[];
}

export interface ValidateOptions {
  /** Enable v2-only invariants (stage gaps ≤ 120 s, ≥ 4 recipes). */
  v2?: boolean;
}

const MAX_STAGE_GAP_SEC = 120;
const MIN_V2_RECIPES = 4;
const MIN_V2_SWARMS = 2;
const MIN_V1_PARTS = 6;
const MIN_V1_ENEMIES = 3;

/** Returns a list of human-readable errors; an empty list means the config is valid. */
export function validateConfig(cfg: GameConfig, opts: ValidateOptions = {}): string[] {
  const errors: string[] = [];
  const { balance, enemies, stages, bodyParts, mutations } = cfg;

  // Rarity weights ordered and positive (Req 10.2).
  const w = balance.rarityWeights;
  if (!(w.common > w.rare && w.rare > w.epic && w.epic > 0)) {
    errors.push(
      `rarityWeights must satisfy common > rare > epic > 0 (got ${w.common}/${w.rare}/${w.epic})`,
    );
  }

  // Credit coefficients non-negative so creditRate is non-decreasing (Req 5.3, 12.2).
  const c = balance.credits;
  for (const key of ['base', 'lin', 'quad', 'maxCarry'] as const) {
    if (!(c[key] >= 0)) errors.push(`credits.${key} must be >= 0 (got ${c[key]})`);
  }

  // Night length within bounds (Req 13.2).
  const r = balance.run;
  if (!(r.minSec <= r.maxSec)) errors.push(`run.minSec (${r.minSec}) must be <= run.maxSec (${r.maxSec})`);
  if (!(r.durationSec >= r.minSec && r.durationSec <= r.maxSec)) {
    errors.push(`run.durationSec (${r.durationSec}) must be within [${r.minSec}, ${r.maxSec}]`);
  }

  if (!(balance.merge.maxTier >= 1)) errors.push(`merge.maxTier must be >= 1 (got ${balance.merge.maxTier})`);

  // Body parts.
  const partIds = new Set<string>();
  const partMaxLevel = new Map<string, number>();
  for (const part of bodyParts) {
    if (partIds.has(part.id)) errors.push(`duplicate body part id '${part.id}'`);
    partIds.add(part.id);
    partMaxLevel.set(part.id, part.maxLevel);

    if (part.levels.length !== part.maxLevel) {
      errors.push(`part '${part.id}' has ${part.levels.length} levels, expected maxLevel ${part.maxLevel}`);
    }
    if (part.rarities.length === 0) errors.push(`part '${part.id}' supports no rarities`);

    // Each level must differ from the previous in at least one non-damage field (Req 11.3).
    for (let i = 1; i < part.levels.length; i++) {
      const prev = part.levels[i - 1];
      const cur = part.levels[i];
      const differs = NON_DAMAGE_FIELDS.some((f) => prev[f] !== cur[f]);
      if (!differs) {
        errors.push(`part '${part.id}' level ${i + 1} changes no non-damage field vs level ${i}`);
      }
    }
  }

  // v1 content: ≥6 offerable parts covering every ability kind (Req 11.1, 11.4).
  const offerable = bodyParts.filter((p) => !p.starter);
  if (offerable.length < MIN_V1_PARTS) {
    errors.push(`need >= ${MIN_V1_PARTS} non-starter body parts (got ${offerable.length})`);
  }
  const kinds = new Set(offerable.map((p) => p.ability));
  for (const k of ABILITY_KINDS) {
    if (!kinds.has(k)) errors.push(`no non-starter body part provides ability kind '${k}'`);
  }

  // Mutation recipes reference existing parts at reachable levels (Req 20.1a).
  const recipeIds = new Set<string>();
  for (const m of mutations) {
    if (recipeIds.has(m.id)) errors.push(`duplicate mutation id '${m.id}'`);
    recipeIds.add(m.id);
    if (m.requires.length === 0) errors.push(`mutation '${m.id}' has no requirements`);
    for (const req of m.requires) {
      const max = partMaxLevel.get(req.partId);
      if (max === undefined) {
        errors.push(`mutation '${m.id}' requires unknown part '${req.partId}'`);
      } else if (!(req.minLevel >= 1 && req.minLevel <= max)) {
        errors.push(
          `mutation '${m.id}' requires '${req.partId}' at level ${req.minLevel}, outside [1, ${max}]`,
        );
      }
    }
    for (const pid of m.consumes) {
      if (!partIds.has(pid)) errors.push(`mutation '${m.id}' consumes unknown part '${pid}'`);
    }
  }

  // Enemies (Req 6.3).
  const enemyIds = new Set<string>();
  for (const e of enemies) {
    if (enemyIds.has(e.id)) errors.push(`duplicate enemy id '${e.id}'`);
    enemyIds.add(e.id);
    if (!(e.threatCost > 0)) errors.push(`enemy '${e.id}' threatCost must be > 0`);
  }
  if (enemies.length < MIN_V1_ENEMIES) {
    errors.push(`need >= ${MIN_V1_ENEMIES} enemy types (got ${enemies.length})`);
  }

  // Stages reference existing types and are ordered.
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    for (const t of s.addTypes) {
      if (!enemyIds.has(t)) errors.push(`stage at ${s.atSec}s adds unknown enemy type '${t}'`);
    }
    if (i > 0 && !(s.atSec > stages[i - 1].atSec)) {
      errors.push(`stage ${i} atSec (${s.atSec}) must be greater than previous (${stages[i - 1].atSec})`);
    }
  }
  if (stages.length === 0 || stages[0].atSec !== 0) errors.push('first stage must start at 0s');

  if (opts.v2) {
    // New behaviour every ≤120 s (Req 22.2).
    for (let i = 1; i < stages.length; i++) {
      const gap = stages[i].atSec - stages[i - 1].atSec;
      if (gap > MAX_STAGE_GAP_SEC) {
        errors.push(`stage gap ${stages[i - 1].atSec}s→${stages[i].atSec}s exceeds ${MAX_STAGE_GAP_SEC}s`);
      }
    }
    if (mutations.length < MIN_V2_RECIPES) {
      errors.push(`v2 needs >= ${MIN_V2_RECIPES} mutation recipes (got ${mutations.length})`);
    }

    // Every stage must land before the boss arrives (Req 22.2, 24.1).
    const bossAt = balance.run.durationSec - balance.run.bossLeadSec;
    for (const s of stages) {
      if (s.atSec >= bossAt) errors.push(`stage at ${s.atSec}s starts at or after the boss (${bossAt}s)`);
    }

    // Swarm events (Req 23.1).
    const swarms = cfg.swarmEvents ?? [];
    if (swarms.length < MIN_V2_SWARMS) errors.push(`v2 needs >= ${MIN_V2_SWARMS} swarm events (got ${swarms.length})`);
    if (!swarms.some((s) => s.kind === 'ring')) errors.push('v2 needs at least one ring swarm event');
    if (!swarms.some((s) => s.kind === 'stampede')) errors.push('v2 needs at least one stampede swarm event');
    for (const s of swarms) {
      if (!enemyIds.has(s.typeId)) errors.push(`swarm event at ${s.atSec}s uses unknown enemy type '${s.typeId}'`);
      if (!(s.count > 0)) errors.push(`swarm event at ${s.atSec}s needs count > 0`);
      if (!(s.atSec >= 2 && s.atSec < balance.run.durationSec)) {
        errors.push(`swarm event at ${s.atSec}s must be within [2, duration)`);
      }
    }

    // Exactly one boss, never in the stage pool, never mergeable (Req 21.4, 24.1).
    const bosses = enemies.filter((e) => e.boss);
    if (bosses.length !== 1) errors.push(`v2 needs exactly one boss enemy type (got ${bosses.length})`);
    for (const b of bosses) {
      if (b.canMerge) errors.push(`boss '${b.id}' must have canMerge: false`);
      if (stages.some((s) => s.addTypes.includes(b.id))) errors.push(`boss '${b.id}' must not be in a spawn stage`);
    }
    // Ghost behaviour must skip separation and merging (Req 22.4).
    for (const g of enemies.filter((e) => e.behaviour === 'ghost')) {
      if (g.canMerge || !g.noSeparation) errors.push(`ghost '${g.id}' must have canMerge: false and noSeparation: true`);
    }
    // Every v2 behaviour must be introduced by some stage.
    const staged = new Set(stages.flatMap((s) => s.addTypes));
    for (const beh of ['bat', 'ghost', 'slime', 'witch'] as const) {
      if (!enemies.some((e) => e.behaviour === beh && staged.has(e.id))) {
        errors.push(`no stage introduces an enemy with behaviour '${beh}'`);
      }
    }
    if (!(balance.elite.maxChance >= 0 && balance.elite.maxChance <= 1)) errors.push('elite.maxChance must be in [0, 1]');
    if (!(balance.elite.hpMult >= 1)) errors.push('elite.hpMult must be >= 1');
  }

  return errors;
}
