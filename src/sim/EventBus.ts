/**
 * Allocation-free gameplay event queue (design "Events").
 *
 * Events carry only numbers: a type code plus up to 4 numeric payload slots.
 * String ids (enemy types, body parts, mutations) are passed as their index in
 * the corresponding config array. Drained once per frame by juice/HUD.
 * On overflow the oldest event is dropped and `overflowCount` increments.
 */
export const EventType = {
  /** a = enemy id, b = damage */
  enemyHit: 1,
  /** a = enemy id, b = x, c = y, d = enemy type index */
  enemyKilled: 2,
  /** a = damage, b = hp after */
  playerHurt: 3,
  /** a = energy value, b = x, c = y */
  orbCollected: 4,
  /** a = new level-up count */
  levelUp: 5,
  /** a = body part index, b = level */
  partGained: 6,
  /** a = body part index, b = new level */
  partLevelled: 7,
  /** a = mutation index */
  mutation: 8,
  /** a = surviving enemy id, b = x, c = y, d = new tier */
  merge: 9,
  /** a = enemy type index */
  behaviourIntroduced: 10,
  /** a = swarm event index, b = seconds until start */
  swarmWarning: 11,
  /** a = boss enemy id */
  bossSpawn: 12,
  /** a = x, b = y */
  bossKilled: 13,
  /** a = x, b = y */
  tokenCollected: 14,
  /** a = 1 victory / 0 defeat */
  runEnded: 15,
} as const;

export type EventTypeName = keyof typeof EventType;
export type EventCode = (typeof EventType)[EventTypeName];

export type EventHandler = (type: EventCode, a: number, b: number, c: number, d: number) => void;

export const EVENT_BUS_CAPACITY = 1024;

export class EventBus {
  readonly capacity: number;
  overflowCount = 0;

  private readonly types: Uint8Array;
  private readonly pa: Float64Array;
  private readonly pb: Float64Array;
  private readonly pc: Float64Array;
  private readonly pd: Float64Array;
  private head = 0; // index of oldest
  private size = 0;

  constructor(capacity = EVENT_BUS_CAPACITY) {
    this.capacity = capacity;
    this.types = new Uint8Array(capacity);
    this.pa = new Float64Array(capacity);
    this.pb = new Float64Array(capacity);
    this.pc = new Float64Array(capacity);
    this.pd = new Float64Array(capacity);
  }

  get count(): number {
    return this.size;
  }

  push(type: EventCode, a = 0, b = 0, c = 0, d = 0): void {
    if (this.size === this.capacity) {
      // Drop oldest.
      this.head = (this.head + 1) % this.capacity;
      this.size--;
      this.overflowCount++;
    }
    const i = (this.head + this.size) % this.capacity;
    this.types[i] = type;
    this.pa[i] = a;
    this.pb[i] = b;
    this.pc[i] = c;
    this.pd[i] = d;
    this.size++;
  }

  /** Calls `handler` for each queued event in push order, then empties the queue. */
  drain(handler: EventHandler): void {
    // Snapshot the count so events pushed by the handler wait for the next drain.
    let n = this.size;
    while (n-- > 0 && this.size > 0) {
      const i = this.head;
      const type = this.types[i] as EventCode;
      const a = this.pa[i];
      const b = this.pb[i];
      const c = this.pc[i];
      const d = this.pd[i];
      this.head = (this.head + 1) % this.capacity;
      this.size--;
      handler(type, a, b, c, d);
    }
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
    this.overflowCount = 0;
  }
}
