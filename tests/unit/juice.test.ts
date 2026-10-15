import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../src/juice/RateLimiter';
import { QualityScaler } from '../../src/juice/QualityScaler';

describe('RateLimiter', () => {
  it('allows the first call', () => {
    expect(new RateLimiter(50).tryAcquire(0)).toBe(true);
    expect(new RateLimiter(50).tryAcquire(123456)).toBe(true);
  });

  it('allows at most one acquisition per 50 ms window over a dense sequence', () => {
    const rl = new RateLimiter(50);
    const accepted: number[] = [];
    for (let t = 0; t <= 2000; t += 3) if (rl.tryAcquire(t)) accepted.push(t);
    expect(accepted[0]).toBe(0);
    for (let i = 1; i < accepted.length; i++) expect(accepted[i] - accepted[i - 1]).toBeGreaterThanOrEqual(50);
    // Any 50 ms half-open window contains at most one acceptance.
    for (let w = 0; w <= 2000; w++) {
      expect(accepted.filter((t) => t >= w && t < w + 50).length).toBeLessThanOrEqual(1);
    }
    // And it does not starve: roughly one per window.
    expect(accepted.length).toBeGreaterThanOrEqual(35);
  });

  it('rejects calls inside the window and accepts at the boundary', () => {
    const rl = new RateLimiter(50);
    expect(rl.tryAcquire(100)).toBe(true);
    expect(rl.tryAcquire(149)).toBe(false);
    expect(rl.tryAcquire(150)).toBe(true);
  });
});

/** Feeds `durationMs` worth of frames at `fps`. */
function run(q: QualityScaler, fps: number, durationMs: number): void {
  const dt = 1000 / fps;
  for (let t = 0; t < durationMs; t += dt) q.update(dt);
}

describe('QualityScaler', () => {
  it('stays at 1.0 at a steady 60 fps', () => {
    const q = new QualityScaler();
    run(q, 60, 60_000);
    expect(q.particleScale).toBe(1.0);
  });

  it('steps to 0.75 after ~5 s at 30 fps and not before', () => {
    const q = new QualityScaler();
    run(q, 30, 4800);
    expect(q.particleScale).toBe(1.0);
    run(q, 30, 500);
    expect(q.particleScale).toBe(0.75);
  });

  it('reaches the 0.35 floor and stays there', () => {
    const q = new QualityScaler();
    run(q, 30, 5300);
    expect(q.particleScale).toBe(0.75);
    run(q, 30, 5100);
    expect(q.particleScale).toBe(0.5);
    run(q, 30, 5100);
    expect(q.particleScale).toBe(0.35);
    run(q, 30, 60_000);
    expect(q.particleScale).toBe(0.35);
  });

  it('recovers one step after ~10 s at 60 fps', () => {
    const q = new QualityScaler();
    run(q, 30, 15_500);
    expect(q.particleScale).toBe(0.35);
    run(q, 60, 9500);
    expect(q.particleScale).toBe(0.35);
    run(q, 60, 1000);
    expect(q.particleScale).toBe(0.5);
    run(q, 60, 10_200);
    expect(q.particleScale).toBe(0.75);
  });

  it('a single slow frame does not step quality down', () => {
    const q = new QualityScaler();
    run(q, 60, 3000);
    q.update(1000); // one big hitch
    q.update(4000);
    run(q, 60, 20_000);
    expect(q.particleScale).toBe(1.0);
  });

  it('ignores invalid frame times', () => {
    const q = new QualityScaler();
    q.update(NaN);
    q.update(-5);
    q.update(Infinity);
    run(q, 60, 1000);
    expect(q.particleScale).toBe(1.0);
  });

  it('honours custom thresholds', () => {
    const q = new QualityScaler({ downAfterMs: 1000, lowFps: 50 });
    run(q, 48, 1300);
    expect(q.particleScale).toBe(0.75);
  });
});
