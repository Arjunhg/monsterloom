/**
 * PlatformService: the only boundary between game code and the RUN SDK.
 *
 * This file must NOT import `@series-inc/rundot-game-sdk` so it (and
 * FakePlatform) can be used in Node-based unit/property tests.
 *
 * Implementations:
 *  - RundotPlatform (./RundotPlatform.ts): wraps RundotGameAPI.
 *  - FakePlatform   (./FakePlatform.ts):   in-memory, for tests and local dev.
 *
 * Requirements: 1.3 (SDK integration), 1.7–1.8 (auto-pause on host pause/sleep).
 */

/** A single leaderboard row. */
export interface ScoreEntry {
  rank: number;
  name: string;
  score: number;
  meta?: Record<string, unknown>;
}

export interface LeaderboardResult {
  top: ScoreEntry[];
  me?: ScoreEntry;
}

export interface SharePayload {
  image: Blob;
  text: string;
  url: string;
}

export type PurchaseResult = 'ok' | 'cancelled' | 'failed';

/** Host fullscreen availability on this surface (RUN system capabilities). */
export type FullscreenCapability = 'unavailable' | 'always-on' | 'toggleable';

export interface CdnFetchOptions {
  /** Timeout in milliseconds. */
  timeout?: number;
}

/** Handle returned by lifecycle subscriptions. */
export interface PlatformSubscription {
  unsubscribe(): void;
}

export interface PlatformService {
  // ---- v1 -----------------------------------------------------------------
  /** Debug log routed to host tooling (falls back to console). */
  log(msg: string, ...args: unknown[]): void;
  /** Fires when the host pauses OR sleeps the game (lifecycles.onPause / onSleep). */
  onPause(cb: () => void): PlatformSubscription;
  /** Fires when the host resumes the game (lifecycles.onResume). */
  onResume(cb: () => void): PlatformSubscription;
  /** Custom analytics event (analytics.recordCustomEvent). Fire-and-forget. */
  track(event: string, props?: Record<string, unknown>): void;
  /** Funnel step (analytics.trackFunnelStep). Fire-and-forget. */
  funnel(step: number, name: string, funnelName?: string, funnelOrder?: number): void;
  /** Fetch an asset from `cdn-assets/` (cdn.fetchAsset). Rejects on failure. */
  fetchCdnAsset(path: string, opts?: CdnFetchOptions): Promise<Blob>;
  /** Whether host fullscreen exists / can be toggled here (system.getEnvironment). */
  fullscreenCapability(): FullscreenCapability;
  /**
   * Ask the host to enter fullscreen so the game fills the screen. Must be
   * called from a direct player action, before any other await in that
   * handler. Resolves `true` when fullscreen is active after the call
   * (including 'always-on' surfaces). Never rejects.
   */
  requestFullscreen(): Promise<boolean>;

  // ---- v3 (stubs for now; to be mapped to SDK storage/leaderboard/sharing/purchases) ----
  load<T>(key: string): Promise<T | null>;
  save<T>(key: string, value: T): Promise<void>;
  submitScore(board: string, score: number, meta?: Record<string, unknown>): Promise<void>;
  getLeaderboard(board: string): Promise<LeaderboardResult>;
  share(payload: SharePayload): Promise<void>;
  /** Launch parameters (e.g. challenge link payload). */
  getLaunchParams(): Record<string, string>;
  paymentsSupported(): boolean;
  purchase(sku: string): Promise<PurchaseResult>;
}
