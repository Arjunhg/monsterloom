/**
 * SDK-free in-memory implementations of the v3 PlatformService methods.
 * Shared by RundotPlatform (until the real SDK mapping lands) and FakePlatform.
 * Must NOT import the SDK.
 */
import type { LeaderboardResult, PurchaseResult, ScoreEntry, SharePayload } from './PlatformService';

export class MemoryStubs {
  private readonly store = new Map<string, string>();
  private readonly boards = new Map<string, ScoreEntry[]>();
  readonly shares: SharePayload[] = [];

  async load<T>(key: string): Promise<T | null> {
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async save<T>(key: string, value: T): Promise<void> {
    // Serialize so callers can't mutate stored state by reference.
    this.store.set(key, JSON.stringify(value));
  }

  async submitScore(board: string, score: number, meta?: Record<string, unknown>): Promise<void> {
    const rows = this.boards.get(board) ?? [];
    rows.push({ rank: 0, name: 'You', score, meta });
    rows.sort((a, b) => b.score - a.score);
    rows.forEach((r, i) => (r.rank = i + 1));
    this.boards.set(board, rows);
  }

  async getLeaderboard(board: string): Promise<LeaderboardResult> {
    const rows = this.boards.get(board) ?? [];
    const top = rows.slice(0, 10).map((r) => ({ ...r }));
    const best = rows[0];
    return best ? { top, me: { ...best } } : { top };
  }

  async share(payload: SharePayload): Promise<void> {
    this.shares.push(payload);
  }

  paymentsSupported(): boolean {
    return false;
  }

  async purchase(_sku: string): Promise<PurchaseResult> {
    return 'failed';
  }
}
