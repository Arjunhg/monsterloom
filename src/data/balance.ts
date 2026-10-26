/**
 * Data-driven balance config (design: "Data Models → Config data").
 * All numbers are starting values for tuning; validated by validateConfig().
 */

export interface Balance {
  run: { durationSec: number; minSec: number; maxSec: number; bossLeadSec: number };
  player: { hp: number; speed: number; radius: number; invulnSec: number; pickupRadius: number };
  caps: { damage: number; attackSpeed: number; moveSpeed: number; pickupRadius: number };
  /** T(n) = round(base + lin·n + pow·n^exp) */
  threshold: { base: number; lin: number; pow: number; exp: number };
  /** creditRate(t) = base + lin·t + quad·t² */
  /**
   * Two spawn lanes share this curve. The horde lane (types without `special`) earns creditRate(t);
   * the special lane (bats, slimes, ghosts, witches) earns creditRate(t) × specialRate on top,
   * so v2 monsters add to the horde instead of replacing it.
   */
  credits: { base: number; lin: number; quad: number; maxCarry: number; specialRate: number };
  hpScale: { perMinute: number };
  /**
   * maxActive is the cap on the default 720×1560 view. Larger views earn credits faster
   * (× viewDensityScale, capped at wideBoostMax) and the cap becomes
   * min(maxActiveWide, round(maxActive × scale)) (see src/sim/systems/viewScale.ts).
   */
  spawn: {
    maxActive: number;
    maxActiveWide: number;
    wideBoostMax: number;
    marginMin: number;
    marginMax: number;
    despawnMul: number;
  };
  orbs: { max: number; magnetSpeed: number };
  rarityWeights: { common: number; rare: number; epic: number };
  /** maxTier: 1 in v1, 3 in v2 */
  merge: { maxTier: number; contactSec: number; hpMult: number; maxPerStep: number };
  menu: { rerolls: number; bans: number };
  maxParts: number;
  /** Elite roll per credit-funded spawn (Req 22.7, 22.9): chance ramps from 0 at startSec to maxChance at the end of the run. */
  elite: { startSec: number; maxChance: number; hpMult: number; scale: number };
}

export const BALANCE: Balance = {
  run: { durationSec: 540, minSec: 480, maxSec: 600, bossLeadSec: 90 },
  player: { hp: 100, speed: 220, radius: 18, invulnSec: 0.5, pickupRadius: 90 },
  caps: { damage: 3.0, attackSpeed: 2.0, moveSpeed: 1.5, pickupRadius: 2.5 },
  threshold: { base: 6, lin: 4, pow: 1.2, exp: 1.35 },
  credits: { base: 0.6, lin: 0.004, quad: 0.000012, maxCarry: 6, specialRate: 0.6 },
  hpScale: { perMinute: 0.18 },
  spawn: { maxActive: 400, maxActiveWide: 600, wideBoostMax: 1.5, marginMin: 48, marginMax: 120, despawnMul: 1.6 },
  orbs: { max: 300, magnetSpeed: 420 },
  rarityWeights: { common: 70, rare: 24, epic: 6 },
  merge: { maxTier: 3, contactSec: 1.0, hpMult: 1.1, maxPerStep: 8 },
  menu: { rerolls: 2, bans: 2 },
  maxParts: 6,
  elite: { startSec: 60, maxChance: 0.03, hpMult: 4, scale: 1.3 },
};

/** Chance that a credit-funded spawn at elapsed time t becomes an Elite. Non-decreasing in t. */
export function eliteChance(t: number, cfg: Balance = BALANCE): number {
  const { startSec, maxChance } = cfg.elite;
  const span = Math.max(1, cfg.run.durationSec - startSec);
  const k = Math.min(1, Math.max(0, (t - startSec) / span));
  return maxChance * k;
}

/** Energy required for the next level-up, given Level_Up_Count n ≥ 0 (Req 8.3). */
export function thresholdFor(n: number, cfg: Balance = BALANCE): number {
  const { base, lin, pow, exp } = cfg.threshold;
  const k = Math.max(0, n);
  return Math.round(base + lin * k + pow * Math.pow(k, exp));
}

/** Threat credits gained per second at elapsed time t (Req 5.3, 12.2). */
export function creditRate(t: number, cfg: Balance = BALANCE): number {
  const { base, lin, quad } = cfg.credits;
  const s = Math.max(0, t);
  return base + lin * s + quad * s * s;
}

/** Enemy HP multiplier at elapsed time t in seconds (Req 12.2). */
export function hpScaleAt(t: number, cfg: Balance = BALANCE): number {
  return 1 + cfg.hpScale.perMinute * (Math.max(0, t) / 60);
}

/** Reference view area (default portrait 720×1560 canvas) for viewDensityScale. */
export const BASE_VIEW_AREA = 720 * 1560;

/**
 * Spawn density multiplier for a view size (world px):
 * clamp(sqrt(width × height / (720 × 1560)), 1, spawn.wideBoostMax). Exactly 1 on the
 * default portrait view and on anything smaller.
 */
export function viewDensityScale(view: { width: number; height: number }, cfg: Balance = BALANCE): number {
  // Portrait screens (phones, including tall ones) keep the tuned v1 density exactly.
  if (!(view.width > view.height)) return 1;
  const area = view.width * view.height;
  const raw = area > 0 ? Math.sqrt(area / BASE_VIEW_AREA) : 1;
  const max = Math.max(1, cfg.spawn.wideBoostMax);
  if (!(raw > 1)) return 1;
  return raw < max ? raw : max;
}
