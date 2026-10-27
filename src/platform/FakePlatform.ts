/**
 * In-memory PlatformService for tests and local dev. Must NOT import the SDK.
 * Exposes helpers (`triggerPause`, `triggerResume`, recorded `events`, etc.)
 * so tests can drive host lifecycle and inspect analytics.
 */
import { MemoryStubs } from './MemoryStubs';
import type {
  CdnFetchOptions,
  FullscreenCapability,
  GetLeaderboardOptions,
  LeaderboardResult,
  PlatformService,
  PlatformSubscription,
  PurchaseResult,
  SharePayload,
  ShareResult,
  SubmitScoreOptions,
  SubmitScoreOutcome,
} from './PlatformService';

export interface TrackedEvent {
  event: string;
  props?: Record<string, unknown>;
}

export interface FunnelStep {
  step: number;
  name: string;
  funnelName?: string;
  funnelOrder?: number;
}

export interface FakePlatformOptions {
  /** Assets returned by fetchCdnAsset; missing paths reject. */
  cdnAssets?: Record<string, Blob>;
  launchParams?: Record<string, string>;
  /** Echo log() to console. Default false. */
  echoLogs?: boolean;
  /** Initial paymentsSupported() value. Default false. */
  paymentsSupported?: boolean;
}

/** Async v3 methods that support one-shot failure injection via failNext(). */
export type FakeFailureMethod = 'load' | 'save' | 'submitScore' | 'getLeaderboard' | 'share' | 'purchase';

export interface RecordedPurchase {
  sku: string;
  idempotencyKey?: string;
}

export class FakePlatform implements PlatformService {
  readonly logs: string[] = [];
  readonly events: TrackedEvent[] = [];
  readonly funnelSteps: FunnelStep[] = [];
  /** Test-controlled fullscreen capability (RundotPlatform mirrors this). */
  fullscreenCap: FullscreenCapability = 'unavailable';
  /** Number of times a 'toggleable' host fullscreen call would have been made. */
  fullscreenRequests = 0;
  /** Test-controlled paymentsSupported() value. */
  paymentsEnabled: boolean;
  /** Outcome returned by purchase() while payments are enabled. Default 'ok'. */
  purchaseResult: PurchaseResult = 'ok';
  /** Every purchase() call, in order. */
  readonly purchases: RecordedPurchase[] = [];

  private readonly pauseCbs = new Set<() => void>();
  private readonly resumeCbs = new Set<() => void>();
  private readonly mem = new MemoryStubs();
  private readonly cdnAssets: Map<string, Blob>;
  private readonly launchParams: Record<string, string>;
  private readonly pendingFailures = new Map<FakeFailureMethod, Error>();
  private readonly echoLogs: boolean;

  constructor(opts: FakePlatformOptions = {}) {
    this.cdnAssets = new Map(Object.entries(opts.cdnAssets ?? {}));
    this.launchParams = { ...(opts.launchParams ?? {}) };
    this.paymentsEnabled = opts.paymentsSupported ?? false;
    this.echoLogs = opts.echoLogs ?? false;
  }

  /** Recorded share payloads. */
  get shares(): readonly SharePayload[] {
    return this.mem.shares;
  }

  // ---- test helpers --------------------------------------------------------
  triggerPause(): void {
    for (const cb of [...this.pauseCbs]) cb();
  }

  triggerResume(): void {
    for (const cb of [...this.resumeCbs]) cb();
  }

  setCdnAsset(path: string, blob: Blob): void {
    this.cdnAssets.set(path, blob);
  }

  /**
   * Make the next call to `method` fail once, mirroring a host/storage error.
   * Storage/leaderboard/share calls reject; purchase resolves 'failed'
   * instead, matching RundotPlatform's never-rejects purchase contract.
   */
  failNext(method: FakeFailureMethod, error?: Error): void {
    this.pendingFailures.set(method, error ?? new Error(`FakePlatform: injected ${method} failure`));
  }

  private throwIfFailing(method: FakeFailureMethod): void {
    const err = this.pendingFailures.get(method);
    if (!err) return;
    this.pendingFailures.delete(method);
    throw err;
  }

  private consumeFailure(method: FakeFailureMethod): boolean {
    if (!this.pendingFailures.has(method)) return false;
    this.pendingFailures.delete(method);
    return true;
  }

  // ---- v1 ------------------------------------------------------------------
  log(msg: string, ...args: unknown[]): void {
    const line = args.length ? `${msg} ${args.map((a) => safeString(a)).join(' ')}` : msg;
    this.logs.push(line);
    if (this.echoLogs) console.log(line);
  }

  onPause(cb: () => void): PlatformSubscription {
    this.pauseCbs.add(cb);
    return { unsubscribe: () => void this.pauseCbs.delete(cb) };
  }

  onResume(cb: () => void): PlatformSubscription {
    this.resumeCbs.add(cb);
    return { unsubscribe: () => void this.resumeCbs.delete(cb) };
  }

  track(event: string, props?: Record<string, unknown>): void {
    this.events.push(props ? { event, props: { ...props } } : { event });
  }

  funnel(step: number, name: string, funnelName?: string, funnelOrder?: number): void {
    this.funnelSteps.push({ step, name, funnelName, funnelOrder });
  }

  async fetchCdnAsset(path: string, _opts?: CdnFetchOptions): Promise<Blob> {
    const blob = this.cdnAssets.get(path);
    if (!blob) throw new Error(`FakePlatform: CDN asset not found: ${path}`);
    return blob;
  }

  fullscreenCapability(): FullscreenCapability {
    return this.fullscreenCap;
  }

  async requestFullscreen(): Promise<boolean> {
    if (this.fullscreenCap === 'always-on') return true;
    if (this.fullscreenCap !== 'toggleable') return false;
    this.fullscreenRequests++;
    return true;
  }

  // ---- v3 ------------------------------------------------------------------
  async load<T>(key: string): Promise<T | null> {
    this.throwIfFailing('load');
    return this.mem.load<T>(key);
  }

  async save<T>(key: string, value: T): Promise<void> {
    this.throwIfFailing('save');
    return this.mem.save(key, value);
  }

  async submitScore(board: string, score: number, opts: SubmitScoreOptions): Promise<SubmitScoreOutcome> {
    this.throwIfFailing('submitScore');
    return this.mem.submitScore(board, score, opts);
  }

  async getLeaderboard(board: string, opts?: GetLeaderboardOptions): Promise<LeaderboardResult> {
    this.throwIfFailing('getLeaderboard');
    return this.mem.getLeaderboard(board, opts);
  }

  async share(payload: SharePayload): Promise<ShareResult> {
    this.throwIfFailing('share');
    return this.mem.share(payload);
  }

  async getLaunchParams(): Promise<Record<string, string>> {
    return { ...this.launchParams };
  }

  paymentsSupported(): boolean {
    return this.paymentsEnabled;
  }

  async purchase(sku: string, idempotencyKey?: string): Promise<PurchaseResult> {
    this.purchases.push(idempotencyKey === undefined ? { sku } : { sku, idempotencyKey });
    if (this.consumeFailure('purchase')) return 'failed';
    if (!this.paymentsEnabled) return 'failed';
    return this.purchaseResult;
  }
}

function safeString(a: unknown): string {
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}
