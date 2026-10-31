import { describe, expect, it } from 'vitest';
import { META_STORAGE_KEY, MetaProgression, serializeMetaState } from '../../src/meta/MetaProgression';
import { ACHIEVEMENTS, evaluateAchievements, type AchievementContext } from '../../src/meta/Achievements';
import { FakePlatform } from '../../src/platform/FakePlatform';

/** Task 29.2: achievements (Req 32). */
function setup() {
  const platform = new FakePlatform();
  const meta = new MetaProgression(platform);
  return { platform, meta };
}

const CASES: Array<[string, AchievementContext]> = [
  ['first_dawn', { victory: true }],
  ['massacre', { kills: 500 }],
  ['untouchable', { bestNoDamageSec: 60 }],
  ['full_monster', { mutationsOwned: 3 }],
  ['challenger', { challengeBeaten: true }],
  ['daily_devotee', { dailyFinishes: 5 }],
  ['shopaholic', { cosmeticsOwned: 4 }],
];

describe('achievement catalogue', () => {
  it('contains exactly the 7 starter achievements', () => {
    expect(ACHIEVEMENTS.map((a) => a.id)).toEqual(CASES.map(([id]) => id));
  });

  it('an empty context unlocks nothing', async () => {
    const { meta } = setup();
    await meta.load();
    expect(evaluateAchievements(meta, {})).toEqual([]);
    expect(evaluateAchievements(meta, { victory: false, kills: 499, bestNoDamageSec: 59 })).toEqual([]);
  });
});

describe('achievement unlocking', () => {
  for (const [id, ctx] of CASES) {
    it(`${id} grants exactly once when its condition is met`, async () => {
      const { meta } = setup();
      await meta.load();
      const first = evaluateAchievements(meta, ctx);
      expect(first.map((a) => a.id)).toContain(id);
      expect(meta.hasAchievement(id)).toBe(true);
      const again = evaluateAchievements(meta, ctx);
      expect(again.map((a) => a.id)).not.toContain(id);
      expect(meta.state.achievements.filter((x) => x === id)).toHaveLength(1);
    });
  }

  it('persists across load', async () => {
    const { platform, meta } = setup();
    await meta.load();
    evaluateAchievements(meta, { victory: true, kills: 600 });
    await meta.flush();
    const reloaded = new MetaProgression(platform);
    await reloaded.load();
    expect(reloaded.hasAchievement('first_dawn')).toBe(true);
    expect(reloaded.hasAchievement('massacre')).toBe(true);
    expect(reloaded.state.achievements).toHaveLength(2);
  });

  it('missing or corrupt stored achievements fall back to none, keeping other fields', async () => {
    const { platform, meta } = setup();
    await meta.load();
    meta.grantCurrency(123);
    const good = JSON.parse(serializeMetaState(meta.state)) as Record<string, unknown>;

    const missing = { ...good };
    delete missing.achievements;
    await platform.save(META_STORAGE_KEY, missing);
    const m2 = new MetaProgression(platform);
    await m2.load();
    expect(m2.state.currency).toBe(123);
    expect(m2.state.achievements).toEqual([]);

    await platform.save(META_STORAGE_KEY, { ...good, achievements: 42 });
    const m3 = new MetaProgression(platform);
    await m3.load();
    expect(m3.state.currency).toBe(123);
    expect(m3.state.achievements).toEqual([]);
  });
});
