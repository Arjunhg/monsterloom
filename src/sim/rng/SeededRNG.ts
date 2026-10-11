/**
 * Deterministic seeded RNG (Req 17).
 *
 * mulberry32 core with gameplay helpers. All gameplay randomness must come from
 * a SeededRNG; runs fork independent named streams (`spawn`, `drops`,
 * `upgrades`, `ai`) so that changing how often one system draws numbers does
 * not shift the outcomes of another. Cosmetic randomness may use Math.random.
 */

/** Names of the standard per-run streams. */
export type RngStreamName = 'spawn' | 'drops' | 'upgrades' | 'ai';

/** FNV-1a 32-bit hash of a string (UTF-16 code units). Returns a uint32. */
export function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Normalize any number to a uint32 seed (non-finite values become 0). */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  // Math.trunc then >>> 0 wraps negatives / large values into [0, 2^32).
  return Math.trunc(seed) >>> 0;
}

/** murmur3 fmix32 avalanche finalizer; used to decorrelate forked seeds. */
function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Generate a fresh uint32 seed for runs started without a provided seed
 * (Req 17.3). Non-gameplay: uses crypto when available, else Math.random.
 */
export function newSeed(): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] >>> 0;
  }
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

export class SeededRNG {
  /** The normalized uint32 seed this instance was created with. */
  readonly seed: number;
  private state: number;

  constructor(seed: number) {
    this.seed = normalizeSeed(seed);
    this.state = this.seed;
  }

  /** Next float in [0, 1). mulberry32; allocation-free. */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], both inclusive. Bounds are floored/ceiled to integers and swapped if reversed. */
  int(min: number, max: number): number {
    let lo = Math.ceil(min);
    let hi = Math.floor(max);
    if (lo > hi) {
      const tmp = lo;
      lo = hi;
      hi = tmp;
    }
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniformly pick an element. Throws on an empty array (programmer error). */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('SeededRNG.pick: empty array');
    return arr[Math.floor(this.next() * arr.length)];
  }

  /**
   * Pick an item with probability proportional to `weightFn(item)`.
   * Items with weight <= 0 or non-finite weight are never picked.
   * Returns undefined if no item has positive weight.
   */
  weighted<T>(items: readonly T[], weightFn: (item: T, index: number) => number): T | undefined {
    let total = 0;
    let lastValid = -1;
    for (let i = 0; i < items.length; i++) {
      const w = weightFn(items[i], i);
      if (w > 0 && Number.isFinite(w)) {
        total += w;
        lastValid = i;
      }
    }
    if (lastValid < 0) return undefined;

    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      const w = weightFn(items[i], i);
      if (!(w > 0 && Number.isFinite(w))) continue;
      r -= w;
      if (r < 0) return items[i];
    }
    // Float rounding fallback: last positive-weight item.
    return items[lastValid];
  }

  /** In-place Fisher–Yates shuffle. Returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * Derive an independent deterministic stream. Depends only on this
   * instance's original seed and `name` (not on how many numbers were drawn),
   * so forking order and draw counts don't affect forked streams.
   */
  fork(name: RngStreamName | string): SeededRNG {
    const nameHash = mix32((fnv1a32(name) + 0x9e3779b9) >>> 0);
    return new SeededRNG(mix32((this.seed ^ nameHash) >>> 0));
  }
}

/** Standard per-run stream bundle forked from a run seed. */
export interface RunRngStreams {
  spawn: SeededRNG;
  drops: SeededRNG;
  upgrades: SeededRNG;
  ai: SeededRNG;
}

/** Create the standard forked streams for a run seed. */
export function createRunStreams(seed: number): RunRngStreams {
  const root = new SeededRNG(seed);
  return {
    spawn: root.fork('spawn'),
    drops: root.fork('drops'),
    upgrades: root.fork('upgrades'),
    ai: root.fork('ai'),
  };
}
