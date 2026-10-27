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
  /** Card image to share (PNG/JPEG/WebP/GIF; SDK file-share limit is 10 MB). */
  image: Blob;
  /** Caption text passed to the host share flow (SDK compose limit: 500 chars). */
  text: string;
  /**
   * Params the host mints into a tracked share link and delivers back via
   * launch intent. The SDK deliberately has no arbitrary-URL parameter, so
   * challenge payloads travel here (e.g. `{ challenge: '<encoded>' }`).
   */
  shareParams?: Record<string, string>;
  /** Optional post title (used by destinations that support one). */
  title?: string;
  /** Filename presented to share targets. Defaults from the image MIME type. */
  filename?: string;
}

export interface ShareResult {
  /** True when a share destination actually opened / the file was shared. */
  completed: boolean;
  /** Destination that handled the share, when the host reports one. */
  destination?: string;
  /** True when the player dismissed the share sheet (file-share path only). */
  cancelled?: boolean;
}

export interface SubmitScoreOptions {
  /** Run length in seconds. Required by the SDK leaderboard API. */
  durationSec: number;
  /** Leaderboard period key (e.g. 'daily', 'alltime'); host default if omitted. */
  period?: string;
  /** Game-supplied data stored with the entry and returned on leaderboard rows. */
  meta?: Record<string, unknown>;
}

export interface SubmitScoreOutcome {
  /** False is a normal rejection (e.g. keep-best), not an exception. */
  accepted: boolean;
  /** Player rank after submission; null/absent when not accepted. */
  rank?: number | null;
  /** Human-readable rejection reason from the host, when not accepted. */
  reason?: string | null;
}

export interface GetLeaderboardOptions {
  /** Max rows to return. Default 10. */
  limit?: number;
  /** Leaderboard period key (e.g. 'daily', 'alltime'); host default if omitted. */
  period?: string;
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

  // ---- v3 (task 19: mapped onto the real SDK; see RundotPlatform) ---------
  /**
   * Load a JSON value from per-game cloud storage (appStorage.getItem).
   * Resolves `null` when the key is absent. Rejects on host/storage errors
   * and on malformed stored JSON, so callers can tell "unavailable/corrupt"
   * apart from "absent" and avoid overwriting stored data. Keys must satisfy
   * the SDK rules: non-empty, ≤ 256 bytes, no `.`, no `__` prefix.
   */
  load<T>(key: string): Promise<T | null>;
  /** Save a JSON value to per-game cloud storage (appStorage.setItem). Rejects on failure. */
  save<T>(key: string, value: T): Promise<void>;
  /**
   * Submit a score (leaderboard.submitScore). `board` is the SDK leaderboard
   * mode; `opts.period` selects the period (e.g. 'daily'). A host rejection
   * such as keep-best resolves with `accepted: false`; transport/host errors
   * reject so callers can offer a retry.
   */
  submitScore(board: string, score: number, opts: SubmitScoreOptions): Promise<SubmitScoreOutcome>;
  /** Top rows plus the player's own entry (leaderboard.getPodiumScores). Rejects on failure. */
  getLeaderboard(board: string, opts?: GetLeaderboardOptions): Promise<LeaderboardResult>;
  /**
   * Open the host share flow for a card image (social.composeSocialPostAsync
   * when shareParams are present, else social.shareFileAsync). Rejects on
   * validation/transport failures; player dismissal resolves completed:false.
   */
  share(payload: SharePayload): Promise<ShareResult>;
  /**
   * Launch/share parameters for this boot (app.resolveLaunchIntent), waited on
   * up to `maxWaitMs` so deferred deep links can resolve. Best-effort: if the
   * host call fails, falls back to the page URL's query parameters.
   */
  getLaunchParams(maxWaitMs?: number): Promise<Record<string, string>>;
  /** Whether this surface can initiate purchases (system capabilities.purchases). */
  paymentsSupported(): boolean;
  /**
   * Buy a shop-catalog item by SKU (shop.purchase). Never rejects: host
   * failures resolve `'failed'`, player dismissal `'cancelled'`. Pass a
   * stable `idempotencyKey` when retrying the same intended purchase — for
   * direct-purchase items a fresh key can charge twice.
   */
  purchase(sku: string, idempotencyKey?: string): Promise<PurchaseResult>;
}
