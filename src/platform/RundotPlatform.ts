/**
 * PlatformService backed by the RUN SDK (@series-inc/rundot-game-sdk@5.28.1).
 * This is the ONLY file in the game that imports the SDK.
 *
 * SDK signatures relied on (from the 5.28.1 typings / .rundot-docs):
 *  - RundotGameAPI.log(message: string, ...args): void
 *  - lifecycles.onPause/onSleep/onResume(cb: () => void): Subscription { unsubscribe() }
 *  - analytics.recordCustomEvent(eventName, payload?: Record<string, any>): Promise<void>
 *  - analytics.trackFunnelStep(stepNumber, stepName, funnelName?, funnelOrder?): Promise<void>
 *  - cdn.fetchAsset(path, options?: { timeout?: number, ... }): Promise<Blob>
 *
 * v3 methods are in-memory stubs until mapped to storage / leaderboard /
 * sharing / purchases APIs.
 */
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import { MemoryStubs } from './MemoryStubs';
import type {
  CdnFetchOptions,
  LeaderboardResult,
  PlatformService,
  PlatformSubscription,
  PurchaseResult,
  SharePayload,
} from './PlatformService';

export class RundotPlatform implements PlatformService {
  private readonly mem = new MemoryStubs();

  // ---- v1 ------------------------------------------------------------------
  log(msg: string, ...args: unknown[]): void {
    try {
      RundotGameAPI.log(msg, ...args);
    } catch {
      console.log(msg, ...args);
    }
  }

  onPause(cb: () => void): PlatformSubscription {
    // Host pause and long sleep both trigger auto-pause (Req 1.7).
    const subs = [RundotGameAPI.lifecycles.onPause(cb), RundotGameAPI.lifecycles.onSleep(cb)];
    return { unsubscribe: () => subs.forEach((s) => s.unsubscribe()) };
  }

  onResume(cb: () => void): PlatformSubscription {
    const sub = RundotGameAPI.lifecycles.onResume(cb);
    return { unsubscribe: () => sub.unsubscribe() };
  }

  track(event: string, props?: Record<string, unknown>): void {
    try {
      void RundotGameAPI.analytics.recordCustomEvent(event, props ?? {}).catch(() => {});
    } catch {
      /* analytics is fire-and-forget */
    }
  }

  funnel(step: number, name: string, funnelName?: string, funnelOrder?: number): void {
    try {
      void RundotGameAPI.analytics
        .trackFunnelStep(step, name, funnelName, funnelOrder)
        .catch(() => {});
    } catch {
      /* analytics is fire-and-forget */
    }
  }

  fetchCdnAsset(path: string, opts?: CdnFetchOptions): Promise<Blob> {
    return RundotGameAPI.cdn.fetchAsset(path, opts);
  }

  // ---- v3 (stubs) ----------------------------------------------------------
  load<T>(key: string): Promise<T | null> {
    return this.mem.load<T>(key);
  }

  save<T>(key: string, value: T): Promise<void> {
    return this.mem.save(key, value);
  }

  submitScore(board: string, score: number, meta?: Record<string, unknown>): Promise<void> {
    return this.mem.submitScore(board, score, meta);
  }

  getLeaderboard(board: string): Promise<LeaderboardResult> {
    return this.mem.getLeaderboard(board);
  }

  share(payload: SharePayload): Promise<void> {
    return this.mem.share(payload);
  }

  getLaunchParams(): Record<string, string> {
    if (typeof window === 'undefined') return {};
    const out: Record<string, string> = {};
    new URLSearchParams(window.location.search).forEach((v, k) => (out[k] = v));
    return out;
  }

  paymentsSupported(): boolean {
    return false;
  }

  purchase(sku: string): Promise<PurchaseResult> {
    return this.mem.purchase(sku);
  }
}
