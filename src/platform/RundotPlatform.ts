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
 *  - system.getEnvironment().capabilities: { fullscreen, purchases, ... }
 *  - system.requestFullscreen(options?): Promise<FullscreenState>
 *  - appStorage.getItem(key): Promise<string | null>; setItem(key, string): Promise<void>
 *  - leaderboard.submitScore({ score, duration, mode?, period?, metadata? }): Promise<SubmitScoreResult>
 *  - leaderboard.getPodiumScores({ mode?, period?, topCount?, ... }): Promise<PodiumScoresResponse>
 *  - social.composeSocialPostAsync({ text, shareParams?, media?, title? }): Promise<{ completed, destination? }>
 *  - social.shareFileAsync({ data, filename, mimeType, title?, text? }): Promise<{ cancelled }>
 *  - social.canShareFileAsync(): Promise<{ supported }>
 *  - app.resolveLaunchIntent({ maxWaitMs? }): Promise<LaunchIntent>
 *  - shop.purchase(itemId, idempotencyKey): Promise<ShopPurchaseResult>
 *
 * Leaderboards run in the SDK's default simple mode (no score token): the
 * game ships no rundot/leaderboard.config.json, so the server auto-resolves
 * mode/period with requiresToken off.
 */
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import type {
  CdnFetchOptions,
  FullscreenCapability,
  GetLeaderboardOptions,
  LeaderboardResult,
  PlatformService,
  PlatformSubscription,
  PurchaseResult,
  ScoreEntry,
  SharePayload,
  ShareResult,
  SubmitScoreOptions,
  SubmitScoreOutcome,
} from './PlatformService';

export class RundotPlatform implements PlatformService {

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

  fullscreenCapability(): FullscreenCapability {
    try {
      return RundotGameAPI.system.getEnvironment().capabilities.fullscreen;
    } catch {
      return 'unavailable';
    }
  }

  async requestFullscreen(): Promise<boolean> {
    // The capability read is synchronous, so the SDK call below still runs
    // inside the player's gesture (required by the host/browser).
    const cap = this.fullscreenCapability();
    if (cap === 'always-on') return true;
    if (cap !== 'toggleable') return false;
    try {
      const state = await RundotGameAPI.system.requestFullscreen();
      return state.active;
    } catch {
      return false;
    }
  }

  // ---- v3 (task 19: real SDK) ----------------------------------------------
  async load<T>(key: string): Promise<T | null> {
    const raw = await RundotGameAPI.appStorage.getItem(key);
    if (raw === null) return null;
    // Malformed stored JSON throws (SyntaxError) so callers can tell corrupt
    // data apart from an absent key and avoid overwriting it.
    return JSON.parse(raw) as T;
  }

  async save<T>(key: string, value: T): Promise<void> {
    const raw = JSON.stringify(value);
    if (raw === undefined) throw new TypeError('RundotPlatform.save: value is not JSON-serializable');
    await RundotGameAPI.appStorage.setItem(key, raw);
  }

  async submitScore(board: string, score: number, opts: SubmitScoreOptions): Promise<SubmitScoreOutcome> {
    const res = await RundotGameAPI.leaderboard.submitScore({
      score,
      duration: opts.durationSec,
      mode: board,
      period: opts.period,
      metadata: opts.meta,
    });
    return { accepted: res.accepted, rank: res.rank ?? null, reason: res.reason ?? null };
  }

  async getLeaderboard(board: string, opts?: GetLeaderboardOptions): Promise<LeaderboardResult> {
    const limit = opts?.limit ?? 10;
    const res = await RundotGameAPI.leaderboard.getPodiumScores({
      mode: board,
      period: opts?.period,
      topCount: limit,
      contextAhead: 0,
      contextBehind: 0,
    });
    const topEntries = res.context?.topEntries?.length ? res.context.topEntries : res.entries;
    const top = topEntries.slice(0, limit).map((e, i) => toScoreEntry(e, i + 1));
    const player = res.context?.playerEntry;
    return player ? { top, me: toScoreEntry(player, res.playerRank ?? 0) } : { top };
  }

  async share(payload: SharePayload): Promise<ShareResult> {
    const mimeType = shareMimeType(payload.image);
    const filename = payload.filename ?? defaultShareFilename(mimeType);
    if (payload.shareParams && Object.keys(payload.shareParams).length > 0) {
      // Local dev/playground: the SDK mock mints dead `mock-share-url.com`
      // links and opens a real X composer with one. Report not-completed so
      // callers fall back to copying a plain, working challenge link.
      if (isDevelopmentSurface()) return { completed: false, destination: 'dev' };
      // One host flow carrying both the card image and a tracked share link
      // minted from shareParams (delivered back via launch intent).
      const res = await RundotGameAPI.social.composeSocialPostAsync({
        text: payload.text,
        shareParams: payload.shareParams,
        media: { data: payload.image, filename, mimeType },
        title: payload.title,
      });
      return { completed: res.completed, destination: res.destination };
    }
    const can = await RundotGameAPI.social.canShareFileAsync();
    if (!can.supported) throw new Error('RundotPlatform.share: file sharing is not supported on this surface');
    const res = await RundotGameAPI.social.shareFileAsync({
      data: payload.image,
      filename,
      mimeType,
      title: payload.title,
      text: payload.text,
    });
    return { completed: !res.cancelled, cancelled: res.cancelled };
  }

  async getLaunchParams(maxWaitMs = 800): Promise<Record<string, string>> {
    // Page URL params are the base layer so plain web deep links (e.g. a
    // copied challenge link opened directly) still reach the game; the host
    // launch intent wins on conflicts.
    const out: Record<string, string> = {};
    if (typeof window !== 'undefined') {
      new URLSearchParams(window.location.search).forEach((v, k) => (out[k] = v));
    }
    try {
      const intent = await RundotGameAPI.app.resolveLaunchIntent({ maxWaitMs });
      return { ...out, ...(intent.params ?? {}) };
    } catch {
      return out;
    }
  }

  paymentsSupported(): boolean {
    try {
      return RundotGameAPI.system.getEnvironment().capabilities.purchases;
    } catch {
      return false;
    }
  }

  async purchase(sku: string, idempotencyKey?: string): Promise<PurchaseResult> {
    try {
      const res = await RundotGameAPI.shop.purchase(sku, idempotencyKey ?? newIdempotencyKey());
      if (res.success) return 'ok';
      return res.cancelled ? 'cancelled' : 'failed';
    } catch (err) {
      if (isUserCancelled(err)) return 'cancelled';
      this.log(`[RundotPlatform] shop.purchase failed for ${sku}: ${err instanceof Error ? err.message : String(err)}`);
      return 'failed';
    }
  }
}

type SdkLeaderboardEntry = Awaited<ReturnType<typeof RundotGameAPI.leaderboard.getPodiumScores>>['entries'][number];

function toScoreEntry(entry: SdkLeaderboardEntry, fallbackRank: number): ScoreEntry {
  return {
    rank: entry.rank ?? fallbackRank,
    name: entry.username,
    score: entry.score,
    ...(entry.metadata ? { meta: entry.metadata } : {}),
  };
}

const SHARE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4'] as const;
type ShareMimeType = (typeof SHARE_MIME_TYPES)[number];

function shareMimeType(image: Blob): ShareMimeType {
  if ((SHARE_MIME_TYPES as readonly string[]).includes(image.type)) return image.type as ShareMimeType;
  // Phaser snapshot blobs are PNG; an empty type is treated as PNG.
  if (!image.type) return 'image/png';
  throw new Error(`RundotPlatform.share: unsupported image type ${image.type}`);
}

function defaultShareFilename(mimeType: ShareMimeType): string {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
  return `monster-card.${ext}`;
}

function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `mms-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** True on a Vite dev build or when the host reports a development surface. */
function isDevelopmentSurface(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return RundotGameAPI.system.getEnvironment().isDevelopment === true;
  } catch {
    return false;
  }
}

function isUserCancelled(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'USER_CANCELLED') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('USER_CANCELLED');
}
