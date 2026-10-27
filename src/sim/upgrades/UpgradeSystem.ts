/**
 * UpgradeSystem (design "UpgradeSystem", Req 9, 10, 11, 12.1).
 *
 * Builds the eligible offer pool, draws distinct Upgrade_Offers with weighted
 * rarity, and applies the chosen offer to the RunState. Reroll/ban (Req 25,
 * task 16.1) redraw offers and spend run counters. Mutation candidates and application are supplied by hooks
 * (task 7.6) so this module has no dependency on the mutation system.
 *
 * Decisions:
 * - `maxParts` counts EVERY owned Body_Part, including the starter and parts
 *   merged into a mutation (Req 11.5 caps "distinct Body_Parts the Player can
 *   own"). With the v1 config (1 starter + 6 offerable parts, maxParts 6) the
 *   player can own the starter plus 5 more.
 * - Rare newPart: level 1 plus one Rare bonus. Rare levelUp: +1 level plus one
 *   Rare bonus. Epic newPart: level 2 (capped). Epic levelUp: +1 level plus one
 *   Rare bonus (Epic is never weaker than Rare).
 * - A slot that ends up with no rarity-matching candidate (after epic→rare→common
 *   downgrade) takes any remaining candidate at that candidate's first supported rarity.
 */
import type { BodyPartDef, Rarity } from '../../data/bodyParts';
import { EventType } from '../EventBus';
import type { RunState } from '../RunState';
import type { SeededRNG } from '../rng/SeededRNG';
import { clampStats } from '../StatCaps';
import { healPlayer, partIndex } from '../entities';

export type { Rarity };

export type UpgradeKind = 'newPart' | 'levelUp' | 'mutation' | 'fallbackHeal';

export interface UpgradeOffer {
  kind: UpgradeKind;
  partId?: string;
  mutationId?: string;
  rarity: Rarity;
  /** Current Part_Level (0 for a new part). Undefined for mutation / fallback. */
  fromLevel?: number;
  /** Part_Level after applying this offer. */
  toLevel?: number;
  name: string;
  icon: string;
  /** Localisation/description key for the one-line effect text (Req 9.5). */
  descriptionKey: string;
}

/** An eligible pool entry. Offers are created from candidates at draw time. */
export interface Candidate {
  kind: Exclude<UpgradeKind, 'fallbackHeal'>;
  partId?: string;
  mutationId?: string;
  /** Rarities this candidate may be offered at. Mutations use ['epic']. */
  rarities: readonly Rarity[];
  /** Relative draw weight (default 1). */
  weight?: number;
  /** Current level (0 for newPart). */
  fromLevel?: number;
  name: string;
  icon: string;
  descriptionKey: string;
}

/** Fraction of maxHp restored by a fallbackHeal offer (Req 9.2). */
export const FALLBACK_HEAL_FRACTION = 0.3;

export const FALLBACK_HEAL_OFFER: Readonly<UpgradeOffer> = Object.freeze({
  kind: 'fallbackHeal',
  rarity: 'common',
  name: 'Monster Snack',
  icon: 'icon_fallback_heal',
  descriptionKey: 'upgrade.fallbackHeal',
});

const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic'];
/** Downgrade chains per drawn rarity. */
const DOWNGRADE: Record<Rarity, readonly Rarity[]> = {
  epic: ['epic', 'rare', 'common'],
  rare: ['rare', 'common'],
  common: ['common'],
};

// ---------------------------------------------------------------------------
// Mutation hooks (filled by task 7.6)
// ---------------------------------------------------------------------------
export type MutationCandidateProvider = (state: RunState) => Candidate[];
export type MutationApplier = (state: RunState, offer: UpgradeOffer) => void;

const mutationProviders: MutationCandidateProvider[] = [];
let mutationApplier: MutationApplier | null = null;

/** Registers a provider of mutation candidates. Returns an unregister function. */
export function registerMutationCandidates(fn: MutationCandidateProvider): () => void {
  mutationProviders.push(fn);
  return () => {
    const i = mutationProviders.indexOf(fn);
    if (i >= 0) mutationProviders.splice(i, 1);
  };
}

/** Sets the function that applies mutation offers (replaces any previous). Returns an unregister function. */
export function registerMutationApplier(fn: MutationApplier): () => void {
  mutationApplier = fn;
  return () => {
    if (mutationApplier === fn) mutationApplier = null;
  };
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------
function candidateKey(c: { kind: string; partId?: string; mutationId?: string }): string {
  return `${c.kind}:${c.partId ?? ''}:${c.mutationId ?? ''}`;
}

function mutationCandidates(state: RunState): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const provider of mutationProviders) {
    for (const c of provider(state)) {
      if (c.kind !== 'mutation' || !c.mutationId || state.build.mutations.has(c.mutationId)) continue;
      const key = candidateKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...c, rarities: ['epic'] });
    }
  }
  return out;
}

/** Eligible pool: new parts (below maxParts), level-ups (below maxLevel), then mutations. */
export function eligiblePool(state: RunState): Candidate[] {
  const { parts, banned } = state.build;
  const canAddPart = parts.size < state.config.balance.maxParts;
  const out: Candidate[] = [];
  for (const def of state.config.bodyParts) {
    const owned = parts.get(def.id);
    if (owned) {
      if (owned.level < def.maxLevel) {
        out.push({
          kind: 'levelUp',
          partId: def.id,
          rarities: def.rarities,
          fromLevel: owned.level,
          name: def.name,
          icon: def.icon,
          descriptionKey: `part.${def.id}.levelUp`,
        });
      }
    } else if (canAddPart && !def.starter && !banned.has(def.id)) {
      out.push({
        kind: 'newPart',
        partId: def.id,
        rarities: def.rarities,
        fromLevel: 0,
        name: def.name,
        icon: def.icon,
        descriptionKey: `part.${def.id}.new`,
      });
    }
  }
  for (const c of mutationCandidates(state)) out.push(c);
  return out;
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------
function findPart(state: RunState, partId: string | undefined): BodyPartDef | undefined {
  return partId === undefined ? undefined : state.config.bodyParts.find((p) => p.id === partId);
}

function toLevelFor(state: RunState, c: Candidate, rarity: Rarity): number | undefined {
  if (c.kind === 'mutation') return undefined;
  const def = findPart(state, c.partId);
  const max = def ? def.maxLevel : Number.POSITIVE_INFINITY;
  const from = c.fromLevel ?? 0;
  const step = c.kind === 'newPart' && rarity === 'epic' ? 2 : 1;
  return Math.min(max, from + step);
}

function toOffer(state: RunState, c: Candidate, rarity: Rarity): UpgradeOffer {
  const offer: UpgradeOffer = {
    kind: c.kind,
    rarity,
    name: c.name,
    icon: c.icon,
    descriptionKey: c.descriptionKey,
  };
  if (c.partId !== undefined) offer.partId = c.partId;
  if (c.mutationId !== undefined) offer.mutationId = c.mutationId;
  if (c.kind !== 'mutation') {
    offer.fromLevel = c.fromLevel ?? 0;
    offer.toLevel = toLevelFor(state, c, rarity);
  }
  return offer;
}

function weightOf(c: Candidate): number {
  return c.weight ?? 1;
}

/** Weighted pick that falls back to the first item when no weight is positive. */
function pickWeighted(rng: SeededRNG, items: Candidate[]): Candidate {
  return rng.weighted(items, weightOf) ?? items[0];
}

/**
 * Draws `count` offers: forced mutation candidates (Epic) first, then weighted
 * rarity + weighted candidate sampling without replacement, then fallbackHeal fill.
 * Non-fallback offers are pairwise distinct.
 */
export function drawOffers(state: RunState, rng: SeededRNG, count = 3): UpgradeOffer[] {
  return drawFromPool(state, rng, count, eligiblePool(state));
}

function drawFromPool(state: RunState, rng: SeededRNG, count: number, pool: Candidate[]): UpgradeOffer[] {
  const offers: UpgradeOffer[] = [];
  const remaining: Candidate[] = [];
  for (const c of pool) {
    if (c.kind === 'mutation') {
      if (offers.length < count) offers.push(toOffer(state, c, 'epic'));
    } else {
      remaining.push(c);
    }
  }

  const w = state.config.balance.rarityWeights;
  while (offers.length < count && remaining.length > 0) {
    const drawn = rng.weighted(RARITY_ORDER, (r) => w[r]) ?? 'common';
    let chosen: Candidate | undefined;
    let rarity: Rarity = drawn;
    for (const r of DOWNGRADE[drawn]) {
      const matching = remaining.filter((c) => c.rarities.includes(r));
      if (matching.length > 0) {
        chosen = pickWeighted(rng, matching);
        rarity = r;
        break;
      }
    }
    if (!chosen) {
      chosen = pickWeighted(rng, remaining);
      rarity = chosen.rarities[0] ?? 'common';
    }
    remaining.splice(remaining.indexOf(chosen), 1);
    offers.push(toOffer(state, chosen, rarity));
  }

  while (offers.length < count) offers.push({ ...FALLBACK_HEAL_OFFER });
  return offers;
}

// ---------------------------------------------------------------------------
// Reroll / ban (Req 25)
// ---------------------------------------------------------------------------
/** True if `offer` may be banned right now: a Ban is left and it's a new (unowned, unbanned) part (Req 25.5, 25.6). */
export function canBan(state: RunState, offer: UpgradeOffer | undefined): boolean {
  if (!offer || state.build.bans <= 0 || offer.kind !== 'newPart' || offer.partId === undefined) return false;
  return !state.build.parts.has(offer.partId) && !state.build.banned.has(offer.partId);
}

/**
 * Replaces all offers (Req 25.2). Returns null and changes nothing when no Reroll
 * is left (25.4). Prefers candidates not currently shown; falls back to the full
 * pool when that would leave fewer than `current.length` candidates. Forced
 * mutation offers are never excluded, so a mutation stays offered.
 */
export function rerollOffers(state: RunState, rng: SeededRNG, current: readonly UpgradeOffer[]): UpgradeOffer[] | null {
  if (state.build.rerolls <= 0) return null;
  state.build.rerolls--;
  const count = current.length;
  const shown = new Set(current.filter((o) => o.kind !== 'fallbackHeal' && o.kind !== 'mutation').map(candidateKey));
  const pool = eligiblePool(state);
  const fresh = pool.filter((c) => c.kind === 'mutation' || !shown.has(candidateKey(c)));
  return drawFromPool(state, rng, count, fresh.length >= count ? fresh : pool);
}

/**
 * Bans the new part offered in `slot` (Req 25.3): adds it to `banned`, decrements
 * Bans and redraws only that slot with a candidate not already shown (fallbackHeal
 * if none). Returns null and changes nothing when the offer can't be banned.
 */
export function banOffer(
  state: RunState,
  rng: SeededRNG,
  current: readonly UpgradeOffer[],
  slot: number,
): UpgradeOffer[] | null {
  const offer = current[slot];
  if (!canBan(state, offer) || offer.partId === undefined) return null;
  state.build.banned.add(offer.partId);
  state.build.bans--;
  const shown = new Set(current.filter((o) => o.kind !== 'fallbackHeal').map(candidateKey));
  const pool = eligiblePool(state).filter((c) => !shown.has(candidateKey(c)));
  const next = current.slice();
  next[slot] = drawFromPool(state, rng, 1, pool)[0];
  return next;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------
/** Applies an offer to the run (Req 9.4). Invalid offers (unknown/ineligible part) are ignored. */
export function applyOffer(state: RunState, offer: UpgradeOffer): void {
  const { parts } = state.build;
  switch (offer.kind) {
    case 'newPart': {
      const def = findPart(state, offer.partId);
      if (!def || parts.has(def.id) || parts.size >= state.config.balance.maxParts) break;
      const level = Math.min(def.maxLevel, offer.rarity === 'epic' ? 2 : 1);
      const rareBonuses = offer.rarity === 'rare' ? 1 : 0;
      parts.set(def.id, { level, merged: false, rareBonuses });
      state.events.push(EventType.partGained, partIndex(state, def.id), level);
      break;
    }
    case 'levelUp': {
      const def = findPart(state, offer.partId);
      const owned = def ? parts.get(def.id) : undefined;
      if (!def || !owned || owned.level >= def.maxLevel) break;
      owned.level = Math.min(def.maxLevel, owned.level + 1);
      if (offer.rarity !== 'common') owned.rareBonuses++;
      state.events.push(EventType.partLevelled, partIndex(state, def.id), owned.level);
      break;
    }
    case 'fallbackHeal':
      healPlayer(state, state.player.maxHp * FALLBACK_HEAL_FRACTION);
      break;
    case 'mutation':
      if (mutationApplier) mutationApplier(state, offer);
      break;
  }
  clampStats(state.player.stats, state.config.balance.caps);
}

export const UpgradeSystem = {
  eligiblePool,
  drawOffers,
  apply: applyOffer,
  reroll: rerollOffers,
  ban: banOffer,
  canBan,
};
