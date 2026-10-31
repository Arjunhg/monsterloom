import { describe, expect, it } from 'vitest';
import {
  DAILY_STORAGE_KEY,
  DailyChallenge,
  dailyScore,
  dailySeed,
  fnv1a32,
  utcDateKey,
  validateDailyState,
} from '../../src/meta/DailyChallenge';
import { FakePlatform } from '../../src/platform/FakePlatform';

/** Task 21: daily challenge unit tests (Req 27.1, 27.4, 27.7). */
describe('fnv1a32 and dailySeed', () => {
  it('fnv1a32 matches the standard 32-bit FNV-1a test vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('seed depends only on the UTC date', () => {
    const morning = new Date('2026-10-26T00:00:01Z');
    const night = new Date('2026-10-26T23:59:59Z');
    const nextDay = new Date('2026-10-27T00:00:00Z');
    expect(utcDateKey(morning)).toBe('2026-10-26');
    expect(dailySeed(morning)).toBe(dailySeed(night));
    expect(dailySeed(morning)).toBe(dailySeed('2026-10-26'));
    expect(dailySeed(morning)).toBe(fnv1a32('mms-daily-2026-10-26'));
    expect(dailySeed(nextDay)).not.toBe(dailySeed(morning));
  });
});

describe('dailyScore', () => {
  it('is floor(survivalSec)*10 + kills + 5000 on victory', () => {
    expect(dailyScore(0, 0, false)).toBe(0);
    expect(dailyScore(120.9, 100, false)).toBe(1300);
    expect(dailyScore(540, 800, true)).toBe(5400 + 800 + 5000);
    expect(dailyScore(-5, NaN, false)).toBe(0);
  });
});

describe('DailyChallenge ranked flag and pending score', () => {
  it('allows one ranked attempt per UTC date, persisted across reloads', async () => {
    const platform = new FakePlatform();
    const daily = new DailyChallenge(platform);
    await expect(daily.load()).resolves.toBe('absent');
    expect(daily.rankedAvailable('2026-10-26')).toBe(true);
    expect(daily.claimRanked('2026-10-26')).toBe(true);
    expect(daily.claimRanked('2026-10-26')).toBe(false);
    await expect(daily.flush()).resolves.toBe(true);

    const reloaded = new DailyChallenge(platform);
    await expect(reloaded.load()).resolves.toBe('loaded');
    expect(reloaded.rankedAvailable('2026-10-26')).toBe(false);
    expect(reloaded.rankedAvailable('2026-10-27')).toBe(true);
  });

  it('keeps a pending score until cleared, across reloads', async () => {
    const platform = new FakePlatform();
    const daily = new DailyChallenge(platform);
    await daily.load();
    daily.recordPending({ date: '2026-10-26', score: 4200, survivalSec: 300, kills: 1200 - 800, victory: false });
    await expect(daily.flush()).resolves.toBe(true);

    const reloaded = new DailyChallenge(platform);
    await reloaded.load();
    expect(reloaded.state.pending?.score).toBe(4200);
    reloaded.clearPending();
    await expect(reloaded.flush()).resolves.toBe(true);
    await expect(platform.load(DAILY_STORAGE_KEY)).resolves.toMatchObject({ pending: null });
  });

  it('invalid stored data falls back to defaults and stays untouched', async () => {
    const platform = new FakePlatform();
    await platform.save(DAILY_STORAGE_KEY, { rankedDate: 12345 });
    const daily = new DailyChallenge(platform);
    await expect(daily.load()).resolves.toBe('invalid');
    expect(daily.rankedAvailable('2026-10-26')).toBe(true);
    daily.claimRanked('2026-10-26');
    await expect(daily.flush()).resolves.toBe(false);
    await expect(platform.load(DAILY_STORAGE_KEY)).resolves.toEqual({ rankedDate: 12345 });
  });

  it('validateDailyState rejects malformed shapes', () => {
    expect(validateDailyState(null)).toBeNull();
    expect(validateDailyState({ rankedDate: '26-10-2026', pending: null })).toBeNull();
    expect(validateDailyState({ rankedDate: null, pending: { date: '2026-10-26', score: -1 } })).toBeNull();
    expect(validateDailyState({ rankedDate: '2026-10-26', pending: null })).toEqual({
      rankedDate: '2026-10-26',
      pending: null,
      finishedCount: 0,
    });
  });
});
