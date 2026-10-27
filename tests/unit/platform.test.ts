import { describe, expect, it } from 'vitest';
import { FakePlatform } from '../../src/platform/FakePlatform';

/**
 * Task 19.2: FakePlatform contract for the v3 PlatformService methods.
 * The fake mirrors RundotPlatform's SDK mapping semantics so meta /
 * daily / share / shop features can be tested without the RUN host.
 */
describe('FakePlatform v3 contract', () => {
  it('save/load round-trips JSON values and missing keys load as null', async () => {
    const p = new FakePlatform();
    await expect(p.load('missing')).resolves.toBeNull();

    const value = { version: 1, currency: 42, unlocks: ['fangs'] };
    await p.save('meta', value);
    await expect(p.load('meta')).resolves.toEqual(value);

    // Stored state is serialized: mutating the caller's object must not leak in.
    value.currency = 999;
    await expect(p.load('meta')).resolves.toEqual({ version: 1, currency: 42, unlocks: ['fangs'] });
  });

  it('injected storage failures reject once, then the next call succeeds', async () => {
    const p = new FakePlatform();
    p.failNext('save');
    await expect(p.save('meta', { version: 1 })).rejects.toThrow(/injected save failure/);
    await p.save('meta', { version: 1 });

    p.failNext('load');
    await expect(p.load('meta')).rejects.toThrow(/injected load failure/);
    await expect(p.load('meta')).resolves.toEqual({ version: 1 });
  });

  it('submitScore returns an accepted outcome and getLeaderboard ranks the player', async () => {
    const p = new FakePlatform();
    await expect(
      p.submitScore('daily', 1200, { durationSec: 300, period: 'daily', meta: { kills: 40 } }),
    ).resolves.toEqual({ accepted: true, rank: 1 });
    await expect(p.submitScore('daily', 900, { durationSec: 200, period: 'daily' })).resolves.toEqual({
      accepted: true,
      rank: 2,
    });

    const board = await p.getLeaderboard('daily', { period: 'daily', limit: 10 });
    expect(board.top.map((r) => [r.rank, r.score])).toEqual([
      [1, 1200],
      [2, 900],
    ]);
    expect(board.me).toMatchObject({ rank: 1, score: 1200, meta: { kills: 40 } });
  });

  it('injected leaderboard failures reject', async () => {
    const p = new FakePlatform();
    p.failNext('submitScore');
    await expect(p.submitScore('daily', 10, { durationSec: 10 })).rejects.toThrow(/injected submitScore failure/);
    p.failNext('getLeaderboard');
    await expect(p.getLeaderboard('daily')).rejects.toThrow(/injected getLeaderboard failure/);
  });

  it('share records the payload and resolves a completed result', async () => {
    const p = new FakePlatform();
    const payload = {
      image: new Blob(['png'], { type: 'image/png' }),
      text: 'Beat my monster!',
      shareParams: { challenge: 'abc' },
    };
    await expect(p.share(payload)).resolves.toMatchObject({ completed: true });
    expect(p.shares).toEqual([payload]);

    p.failNext('share');
    await expect(p.share(payload)).rejects.toThrow(/injected share failure/);
    expect(p.shares).toHaveLength(1);
  });

  it('getLaunchParams is async and returns a copy of the launch params', async () => {
    const p = new FakePlatform({ launchParams: { challenge: 'xyz' } });
    const pending = p.getLaunchParams();
    expect(pending).toBeInstanceOf(Promise);
    const params = await pending;
    expect(params).toEqual({ challenge: 'xyz' });
    params.challenge = 'mutated';
    await expect(p.getLaunchParams()).resolves.toEqual({ challenge: 'xyz' });
  });

  it('paymentsSupported toggles and gates purchase outcomes', async () => {
    const p = new FakePlatform();
    expect(p.paymentsSupported()).toBe(false);
    await expect(p.purchase('cosmetic_bat_ears')).resolves.toBe('failed');

    p.paymentsEnabled = true;
    expect(p.paymentsSupported()).toBe(true);
    await expect(p.purchase('cosmetic_bat_ears')).resolves.toBe('ok');

    p.purchaseResult = 'cancelled';
    await expect(p.purchase('cosmetic_bat_ears')).resolves.toBe('cancelled');

    expect(p.purchases.map((r) => r.sku)).toEqual([
      'cosmetic_bat_ears',
      'cosmetic_bat_ears',
      'cosmetic_bat_ears',
    ]);
  });

  it('constructor option enables payments up front', async () => {
    const p = new FakePlatform({ paymentsSupported: true });
    expect(p.paymentsSupported()).toBe(true);
    await expect(p.purchase('cosmetic_bat_ears', 'idem-1')).resolves.toBe('ok');
    expect(p.purchases).toEqual([{ sku: 'cosmetic_bat_ears', idempotencyKey: 'idem-1' }]);
  });
});
