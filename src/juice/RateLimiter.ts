/**
 * Pure time-based rate limiter (Req 18.5): allows at most one acquisition per
 * `minIntervalMs`. The first call is always allowed. No Phaser dependency.
 */
export class RateLimiter {
  readonly minIntervalMs: number;
  private last = -Infinity;

  constructor(minIntervalMs: number) {
    this.minIntervalMs = Math.max(0, minIntervalMs);
  }

  /** Returns true (and records `nowMs`) if at least `minIntervalMs` passed since the last success. */
  tryAcquire(nowMs: number): boolean {
    if (nowMs - this.last < this.minIntervalMs) return false;
    this.last = nowMs;
    return true;
  }

  reset(): void {
    this.last = -Infinity;
  }
}
