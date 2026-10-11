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
];
