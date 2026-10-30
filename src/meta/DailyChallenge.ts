/**
 * DailyChallenge (task 21.1, Req 27): one seeded run per UTC date, shared by
 * every player, with a single ranked attempt per date and later attempts as
 * unranked practice.
 *
 * Seed: fnv1a32("mms-daily-" + UTC YYYY-MM-DD) (27.1).
 * Score: floor(survivalSec)·10 + kills + (victory ? 5000 : 0) (27.4).
 * The ranked-date flag and any unsubmitted ranked score persist through
 * PlatformService storage under DAILY_STORAGE_KEY, with the same failure
 * semantics as MetaProgression: invalid stored data falls back to defaults
 * and blocks saves (stored blob untouched); transport errors keep state in
 * memory and retry on the next flush.
 *
 * Leaderboard routing: the SDK default simple mode (see
 * rundot/leaderboard.config.json) — mode "default", period "daily".
 */
import type { PlatformService, SubmitScoreOutcome } from '../platform/PlatformService';

export const DAILY_STORAGE_KEY = 'mms_daily_v1';
export const DAILY_LEADERBOARD_MODE = 'default';
export const DAILY_LEADERBOARD_PERIOD = 'daily';

/** 32-bit FNV-1a hash (offset basis 0x811c9dc5, prime 0x01000193). */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** UTC calendar date as YYYY-MM-DD (toISOString is always UTC). */
export function utcDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Deterministic daily seed for a Date or a YYYY-MM-DD date key (Req 27.1). */
export function dailySeed(date: Date | string = new Date()): number {
  const key = typeof date === 'string' ? date : utcDateKey(date);
  return fnv1a32(`mms-daily-${key}`);
}

/** Published daily score formula (Req 27.4). Inputs are sanitized to >= 0. */
export function dailyScore(survivalSec: number, kills: number, victory: boolean): number {
  const sec = Number.isFinite(survivalSec) ? Math.max(0, Math.floor(survivalSec)) : 0;
  const k = Number.isFinite(kills) ? Math.max(0, Math.floor(kills)) : 0;
  return sec * 10 + k + (victory ? 5000 : 0);
}

export interface PendingDailyScore {
  date: string;
  score: number;
  survivalSec: number;
  kills: number;
  victory: boolean;
}

export interface DailyState {
  /** UTC date whose ranked attempt has been claimed, or null. */
  rankedDate: string | null;
  /** Ranked score recorded at run end but not yet accepted by the leaderboard. */
  pending: PendingDailyScore | null;
}

export function defaultDailyState(): DailyState {
  return { rankedDate: null, pending: null };
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonNegativeFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** Defensive copy when valid, else null (strict, like validateMetaState). */
export function validateDailyState(value: unknown): DailyState | null {
  if (!isRecord(value)) return null;
  const rankedDate = value.rankedDate;
  if (rankedDate !== null && (typeof rankedDate !== 'string' || !DATE_KEY_RE.test(rankedDate))) return null;
  const pending = value.pending;
  if (pending === null) return { rankedDate, pending: null };
  if (!isRecord(pending)) return null;
  if (typeof pending.date !== 'string' || !DATE_KEY_RE.test(pending.date)) return null;
  if (!isNonNegativeFinite(pending.score)) return null;
  if (!isNonNegativeFinite(pending.survivalSec)) return null;
  if (!isNonNegativeFinite(pending.kills)) return null;
  if (typeof pending.victory !== 'boolean') return null;
  return {
    rankedDate,
    pending: {
      date: pending.date,
      score: pending.score,
      survivalSec: pending.survivalSec,
      kills: pending.kills,
      victory: pending.victory,
    },
  };
}

export type DailyLoadOutcome = 'not-loaded' | 'loaded' | 'absent' | 'invalid' | 'error';

export type DailyStorage = Pick<PlatformService, 'load' | 'save'>;

export class DailyChallenge {
  state: DailyState = defaultDailyState();
  loadOutcome: DailyLoadOutcome = 'not-loaded';
  lastSaveError: unknown = null;

  private dirty = false;
  private blocked = false;
  private saveChain: Promise<boolean> = Promise.resolve(true);

  constructor(private readonly storage: DailyStorage) {}

  get isDirty(): boolean {
    return this.dirty;
  }

  get saveBlocked(): boolean {
    return this.blocked;
  }

  /** Loads persisted ranked/pending state. Never rejects. */
  async load(): Promise<DailyLoadOutcome> {
    let raw: unknown;
    try {
      raw = await this.storage.load<unknown>(DAILY_STORAGE_KEY);
    } catch (err) {
      this.state = defaultDailyState();
      this.dirty = false;
      this.blocked = err instanceof SyntaxError;
      this.loadOutcome = this.blocked ? 'invalid' : 'error';
      return this.loadOutcome;
    }
    if (raw === null) {
      this.state = defaultDailyState();
      this.dirty = false;
      this.blocked = false;
      this.loadOutcome = 'absent';
      return this.loadOutcome;
    }
    const valid = validateDailyState(raw);
    if (!valid) {
      this.state = defaultDailyState();
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

  /** True while the ranked attempt for `dateKey` has not been claimed (Req 27.7). */
  rankedAvailable(dateKey: string): boolean {
    return this.state.rankedDate !== dateKey;
  }

  /**
   * Claims the ranked attempt for `dateKey`. Returns false when it was
   * already claimed (the caller then starts an unranked practice run).
   * Claiming at run start prevents restart-scumming the ranked attempt.
   * Call flush() to persist.
   */
  claimRanked(dateKey: string): boolean {
    if (!this.rankedAvailable(dateKey)) return false;
    this.state.rankedDate = dateKey;
    this.dirty = true;
    return true;
  }

  /** Records a finished ranked run's score until the leaderboard accepts it. */
  recordPending(pending: PendingDailyScore): void {
    this.state.pending = { ...pending };
    this.dirty = true;
  }

  clearPending(): void {
    if (this.state.pending === null) return;
    this.state.pending = null;
    this.dirty = true;
  }

  /** Queued save; resolves false (never rejects) when blocked or on host failure. */
  flush(): Promise<boolean> {
    const attempt = async (): Promise<boolean> => {
      if (this.blocked) return false;
      if (!this.dirty) return true;
      try {
        await this.storage.save(DAILY_STORAGE_KEY, {
          rankedDate: this.state.rankedDate,
          pending: this.state.pending ? { ...this.state.pending } : null,
        });
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

/**
 * Submits the recorded pending ranked score (Req 27.3, 27.6). On acceptance
 * the pending score is cleared and persisted. A host rejection resolves with
 * `accepted: false` and keeps the pending score; transport errors reject and
 * also keep it, so callers can offer a retry. Resolves null when there is no
 * pending score.
 */
export async function submitPendingDailyScore(
  platform: Pick<PlatformService, 'submitScore'>,
  daily: DailyChallenge,
): Promise<SubmitScoreOutcome | null> {
  const pending = daily.state.pending;
  if (!pending) return null;
  const outcome = await platform.submitScore(DAILY_LEADERBOARD_MODE, pending.score, {
    durationSec: Math.floor(pending.survivalSec),
    period: DAILY_LEADERBOARD_PERIOD,
    meta: { kills: pending.kills, victory: pending.victory, date: pending.date },
  });
  if (outcome.accepted) {
    daily.clearPending();
    void daily.flush();
  }
  return outcome;
}
