/**
 * In-memory PlatformService for tests and local dev. Must NOT import the SDK.
 * Exposes helpers (`triggerPause`, `triggerResume`, recorded `events`, etc.)
 * so tests can drive host lifecycle and inspect analytics.
 */
import { MemoryStubs } from './MemoryStubs';
import type {
  CdnFetchOptions,
  FullscreenCapability,
  LeaderboardResult,
  PlatformService,
  PlatformSubscription,
  PurchaseResult,
  SharePayload,
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
}

export class FakePlatform implements PlatformService {
  readonly logs: string[] = [];
  readonly events: TrackedEvent[] = [];
  readonly funnelSteps: FunnelStep[] = [];
  /** Test-controlled fullscreen capability (RundotPlatform mirrors this). */
  fullscreenCap: FullscreenCapability = 'unavailable';
  /** Number of times a 'toggleable' host fullscreen call would have been made. */
  fullscreenRequests = 0;

  private readonly pauseCbs = new Set<() => void>();
  private readonly resumeCbs = new Set<() => void>();
  private readonly mem = new MemoryStubs();
  private readonly cdnAssets: Map<string, Blob>;
  private readonly launchParams: Record<string, string>;
  private readonly echoLogs: boolean;

  constructor(opts: FakePlatformOptions = {}) {
    this.cdnAssets = new Map(Object.entries(opts.cdnAssets ?? {}));
    this.launchParams = { ...(opts.launchParams ?? {}) };
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
    return { ...this.launchParams };
  }

  paymentsSupported(): boolean {
    return this.mem.paymentsSupported();
  }

  purchase(sku: string): Promise<PurchaseResult> {
    return this.mem.purchase(sku);
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
