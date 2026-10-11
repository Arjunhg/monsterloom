/**
 * Uniform-grid spatial hash over points (Req 16.3–16.4).
 *
 * - Cells are keyed by a hashed integer `(cx * 73856093) ^ (cy * 19349663)`
 *   (32-bit via Math.imul) in a `Map<number, number[]>`, so the world is unbounded.
 * - Buckets hold entry indices (not ids). Each entry stores its id, exact point
 *   and owning cell coords, so hash collisions (two cells → same key) are
 *   resolved by checking the entry's cell, and every result is distance-checked.
 * - Bucket arrays and entry storage are pooled and reused across `clear()`,
 *   so a steady-state rebuild every tick does not allocate.
 *
 * Callers are expected to insert each id at most once between clears.
 */
export class SpatialHash {
  readonly cellSize: number;
  private readonly invCell: number;

  private readonly buckets = new Map<number, number[]>();
  private readonly activeBuckets: number[][] = [];
  private readonly bucketPool: number[][] = [];

  private capacity: number;
  private count = 0;
  private ids: Float64Array;
  private xs: Float64Array;
  private ys: Float64Array;
  private cxs: Float64Array;
  private cys: Float64Array;

  constructor(cellSize = 64, initialCapacity = 512) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) {
      throw new RangeError(`SpatialHash cellSize must be a positive finite number, got ${cellSize}`);
    }
    this.cellSize = cellSize;
    this.invCell = 1 / cellSize;
    this.capacity = Math.max(1, initialCapacity | 0);
    this.ids = new Float64Array(this.capacity);
    this.xs = new Float64Array(this.capacity);
    this.ys = new Float64Array(this.capacity);
    this.cxs = new Float64Array(this.capacity);
    this.cys = new Float64Array(this.capacity);
  }

  /** Number of points currently inserted. */
  get size(): number {
    return this.count;
  }

  /** Removes all points; bucket arrays are returned to the pool for reuse. */
  clear(): void {
    const active = this.activeBuckets;
    for (let i = 0; i < active.length; i++) {
      const b = active[i]!;
      b.length = 0;
      this.bucketPool.push(b);
    }
    active.length = 0;
    this.buckets.clear();
    this.count = 0;
  }

  insert(id: number, x: number, y: number): void {
    if (this.count === this.capacity) this.grow();
    const i = this.count++;
    const cx = Math.floor(x * this.invCell);
    const cy = Math.floor(y * this.invCell);
    this.ids[i] = id;
    this.xs[i] = x;
    this.ys[i] = y;
    this.cxs[i] = cx;
    this.cys[i] = cy;

    const key = SpatialHash.key(cx, cy);
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = this.bucketPool.pop() ?? [];
      this.buckets.set(key, bucket);
      this.activeBuckets.push(bucket);
    }
    bucket.push(i);
  }

  /**
   * Clears `out`, fills it with ids whose point lies within distance `r`
   * (inclusive) of (x, y), and returns the count.
   */
  queryRadius(x: number, y: number, r: number, out: number[]): number {
    out.length = 0;
    if (this.count === 0 || !(r >= 0)) return 0;
    const r2 = r * r;

    const minCx = Math.floor((x - r) * this.invCell);
    const maxCx = Math.floor((x + r) * this.invCell);
    const minCy = Math.floor((y - r) * this.invCell);
    const maxCy = Math.floor((y + r) * this.invCell);
    const cellsW = maxCx - minCx + 1;
    const cellsH = maxCy - minCy + 1;

    // Huge radius: scanning every entry is cheaper (and avoids unbounded loops).
    if (!(cellsW * cellsH <= this.count)) {
      for (let i = 0; i < this.count; i++) {
        const dx = this.xs[i]! - x;
        const dy = this.ys[i]! - y;
        if (dx * dx + dy * dy <= r2) out.push(this.ids[i]!);
      }
      return out.length;
    }

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.buckets.get(SpatialHash.key(cx, cy));
        if (bucket === undefined) continue;
        for (let k = 0; k < bucket.length; k++) {
          const i = bucket[k]!;
          // Skip entries from a different cell sharing this hash key.
          if (this.cxs[i] !== cx || this.cys[i] !== cy) continue;
          const dx = this.xs[i]! - x;
          const dy = this.ys[i]! - y;
          if (dx * dx + dy * dy <= r2) out.push(this.ids[i]!);
        }
      }
    }
    return out.length;
  }

  /**
   * Exact nearest point to (x, y) within `maxR` (inclusive) that passes `filter`.
   * Returns its id, or −1 if none. Ties resolve to the first found minimum.
   */
  nearest(x: number, y: number, maxR: number, filter?: (id: number) => boolean): number {
    if (this.count === 0 || !(maxR >= 0)) return -1;
    const cs = this.cellSize;
    const ccx = Math.floor(x * this.invCell);
    const ccy = Math.floor(y * this.invCell);
    // Ring k covers cells at Chebyshev distance k from the centre cell. Any point
    // within maxR lies in a ring ≤ maxRing.
    const maxRing = Math.floor(maxR * this.invCell) + 1;
    const side = 2 * maxRing + 1;

    let bestId = -1;
    let bestD2 = maxR * maxR;

    if (!(side * side <= this.count * 4)) {
      // Search area dwarfs the population: brute-force scan.
      for (let i = 0; i < this.count; i++) {
        const dx = this.xs[i]! - x;
        const dy = this.ys[i]! - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > bestD2 || (bestId !== -1 && d2 >= bestD2)) continue;
        const id = this.ids[i]!;
        if (filter !== undefined && !filter(id)) continue;
        bestD2 = d2;
        bestId = id;
      }
      return bestId;
    }

    for (let ring = 0; ring <= maxRing; ring++) {
      const minCx = ccx - ring;
      const maxCx = ccx + ring;
      const minCy = ccy - ring;
      const maxCy = ccy + ring;
      for (let cy = minCy; cy <= maxCy; cy++) {
        const edgeRow = cy === minCy || cy === maxCy;
        // On non-edge rows only the two side cells belong to this ring.
        const step = edgeRow || ring === 0 ? 1 : maxCx - minCx;
        for (let cx = minCx; cx <= maxCx; cx += step) {
          const bucket = this.buckets.get(SpatialHash.key(cx, cy));
          if (bucket === undefined) continue;
          for (let k = 0; k < bucket.length; k++) {
            const i = bucket[k]!;
            if (this.cxs[i] !== cx || this.cys[i] !== cy) continue;
            const dx = this.xs[i]! - x;
            const dy = this.ys[i]! - y;
            const d2 = dx * dx + dy * dy;
            if (d2 > bestD2 || (bestId !== -1 && d2 >= bestD2)) continue;
            const id = this.ids[i]!;
            if (filter !== undefined && !filter(id)) continue;
            bestD2 = d2;
            bestId = id;
          }
        }
      }

      // Minimum possible distance from (x, y) to any cell in ring+1: distance to
      // the boundary of the square covered by rings 0..ring.
      const nextMin = Math.min(
        x - minCx * cs,
        (maxCx + 1) * cs - x,
        y - minCy * cs,
        (maxCy + 1) * cs - y,
      );
      if (nextMin > maxR) break;
      if (bestId !== -1 && bestD2 <= nextMin * nextMin) break;
    }
    return bestId;
  }

  private static key(cx: number, cy: number): number {
    return Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663);
  }

  private grow(): void {
    const cap = this.capacity * 2;
    const ids = new Float64Array(cap);
    const xs = new Float64Array(cap);
    const ys = new Float64Array(cap);
    const cxs = new Float64Array(cap);
    const cys = new Float64Array(cap);
    ids.set(this.ids);
    xs.set(this.xs);
    ys.set(this.ys);
    cxs.set(this.cxs);
    cys.set(this.cys);
    this.ids = ids;
    this.xs = xs;
    this.ys = ys;
    this.cxs = cxs;
    this.cys = cys;
    this.capacity = cap;
  }
}
