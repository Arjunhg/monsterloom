/**
 * SDK-free in-memory backend for the v3 PlatformService methods.
 * Used by FakePlatform for tests and local dev; RundotPlatform maps the same
 * contract onto the real SDK (task 19). Must NOT import the SDK.
 *
 * Semantics mirror RundotPlatform: storage values are JSON-serialized,
 * malformed stored JSON throws on load, leaderboard submissions resolve an
 * accepted/rank outcome, and share resolves a completed result.
 */
import type {
  GetLeaderboardOptions,
  LeaderboardResult,
  ScoreEntry,
  SharePayload,
  ShareResult,
  SubmitScoreOptions,
  SubmitScoreOutcome,
} from './PlatformService';

export class MemoryStubs {
  private readonly store = new Map<string, string>();
  private readonly boards = new Map<string, ScoreEntry[]>();
  readonly shares: SharePayload[] = [];

  async load<T>(key: string): Promise<T | null> {
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    // Malformed JSON throws (SyntaxError), matching RundotPlatform: callers
    // must be able to tell corrupt data apart from an absent key.
    return JSON.parse(raw) as T;
  }

  async save<T>(key: string, value: T): Promise<void> {
    // Serialize so callers can't mutate stored state by reference.
    const raw = JSON.stringify(value);
    if (raw === undefined) throw new TypeError('MemoryStubs.save: value is not JSON-serializable');
    this.store.set(key, raw);
  }

  async submitScore(board: string, score: number, opts: SubmitScoreOptions): Promise<SubmitScoreOutcome> {
    const rows = this.boards.get(board) ?? [];
    const entry: ScoreEntry = { rank: 0, name: 'You', score, meta: opts.meta };
    rows.push(entry);
    rows.sort((a, b) => b.score - a.score);
    rows.forEach((r, i) => (r.rank = i + 1));
    this.boards.set(board, rows);
    return { accepted: true, rank: entry.rank };
  }

  async getLeaderboard(board: string, opts?: GetLeaderboardOptions): Promise<LeaderboardResult> {
    const rows = this.boards.get(board) ?? [];
    const limit = opts?.limit ?? 10;
    const top = rows.slice(0, limit).map((r) => ({ ...r }));
    const me = rows.find((r) => r.name === 'You');
    return me ? { top, me: { ...me } } : { top };
  }

  async share(payload: SharePayload): Promise<ShareResult> {
    this.shares.push(payload);
    return { completed: true, destination: 'fake' };
  }
}
