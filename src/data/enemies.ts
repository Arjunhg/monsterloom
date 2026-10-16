/** Enemy type definitions (Req 6.3). */

export type BehaviourId = 'chaser' | 'bat' | 'ghost' | 'slime' | 'witch' | 'boss';

export interface EnemyType {
  id: string;
  name: string;
  sprite: string;
  behaviour: BehaviourId;
  hp: number;
  speed: number;
  contactDmg: number;
  radius: number;
  energy: number;
  threatCost: number;
  canMerge: boolean;
  /**
   * Spawned from the separate "special" credit lane (balance.credits.specialRate), on top of the
   * regular horde, so expensive v2 monsters don't thin out shamblers/imps/knights.
   */
  special?: boolean;
  /** Ignores the separation force (ghosts, Req 22.4). Sets ENEMY_FLAG.NO_SEP on spawn. */
  noSeparation?: boolean;
  /** The single dawn boss (Req 24). Never in the stage pool; sets ENEMY_FLAG.BOSS on spawn. */
  boss?: boolean;
  /**
   * Behaviour-specific numbers. Documented per behaviour:
   * - bat:   telegraphSec, chargeMult, groupSize
   * - ghost: wobbleAmp (px/s sideways), wobbleHz
   * - slime: size (spawned size), minSize; each size step scales hp/radius
   * - witch: keepDist, range, fireCooldown, projectileSpeed, projectileDmg
   * - boss:  slamTelegraphSec, slamRadius, slamDmg, summonTelegraphSec, summonCount, attackCooldown
   */
  behaviourParams?: Record<string, number>;
}

export const ENEMIES: EnemyType[] = [
  {
    id: 'shambler',
    name: 'Shambler',
    sprite: 'enemy_shambler',
    behaviour: 'chaser',
    hp: 30,
    speed: 55,
    contactDmg: 8,
    radius: 16,
    energy: 1,
    threatCost: 1,
    canMerge: true,
  },
  {
    id: 'imp',
    name: 'Imp',
    sprite: 'enemy_imp',
    behaviour: 'chaser',
    hp: 10,
    speed: 120,
    contactDmg: 5,
    radius: 11,
    energy: 1,
    threatCost: 1,
    canMerge: true,
  },
  {
    id: 'skull_knight',
    name: 'Skull Knight',
    sprite: 'enemy_skull_knight',
    behaviour: 'chaser',
    hp: 60,
    speed: 80,
    contactDmg: 18,
    radius: 18,
    energy: 3,
    threatCost: 3,
    canMerge: true,
  },
  // ---- v2 ----------------------------------------------------------------
  {
    id: 'bat',
    name: 'Bat Swarm',
    sprite: 'enemy_bat',
    behaviour: 'bat',
    special: true,
    hp: 8,
    speed: 140,
    contactDmg: 6,
    radius: 10,
    energy: 1,
    threatCost: 2,
    // Charging bats fly straight through the crowd; fusing them mid-charge reads badly.
    canMerge: false,
    behaviourParams: { telegraphSec: 0.75, chargeMult: 3, groupSize: 4 },
  },
  {
    id: 'slime',
    name: 'Bog Slime',
    sprite: 'enemy_slime',
    behaviour: 'slime',
    special: true,
    hp: 36,
    speed: 60,
    contactDmg: 7,
    radius: 18,
    energy: 2,
    threatCost: 3,
    // Size already plays the "bigger blob" role; splits and merges together would loop.
    canMerge: false,
    behaviourParams: { size: 3, minSize: 1 },
  },
  {
    id: 'ghost',
    name: 'Wisp Ghost',
    sprite: 'enemy_ghost',
    behaviour: 'ghost',
    special: true,
    hp: 22,
    speed: 95,
    contactDmg: 9,
    radius: 14,
    energy: 2,
    threatCost: 2,
    canMerge: false,
    noSeparation: true,
    behaviourParams: { wobbleAmp: 60, wobbleHz: 1.2 },
  },
  {
    id: 'witch',
    name: 'Hex Witch',
    sprite: 'enemy_witch',
    behaviour: 'witch',
    special: true,
    hp: 40,
    speed: 75,
    contactDmg: 8,
    radius: 15,
    energy: 4,
    threatCost: 5,
    canMerge: true,
    behaviourParams: { keepDist: 300, range: 460, fireCooldown: 2.2, projectileSpeed: 260, projectileDmg: 10 },
  },
  {
    id: 'boss',
    name: 'The Night Mother',
    sprite: 'enemy_boss',
    behaviour: 'boss',
    hp: 2600,
    speed: 70,
    contactDmg: 25,
    radius: 46,
    energy: 40,
    threatCost: 999,
    canMerge: false,
    boss: true,
    behaviourParams: {
      slamTelegraphSec: 0.8,
      slamRadius: 190,
      slamDmg: 28,
      summonTelegraphSec: 0.6,
      summonCount: 8,
      attackCooldown: 3.2,
    },
  },
];
