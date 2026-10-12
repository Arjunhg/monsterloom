/**
 * Fixed-capacity id allocator for struct-of-arrays stores (Req 16.2).
 *
 * - Free ids are kept on an Int32Array stack, so alloc/free never allocate.
 * - Alive ids are also kept in a dense list (swap-remove + index map) so
 *   systems can iterate active slots without scanning the whole capacity.
 *   Iteration order is NOT stable across frees.
 */
export class IdPool {
  readonly capacity: number;
  /** Dense list of alive ids; valid entries are [0, count). */
  readonly activeIds: Int32Array;

  private readonly freeStack: Int32Array;
  private freeTop = 0;
  /** Position of each id in `activeIds`, or −1 if free. */
  private readonly indexOf: Int32Array;
  private activeCount = 0;

  constructor(capacity: number) {
    if (!(capacity > 0) || !Number.isInteger(capacity)) {
      throw new RangeError(`IdPool capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.activeIds = new Int32Array(capacity);
    this.freeStack = new Int32Array(capacity);
    this.indexOf = new Int32Array(capacity);
    this.reset();
  }

  /** Number of alive ids. */
  get count(): number {
    return this.activeCount;
  }

  /** Returns a free id, or −1 when exhausted. Lowest ids are handed out first after reset. */
  alloc(): number {
    if (this.freeTop === 0) return -1;
    const id = this.freeStack[--this.freeTop];
    this.indexOf[id] = this.activeCount;
    this.activeIds[this.activeCount++] = id;
    return id;
  }

  /** Frees an alive id. Returns false (and does nothing) for free or out-of-range ids. */
  free(id: number): boolean {
    if (!this.isAlive(id)) return false;
    const idx = this.indexOf[id];
    const lastIdx = --this.activeCount;
    const lastId = this.activeIds[lastIdx];
    this.activeIds[idx] = lastId;
    this.indexOf[lastId] = idx;
    this.indexOf[id] = -1;
    this.freeStack[this.freeTop++] = id;
    return true;
  }

  isAlive(id: number): boolean {
    return id >= 0 && id < this.capacity && Number.isInteger(id) && this.indexOf[id] !== -1;
  }

  /** Frees every id. Does not reallocate. */
  reset(): void {
    const cap = this.capacity;
    // Push in reverse so alloc() returns 0, 1, 2, ... after a reset.
    for (let i = 0; i < cap; i++) this.freeStack[i] = cap - 1 - i;
    this.freeTop = cap;
    this.indexOf.fill(-1);
    this.activeCount = 0;
  }

  /**
   * Calls `cb` for each alive id. Iterates a snapshot length from the end so
   * the callback may safely free the current id.
   */
  forEachAlive(cb: (id: number) => void): void {
    for (let i = this.activeCount - 1; i >= 0; i--) {
      if (i < this.activeCount) cb(this.activeIds[i]);
    }
  }
}
