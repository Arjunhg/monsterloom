/**
 * All mutable run data (design "Data Models → RunState").
 *
 * Entity stores are struct-of-arrays over typed arrays allocated ONCE in
 * createRunState(). resetRunState() returns every slot to its pool and resets
 * fields in place without reallocating (Req 15.3, 16.2).
 */
import { GAME_CONFIG, type GameConfig } from '../data';
import { createRunStreams, newSeed, normalizeSeed, type RunRngStreams } from './rng/SeededRNG';
import { IdPool } from './pool/IdPool';
import { EventBus } from './EventBus';
import { defaultStats, type StatMultipliers } from './StatCaps';

// ---------------------------------------------------------------------------
// Enemy flags
// ---------------------------------------------------------------------------
export const ENEMY_FLAG = {
  ELITE: 1 << 0,
  BOSS: 1 << 1,
  NO_MERGE: 1 << 2,
  NO_SEP: 1 << 3,
} as const;

export const PROJECTILE_SIDE = { PLAYER: 0, ENEMY: 1 } as const;

export const PROJECTILE_CAPACITY = 600;
/** Orb store holds a little more than balance.orbs.max so the cap-merge has headroom. */
export const ORB_CAPACITY = 320;
export const TOKEN_CAPACITY = 16;
/** Seconds of per-second damage samples kept for the debug DPS estimate. */
export const DPS_WINDOW_SEC = 5;

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------
export class EnemyStore {
  readonly pool: IdPool;
  readonly typeId: Uint8Array;
  readonly behaviour: Uint8Array;
  readonly tier: Uint8Array;
  readonly flags: Uint8Array;
  readonly aiState: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly radius: Float32Array;
  readonly hp: Float32Array;
  readonly maxHp: Float32Array;
  readonly speed: Float32Array;
  readonly contactDmg: Float32Array;
  readonly energyValue: Float32Array;
  readonly scale: Float32Array;
  readonly hitFlash: Float32Array;
  readonly aiTimer: Float32Array;
  readonly aiDirX: Float32Array;
  readonly aiDirY: Float32Array;
  readonly mergePartner: Int32Array;
  readonly mergeTimer: Float32Array;

  constructor(readonly capacity: number) {
    this.pool = new IdPool(capacity);
    const u8 = () => new Uint8Array(capacity);
    const f32 = () => new Float32Array(capacity);
    this.typeId = u8();
    this.behaviour = u8();
    this.tier = u8();
    this.flags = u8();
    this.aiState = u8();
    this.x = f32();
    this.y = f32();
    this.prevX = f32();
    this.prevY = f32();
    this.vx = f32();
    this.vy = f32();
    this.radius = f32();
    this.hp = f32();
    this.maxHp = f32();
    this.speed = f32();
    this.contactDmg = f32();
    this.energyValue = f32();
    this.scale = f32();
    this.hitFlash = f32();
    this.aiTimer = f32();
    this.aiDirX = f32();
    this.aiDirY = f32();
    this.mergePartner = new Int32Array(capacity).fill(-1);
    this.mergeTimer = f32();
  }

  get count(): number {
    return this.pool.count;
  }

  /** Allocates a slot with all per-entity fields zeroed (mergePartner −1, scale 1). Returns −1 if full. */
  alloc(): number {
    const id = this.pool.alloc();
    if (id < 0) return -1;
    this.typeId[id] = 0;
    this.behaviour[id] = 0;
    this.tier[id] = 0;
    this.flags[id] = 0;
    this.aiState[id] = 0;
    this.x[id] = this.y[id] = this.prevX[id] = this.prevY[id] = 0;
    this.vx[id] = this.vy[id] = 0;
    this.radius[id] = this.hp[id] = this.maxHp[id] = this.speed[id] = 0;
    this.contactDmg[id] = this.energyValue[id] = 0;
    this.scale[id] = 1;
    this.hitFlash[id] = this.aiTimer[id] = this.aiDirX[id] = this.aiDirY[id] = 0;
    this.mergePartner[id] = -1;
    this.mergeTimer[id] = 0;
    return id;
  }

  free(id: number): boolean {
    return this.pool.free(id);
  }

  isAlive(id: number): boolean {
    return this.pool.isAlive(id);
  }

  reset(): void {
    this.pool.reset();
    this.mergePartner.fill(-1);
  }
}

export class ProjectileStore {
  readonly pool: IdPool;
  readonly side: Uint8Array;
  readonly ability: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly radius: Float32Array;
  readonly damage: Float32Array;
  readonly pierce: Int16Array;
  readonly lifetime: Float32Array;

  constructor(readonly capacity: number) {
    this.pool = new IdPool(capacity);
    const f32 = () => new Float32Array(capacity);
    this.side = new Uint8Array(capacity);
    this.ability = new Uint8Array(capacity);
    this.x = f32();
    this.y = f32();
    this.prevX = f32();
    this.prevY = f32();
    this.vx = f32();
    this.vy = f32();
    this.radius = f32();
    this.damage = f32();
    this.pierce = new Int16Array(capacity);
    this.lifetime = f32();
  }

  get count(): number {
    return this.pool.count;
  }

  alloc(): number {
    const id = this.pool.alloc();
    if (id < 0) return -1;
    this.side[id] = 0;
    this.ability[id] = 0;
    this.x[id] = this.y[id] = this.prevX[id] = this.prevY[id] = 0;
    this.vx[id] = this.vy[id] = 0;
    this.radius[id] = this.damage[id] = this.lifetime[id] = 0;
    this.pierce[id] = 0;
    return id;
  }

  free(id: number): boolean {
    return this.pool.free(id);
  }

  isAlive(id: number): boolean {
    return this.pool.isAlive(id);
  }

  reset(): void {
    this.pool.reset();
  }
}

/**
 * Energy orbs with an age order: `oldest()` returns the longest-lived alive orb
 * in O(1) amortized (Req 7.5). Implemented as a ring of (id, spawnSeq) entries;
 * stale entries (freed orbs) are skipped lazily and the ring is compacted when full.
 */
export class OrbStore {
  readonly pool: IdPool;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly value: Float32Array;
  /** Spawn sequence number of the orb currently in each slot. */
  private readonly seq: Float64Array;
  private nextSeq = 1;

  private readonly ringIds: Int32Array;
  private readonly ringSeq: Float64Array;
  private ringHead = 0;
  private ringSize = 0;

  constructor(readonly capacity: number) {
    this.pool = new IdPool(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.value = new Float32Array(capacity);
    this.seq = new Float64Array(capacity);
    const ringCap = capacity * 4;
    this.ringIds = new Int32Array(ringCap);
    this.ringSeq = new Float64Array(ringCap);
  }

  get count(): number {
    return this.pool.count;
  }

  alloc(): number {
    const id = this.pool.alloc();
    if (id < 0) return -1;
    this.x[id] = this.y[id] = this.value[id] = 0;
    const s = this.nextSeq++;
    this.seq[id] = s;
    if (this.ringSize === this.ringIds.length) this.compact();
    const i = (this.ringHead + this.ringSize) % this.ringIds.length;
    this.ringIds[i] = id;
    this.ringSeq[i] = s;
    this.ringSize++;
    return id;
  }

  free(id: number): boolean {
    if (!this.pool.free(id)) return false;
    this.seq[id] = 0;
    return true;
  }

  isAlive(id: number): boolean {
    return this.pool.isAlive(id);
  }

  /** Id of the oldest alive orb, or −1 if none. */
  oldest(): number {
    const cap = this.ringIds.length;
    while (this.ringSize > 0) {
      const id = this.ringIds[this.ringHead];
      if (this.pool.isAlive(id) && this.seq[id] === this.ringSeq[this.ringHead]) return id;
      this.ringHead = (this.ringHead + 1) % cap;
      this.ringSize--;
    }
    return -1;
  }

  reset(): void {
    this.pool.reset();
    this.seq.fill(0);
    this.ringHead = 0;
    this.ringSize = 0;
    this.nextSeq = 1;
  }

  /** Drops stale ring entries in place, keeping age order. Rare; O(ring size). */
  private compact(): void {
    const cap = this.ringIds.length;
    let w = 0;
    for (let r = 0; r < this.ringSize; r++) {
      const i = (this.ringHead + r) % cap;
      const id = this.ringIds[i];
      if (this.pool.isAlive(id) && this.seq[id] === this.ringSeq[i]) {
        // Write position w (relative to head) is always ≤ r, so no live entry is overwritten before it is read.
        const wi = (this.ringHead + w) % cap;
        this.ringIds[wi] = id;
        this.ringSeq[wi] = this.ringSeq[i];
        w++;
      }
    }
    this.ringSize = w;
  }
}

export class TokenStore {
  readonly pool: IdPool;
  readonly x: Float32Array;
  readonly y: Float32Array;

  constructor(readonly capacity: number) {
    this.pool = new IdPool(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
  }

  get count(): number {
    return this.pool.count;
  }

  alloc(): number {
    const id = this.pool.alloc();
    if (id >= 0) this.x[id] = this.y[id] = 0;
    return id;
  }

  free(id: number): boolean {
    return this.pool.free(id);
  }

  isAlive(id: number): boolean {
    return this.pool.isAlive(id);
  }

  reset(): void {
    this.pool.reset();
  }
}

// ---------------------------------------------------------------------------
// RunState
// ---------------------------------------------------------------------------
export type RunMode = 'normal' | 'daily' | 'challenge';
export type PauseKind = false | 'menu' | 'user' | 'auto';
export type RunOutcome = null | 'victory' | 'defeat';

export interface PlayerState {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  /** Base move speed (px/s) before the moveSpeed multiplier. */
  speed: number;
  /** Seconds of invulnerability remaining. */
  invuln: number;
  lastDirX: number;
  lastDirY: number;
  /** Base pickup radius (px) before the pickupRadius multiplier. */
  pickupRadius: number;
  stats: StatMultipliers;
}

export interface OwnedPart {
  level: number;
  /** True once consumed by a mutation: ability stays active, sprite hidden. */
  merged: boolean;
}

export interface RunState {
  readonly config: GameConfig;
  seed: number;
  rng: RunRngStreams;
  mode: RunMode;
  paused: PauseKind;
  clock: { elapsed: number; duration: number; bossSpawned: boolean };
  outcome: RunOutcome;
  player: PlayerState;
  readonly enemies: EnemyStore;
  readonly projectiles: ProjectileStore;
  readonly orbs: OrbStore;
  readonly tokens: TokenStore;
  energy: { value: number; levelUps: number; pendingLevelUps: number; pendingTokens: number };
  build: {
    parts: Map<string, OwnedPart>;
    mutations: Set<string>;
    banned: Set<string>;
    rerolls: number;
    bans: number;
  };
  director: {
    credits: number;
    quadrantBag: number[];
    stageIdx: number;
    introduced: Set<string>;
    swarmIdx: number;
  };
  stats: { kills: number; damageDealt: number; dpsWindow: Float32Array };
  readonly events: EventBus;
}

/** Id of the config's starter body part (Req 4.4). Throws if the config has none. */
export function starterPartId(config: GameConfig): string {
  const starter = config.bodyParts.find((p) => p.starter);
  if (!starter) throw new Error('GameConfig has no starter body part');
  return starter.id;
}

/**
 * Creates a fresh RunState. All typed-array stores are allocated here once.
 * When `seed` is undefined a new seed is generated and recorded (Req 17.3).
 */
export function createRunState(seed?: number, config: GameConfig = GAME_CONFIG): RunState {
  const s = seed === undefined ? newSeed() : normalizeSeed(seed);
  const b = config.balance;
  const state: RunState = {
    config,
    seed: s,
    rng: createRunStreams(s),
    mode: 'normal',
    paused: false,
    clock: { elapsed: 0, duration: b.run.durationSec, bossSpawned: false },
    outcome: null,
    player: {
      x: 0,
      y: 0,
      prevX: 0,
      prevY: 0,
      vx: 0,
      vy: 0,
      radius: b.player.radius,
      hp: b.player.hp,
      maxHp: b.player.hp,
      speed: b.player.speed,
      invuln: 0,
      lastDirX: 1,
      lastDirY: 0,
      pickupRadius: b.player.pickupRadius,
      stats: defaultStats(),
    },
    enemies: new EnemyStore(b.spawn.maxActive + 1), // +1 boss slot
    projectiles: new ProjectileStore(PROJECTILE_CAPACITY),
    orbs: new OrbStore(Math.max(ORB_CAPACITY, b.orbs.max + 1)),
    tokens: new TokenStore(TOKEN_CAPACITY),
    energy: { value: 0, levelUps: 0, pendingLevelUps: 0, pendingTokens: 0 },
    build: {
      parts: new Map([[starterPartId(config), { level: 1, merged: false }]]),
      mutations: new Set(),
      banned: new Set(),
      rerolls: b.menu.rerolls,
      bans: b.menu.bans,
    },
    director: { credits: 0, quadrantBag: [], stageIdx: 0, introduced: new Set(), swarmIdx: 0 },
    stats: { kills: 0, damageDealt: 0, dpsWindow: new Float32Array(DPS_WINDOW_SEC) },
    events: new EventBus(),
  };
  return state;
}

/**
 * Resets `state` in place for a new run (Req 15.2, 15.3): frees every pooled
 * slot and restores initial values without reallocating typed arrays.
 * When `seed` is undefined a new seed is generated and recorded.
 */
export function resetRunState(state: RunState, seed?: number): void {
  const s = seed === undefined ? newSeed() : normalizeSeed(seed);
  const b = state.config.balance;

  state.seed = s;
  state.rng = createRunStreams(s);
  state.mode = 'normal';
  state.paused = false;
  state.clock.elapsed = 0;
  state.clock.duration = b.run.durationSec;
  state.clock.bossSpawned = false;
  state.outcome = null;

  const p = state.player;
  p.x = p.y = p.prevX = p.prevY = p.vx = p.vy = 0;
  p.radius = b.player.radius;
  p.hp = p.maxHp = b.player.hp;
  p.speed = b.player.speed;
  p.invuln = 0;
  p.lastDirX = 1;
  p.lastDirY = 0;
  p.pickupRadius = b.player.pickupRadius;
  Object.assign(p.stats, defaultStats());

  state.enemies.reset();
  state.projectiles.reset();
  state.orbs.reset();
  state.tokens.reset();

  state.energy.value = 0;
  state.energy.levelUps = 0;
  state.energy.pendingLevelUps = 0;
  state.energy.pendingTokens = 0;

  state.build.parts.clear();
  state.build.parts.set(starterPartId(state.config), { level: 1, merged: false });
  state.build.mutations.clear();
  state.build.banned.clear();
  state.build.rerolls = b.menu.rerolls;
  state.build.bans = b.menu.bans;

  state.director.credits = 0;
  state.director.quadrantBag.length = 0;
  state.director.stageIdx = 0;
  state.director.introduced.clear();
  state.director.swarmIdx = 0;

  state.stats.kills = 0;
  state.stats.damageDealt = 0;
  state.stats.dpsWindow.fill(0);

  state.events.clear();
}
