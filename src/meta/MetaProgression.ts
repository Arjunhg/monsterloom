/**
 * MetaProgression (task 20.1, Req 26): permanent between-run progression.
 *
 * Players earn Bones at run end (`rewardFor`) and spend them on a small
 * catalogue limited by Req 26.5 to starting body parts and capped stat
 * bonuses (cosmetic application arrives with the shop in task 23; the
 * schema already carries the fields). State persists through
 * PlatformService storage under META_STORAGE_KEY (SDK key rules: no dots).
 *
 * Failure semantics:
 *  - Absent key -> default state, saves allowed.
 *  - Stored data failing validation (incl. malformed JSON) -> default state
 *    in memory, saves BLOCKED for the session so the stored blob is left
 *    untouched (Req 26.7).
 *  - Storage unavailable / transport error -> default state in memory,
 *    play continues, and saving is retried at the next run end (Req 26.4).
 */
import type { PlatformService } from '../platform/PlatformService';
import type { RunBonuses } from '../sim/RunState';
import { STAT_KEYS, defaultStats, type StatMultipliers } from '../sim/StatCaps';

export const META_STORAGE_KEY = 'mms_meta_v1';
export const META_VERSION = 1;
/** Display name of the meta currency. */
export const META_CURRENCY_NAME = 'Bones';
export const MAX_STAT_BONUS_LEVEL = 5;
export const STAT_BONUS_PER_LEVEL = 0.04;
const MAX_CURRENCY = 1_000_000;

export type StatKey = keyof StatMultipliers;

export interface MetaState {
  version: typeof META_VERSION;
  currency: number;
  /** Owned one-time unlock ids (starting-part unlocks). */
  unlocks: string[];
  /** Purchased stat bonus levels per stat (0..MAX_STAT_BONUS_LEVEL). */
  statBonuses: Partial<Record<StatKey, number>>;
  /** Owned cosmetic ids (applied visually from task 23). */
  cosmetics: string[];
  /** Equipped cosmetic id, or null. */
  equipped: string | null;
}

export function defaultMetaState(): MetaState {
  return { version: META_VERSION, currency: 0, unlocks: [], statBonuses: {}, cosmetics: [], equipped: null };
}

// ---------------------------------------------------------------------------
// Unlock catalogue (Req 26.5: starting parts + capped stat bonuses only)
// ---------------------------------------------------------------------------
export type UnlockDef =
  | {
      kind: 'stat';
      id: string;
      stat: StatKey;
      name: string;
      description: string;
      /** Cost per level, index = current level. Length = MAX_STAT_BONUS_LEVEL. */
      costs: readonly number[];
    }
  | {
      kind: 'startingPart';
      id: string;
      partId: string;
      name: string;
      description: string;
      cost: number;
    };

const STAT_COSTS: readonly number[] = [15, 25, 40, 60, 85];
const STARTING_PART_COST = 120;

export const UNLOCK_CATALOGUE: readonly UnlockDef[] = [
  { kind: 'stat', id: 'stat_damage', stat: 'damage', name: 'Sharper Bits', description: '+4% damage per level', costs: STAT_COSTS },
  { kind: 'stat', id: 'stat_attackSpeed', stat: 'attackSpeed', name: 'Quick Twitch', description: '+4% attack speed per level', costs: STAT_COSTS },
  { kind: 'stat', id: 'stat_moveSpeed', stat: 'moveSpeed', name: 'Longer Legs', description: '+4% move speed per level', costs: STAT_COSTS },
  { kind: 'stat', id: 'stat_pickupRadius', stat: 'pickupRadius', name: 'Sticky Skin', description: '+4% pickup radius per level', costs: STAT_COSTS },
  { kind: 'startingPart', id: 'start_extra_eye', partId: 'extra_eye', name: 'Start: Extra Eye', description: 'Begin every night with Extra Eye', cost: STARTING_PART_COST },
  { kind: 'startingPart', id: 'start_fangs', partId: 'fangs', name: 'Start: Fangs', description: 'Begin every night with Fangs', cost: STARTING_PART_COST },
  { kind: 'startingPart', id: 'start_tentacle', partId: 'tentacle', name: 'Start: Tentacle', description: 'Begin every night with Tentacle', cost: STARTING_PART_COST },
  { kind: 'startingPart', id: 'start_bat_wings', partId: 'bat_wings', name: 'Start: Bat Wings', description: 'Begin every night with Bat Wings', cost: STARTING_PART_COST },
  { kind: 'startingPart', id: 'start_ribcage', partId: 'ribcage', name: 'Start: Ribcage', description: 'Begin every night with Ribcage', cost: STARTING_PART_COST },
  { kind: 'startingPart', id: 'start_swamp_gut', partId: 'swamp_gut', name: 'Start: Swamp Gut', description: 'Begin every night with Swamp Gut', cost: STARTING_PART_COST },
];

const CATALOGUE_BY_ID = new Map(UNLOCK_CATALOGUE.map((d) => [d.id, d]));

export function unlockDef(id: string): UnlockDef | undefined {
  return CATALOGUE_BY_ID.get(id);
}

/** Cost of the next purchase of `def`, or null when owned/maxed. */
export function nextCostFor(state: MetaState, def: UnlockDef): number | null {
  if (def.kind === 'startingPart') return state.unlocks.includes(def.id) ? null : def.cost;
  const level = state.statBonuses[def.stat] ?? 0;
  return level >= MAX_STAT_BONUS_LEVEL ? null : def.costs[level];
}

/** Stat multipliers granted by purchased bonus levels (all 1 with no bonuses). */
export function statMultipliersFor(state: MetaState): StatMultipliers {
  const out = defaultStats();
  for (const k of STAT_KEYS) {
    const level = Math.min(MAX_STAT_BONUS_LEVEL, Math.max(0, Math.floor(state.statBonuses[k] ?? 0)));
    out[k] = 1 + STAT_BONUS_PER_LEVEL * level;
  }
  return out;
}

/** Body part ids equipped at run start from owned starting-part unlocks (catalogue order). */
export function startingPartIdsFor(state: MetaState): string[] {
  const owned = new Set(state.unlocks);
  return UNLOCK_CATALOGUE.filter((d) => d.kind === 'startingPart' && owned.has(d.id)).map(
    (d) => (d as Extract<UnlockDef, { kind: 'startingPart' }>).partId,
  );
}

/**
 * Bones awarded for a finished run (Req 26.1, design formula):
 * floor(floor(survivalSec/10 + kills/25) × (victory ? 1.5 : 1)).
 */
export function rewardFor(survivalSec: number, kills: number, victory: boolean): number {
  const sec = Number.isFinite(survivalSec) ? Math.max(0, survivalSec) : 0;
  const k = Number.isFinite(kills) ? Math.max(0, kills) : 0;
  return Math.floor(Math.floor(sec / 10 + k / 25) * (victory ? 1.5 : 1));
}

// ---------------------------------------------------------------------------
// Validation / serialization (Req 26.6, 26.7)
// ---------------------------------------------------------------------------
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Unique non-empty strings, or null when the value is not exactly that. */
function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string' || item.length === 0 || out.includes(item)) return null;
    out.push(item);
  }
  return out;
}

/**
 * Returns a defensive copy of `value` when it is a valid MetaState, else null.
 * Strict on purpose: anything unexpected makes the whole blob invalid so the
 * caller falls back to defaults without overwriting storage (Req 26.7).
 */
export function validateMetaState(value: unknown): MetaState | null {
  if (!isRecord(value)) return null;
  if (value.version !== META_VERSION) return null;
  const currency = value.currency;
  if (typeof currency !== 'number' || !Number.isInteger(currency) || currency < 0 || currency > MAX_CURRENCY) {
    return null;
  }
  const unlocks = stringList(value.unlocks);
  if (!unlocks || unlocks.some((id) => !CATALOGUE_BY_ID.has(id))) return null;
  if (!isRecord(value.statBonuses)) return null;
  const statBonuses: Partial<Record<StatKey, number>> = {};
  for (const [k, v] of Object.entries(value.statBonuses)) {
    if (!(STAT_KEYS as readonly string[]).includes(k)) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_STAT_BONUS_LEVEL) return null;
    if (v > 0) statBonuses[k as StatKey] = v;
  }
  const cosmetics = stringList(value.cosmetics);
  if (!cosmetics) return null;
  const equipped = value.equipped;
  if (equipped !== null && (typeof equipped !== 'string' || !cosmetics.includes(equipped))) return null;
  return { version: META_VERSION, currency, unlocks, statBonuses, cosmetics, equipped };
}

export function serializeMetaState(state: MetaState): string {
  return JSON.stringify(state);
}

/** Parses a stored string (or an already-parsed value). Null when invalid. */
export function deserializeMetaState(raw: unknown): MetaState | null {
  if (typeof raw !== 'string') return validateMetaState(raw);
  try {
    return validateMetaState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function cloneState(state: MetaState): MetaState {
  return {
    version: META_VERSION,
    currency: state.currency,
    unlocks: [...state.unlocks],
    statBonuses: { ...state.statBonuses },
    cosmetics: [...state.cosmetics],
    equipped: state.equipped,
  };
}

// ---------------------------------------------------------------------------
// Stateful progression: load, award, buy, queued saves
// ---------------------------------------------------------------------------
export type MetaLoadOutcome = 'not-loaded' | 'loaded' | 'absent' | 'invalid' | 'error';

export type MetaStorage = Pick<PlatformService, 'load' | 'save'>;

export class MetaProgression {
  state: MetaState = defaultMetaState();
  loadOutcome: MetaLoadOutcome = 'not-loaded';
  /** Last save failure (cleared on the next successful save). */
  lastSaveError: unknown = null;

  private dirty = false;
  private blocked = false;
  private saveChain: Promise<boolean> = Promise.resolve(true);

  constructor(private readonly storage: MetaStorage) {}

  /** True while in-memory state has changes not yet persisted. */
  get isDirty(): boolean {
    return this.dirty;
  }

  /** True when stored data was invalid: saves are blocked so it stays untouched (Req 26.7). */
  get saveBlocked(): boolean {
    return this.blocked;
  }

  /**
   * Loads persisted state (Req 26.3). Never rejects.
   * Absent -> defaults ('absent'); valid -> 'loaded'; failing validation or
   * malformed JSON -> defaults + blocked saves ('invalid'); host/transport
   * error -> defaults, saves still allowed ('error', retried at run end).
   */
  async load(): Promise<MetaLoadOutcome> {
    let raw: unknown;
    try {
      raw = await this.storage.load<unknown>(META_STORAGE_KEY);
    } catch (err) {
      this.state = defaultMetaState();
      this.dirty = false;
      this.blocked = err instanceof SyntaxError;
      this.loadOutcome = this.blocked ? 'invalid' : 'error';
      return this.loadOutcome;
    }
    if (raw === null) {
      this.state = defaultMetaState();
      this.dirty = false;
      this.blocked = false;
      this.loadOutcome = 'absent';
      return this.loadOutcome;
    }
    const valid = validateMetaState(raw);
    if (!valid) {
      this.state = defaultMetaState();
      this.dirty = false;
      this.blocked = true;
      this.loadOutcome = 'invalid';
      return this.loadOutcome;
    }
    this.state = valid;
    this.dirty = false;
    this.blocked = false;
    this.loadOutcome = 'loaded';
    return this.loadOutcome;
  }

  /** Adds Bones in memory (capped, sanitized). Returns the amount actually added. */
  grantCurrency(amount: number): number {
    const add = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
    if (add <= 0) return 0;
    const before = this.state.currency;
    this.state.currency = Math.min(MAX_CURRENCY, before + add);
    if (this.state.currency !== before) this.dirty = true;
    return this.state.currency - before;
  }

  /** Awards the run-end Bones reward in memory (Req 26.1). Call flush() to persist. */
  awardRun(survivalSec: number, kills: number, victory: boolean): number {
    return this.grantCurrency(rewardFor(survivalSec, kills, victory));
  }

  /**
   * Buys a catalogue unlock with Bones. Returns false for unknown ids,
   * already-owned/maxed entries, or insufficient currency (state unchanged).
   * Call flush() to persist.
   */
  buyUnlock(id: string): boolean {
    const def = unlockDef(id);
    if (!def) return false;
    const cost = nextCostFor(this.state, def);
    if (cost === null || this.state.currency < cost) return false;
    this.state.currency -= cost;
    if (def.kind === 'startingPart') {
      this.state.unlocks.push(def.id);
    } else {
      this.state.statBonuses[def.stat] = (this.state.statBonuses[def.stat] ?? 0) + 1;
    }
    this.dirty = true;
    return true;
  }

  /** Spends Bones if affordable. Returns false (state unchanged) when not. */
  spendCurrency(amount: number): boolean {
    const cost = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
    if (cost <= 0 || this.state.currency < cost) return false;
    this.state.currency -= cost;
    this.dirty = true;
    return true;
  }

  ownsCosmetic(id: string): boolean {
    return this.state.cosmetics.includes(id);
  }

  /**
   * Grants a cosmetic (shop purchase or Bones unlock). First-ever cosmetic
   * auto-equips. Returns false when already owned. Call flush() to persist.
   */
  grantCosmetic(id: string): boolean {
    if (!id || this.ownsCosmetic(id)) return false;
    this.state.cosmetics.push(id);
    if (this.state.equipped === null) this.state.equipped = id;
    this.dirty = true;
    return true;
  }

  /** Equips an owned cosmetic, or unequips with null. Call flush() to persist. */
  equipCosmetic(id: string | null): boolean {
    if (id !== null && !this.ownsCosmetic(id)) return false;
    if (this.state.equipped !== id) {
      this.state.equipped = id;
      this.dirty = true;
    }
    return true;
  }

  /** Bonuses to hand to Sim for the next run start. */
  runBonuses(): RunBonuses {
    return { startingPartIds: startingPartIdsFor(this.state), statMultipliers: statMultipliersFor(this.state) };
  }

  /**
   * Queued save of the current state (Req 26.2, 26.4). Concurrent flushes
   * serialize on one chain; each attempt snapshots the latest state, so a
   * retry after a failure persists everything earned since. Resolves false
   * (never rejects) when blocked or when the host save fails — state stays
   * dirty in memory for the next run-end retry.
   */
  flush(): Promise<boolean> {
    const attempt = async (): Promise<boolean> => {
      if (this.blocked) return false;
      if (!this.dirty) return true;
      try {
        await this.storage.save(META_STORAGE_KEY, cloneState(this.state));
        this.dirty = false;
        this.lastSaveError = null;
        return true;
      } catch (err) {
        this.lastSaveError = err;
        return false;
      }
    };
    this.saveChain = this.saveChain.then(attempt, attempt);
    return this.saveChain;
  }
}
