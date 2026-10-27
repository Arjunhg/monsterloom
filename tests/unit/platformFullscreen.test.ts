import { describe, expect, it } from 'vitest';
import { FakePlatform } from '../../src/platform/FakePlatform';

/**
 * PlatformService fullscreen contract (RUN host keeps some players in a
 * constrained stage; the game asks for fullscreen on Start when the surface
 * allows toggling it). FakePlatform mirrors RundotPlatform's semantics:
 * a "host call" only happens when the capability is 'toggleable'.
 */
describe('platform fullscreen contract', () => {
  it('unavailable: resolves false and never calls the host', async () => {
    const p = new FakePlatform();
    expect(p.fullscreenCapability()).toBe('unavailable');
    await expect(p.requestFullscreen()).resolves.toBe(false);
    expect(p.fullscreenRequests).toBe(0);
  });

  it('toggleable: records the host call and resolves true', async () => {
    const p = new FakePlatform();
    p.fullscreenCap = 'toggleable';
    expect(p.fullscreenCapability()).toBe('toggleable');
    await expect(p.requestFullscreen()).resolves.toBe(true);
    expect(p.fullscreenRequests).toBe(1);
    await expect(p.requestFullscreen()).resolves.toBe(true);
    expect(p.fullscreenRequests).toBe(2);
  });

  it('always-on: already fullscreen, resolves true with no host call', async () => {
    const p = new FakePlatform();
    p.fullscreenCap = 'always-on';
    expect(p.fullscreenCapability()).toBe('always-on');
    await expect(p.requestFullscreen()).resolves.toBe(true);
    expect(p.fullscreenRequests).toBe(0);
  });
});
