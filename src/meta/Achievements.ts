/**
 * Achievements (task 29.1, Req 32): recognition-only long-term goals.
 *
 * The catalogue is data + pure predicates over an evaluation context built
 * by the caller (run-end stats, meta state). Unlocking grants nothing
 * gameplay-affecting — ids are stored in MetaProgression and shown as
 * badges. Evaluation is idempotent: already-owned ids never re-report.
 */
import type { MetaProgression } from './MetaProgression';

export interface AchievementContext {
  victory?: boolean;
  kills?: number;
  /** Longest stretch without taking damage this run, seconds. */
  bestNoDamageSec?: number;
  mutationsOwned?: number;
  challengeBeaten?: boolean;
  /** Daily-mode runs finished, lifetime (including this one when daily). */
  dailyFinishes?: number;
  cosmeticsOwned?: number;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  test: (ctx: AchievementContext) => boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first_dawn', name: 'First Dawn', description: 'Survive a full night', test: (c) => c.victory === true },
  { id: 'massacre', name: 'Massacre', description: '500 kills in one run', test: (c) => (c.kills ?? 0) >= 500 },
  { id: 'untouchable', name: 'Untouchable', description: '60s without taking damage', test: (c) => (c.bestNoDamageSec ?? 0) >= 60 },
  { id: 'full_monster', name: 'Full Monster', description: 'Own 3 mutations at once', test: (c) => (c.mutationsOwned ?? 0) >= 3 },
  { id: 'challenger', name: 'Challenger', description: "Beat a friend's challenge target", test: (c) => c.challengeBeaten === true },
  { id: 'daily_devotee', name: 'Daily Devotee', description: 'Finish 5 daily runs', test: (c) => (c.dailyFinishes ?? 0) >= 5 },
  { id: 'shopaholic', name: 'Shopaholic', description: 'Own 4 cosmetic looks', test: (c) => (c.cosmeticsOwned ?? 0) >= 4 },
];

const BY_ID = new Map<string, AchievementDef>(ACHIEVEMENTS.map((a) => [a.id, a]));

export function achievementDef(id: string): AchievementDef | undefined {
  return BY_ID.get(id);
}

/**
 * Evaluates the catalogue against `ctx`, grants newly-earned achievements
 * on `meta`, and returns their defs (empty when nothing new). The caller
 * flushes meta to persist.
 */
export function evaluateAchievements(meta: MetaProgression, ctx: AchievementContext): AchievementDef[] {
  const earned = ACHIEVEMENTS.filter((a) => !meta.hasAchievement(a.id) && a.test(ctx));
  if (earned.length === 0) return [];
  const added = new Set(meta.unlockAchievements(earned.map((a) => a.id)));
  return earned.filter((a) => added.has(a.id));
}
