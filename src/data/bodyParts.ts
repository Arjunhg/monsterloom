/** Body_Part definitions and per-level ability parameters (Req 11, design "Abilities and v1 content"). */

export type AbilityKind = 'projectile' | 'piercing' | 'grab' | 'dash' | 'orbital' | 'aoe';

export const ABILITY_KINDS: readonly AbilityKind[] = [
  'projectile',
  'piercing',
  'grab',
  'dash',
  'orbital',
  'aoe',
];

export type Rarity = 'common' | 'rare' | 'epic';

/** Sprite attachment point relative to the player body. */
export interface Anchor {
  x: number;
  y: number;
  rotation: number;
  depth: number;
}

/**
 * Per-level ability parameters. `damage` is the only damage field; every other field
 * is a non-damage parameter (Req 11.3: each level must change at least one of those).
 */
export interface AbilityParams {
  damage: number;
  /** seconds between activations */
  cooldown?: number;
  /** projectiles / eyes / bones / grabs per activation */
  count?: number;
  /** enemies pierced per projectile */
  pierce?: number;
  /** effect / orbit / impact radius (px) */
  radius?: number;
  /** targeting or grab range (px) */
  range?: number;
  /** effect duration (s) */
  duration?: number;
  /** movement slow fraction 0..1 */
  slow?: number;
  /** projectile / orbit speed */
  speed?: number;
  /** fan spread (degrees) */
  spread?: number;
  /** dash distance (px) */
  distance?: number;
  /** 1 when a lingering trail / puddle is left behind */
  lingering?: number;
}

export const NON_DAMAGE_FIELDS: readonly (keyof AbilityParams)[] = [
  'cooldown',
  'count',
  'pierce',
  'radius',
  'range',
  'duration',
  'slow',
  'speed',
  'spread',
  'distance',
  'lingering',
];

export interface BodyPartDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  sprite: string;
  anchors: Anchor[];
  ability: AbilityKind;
  maxLevel: 5;
  /** Starter parts are equipped at run start and never offered in the upgrade pool (Req 4.4). */
  starter?: boolean;
  rarities: Rarity[];
  /** levels[i] = params at Part_Level i + 1 */
  levels: AbilityParams[];
  /** Extra side-grade applied by a Rare level-up. */
  rareBonus?: Partial<AbilityParams>;
}

const ALL_RARITIES: Rarity[] = ['common', 'rare', 'epic'];

export const BODY_PARTS: BodyPartDef[] = [
  {
    id: 'blob_spit',
    name: 'Blob Spit',
    description: 'Spits an auto-aimed glob at the nearest enemy.',
    icon: 'icon_blob_spit',
    sprite: 'part_blob_spit',
    anchors: [{ x: 0, y: -4, rotation: 0, depth: 1 }],
    ability: 'projectile',
    maxLevel: 5,
    starter: true,
    rarities: ALL_RARITIES,
    levels: [
      { damage: 10, cooldown: 1.0, count: 1, speed: 360, range: 420 },
      { damage: 11, cooldown: 0.9, count: 1, speed: 360, range: 420 },
      { damage: 12, cooldown: 0.85, count: 2, speed: 360, range: 420 },
      { damage: 13, cooldown: 0.75, count: 2, speed: 380, range: 420 },
      { damage: 14, cooldown: 0.7, count: 3, speed: 380, range: 420 },
    ],
    rareBonus: { count: 1 },
  },
  {
    id: 'extra_eye',
    name: 'Extra Eye',
    description: 'Each eye fires its own homing bolt.',
    icon: 'icon_extra_eye',
    sprite: 'part_extra_eye',
    anchors: [
      { x: -10, y: -14, rotation: 0, depth: 2 },
      { x: 10, y: -14, rotation: 0, depth: 2 },
      { x: 0, y: -20, rotation: 0, depth: 2 },
    ],
    ability: 'projectile',
    maxLevel: 5,
    rarities: ALL_RARITIES,
    levels: [
      { damage: 8, cooldown: 1.4, count: 1, speed: 300, range: 380 },
      { damage: 8, cooldown: 1.4, count: 2, speed: 300, range: 380 },
      { damage: 9, cooldown: 1.3, count: 3, speed: 300, range: 380 },
      { damage: 9, cooldown: 1.3, count: 4, speed: 320, range: 400 },
      { damage: 10, cooldown: 1.2, count: 5, speed: 320, range: 400 },
    ],
    rareBonus: { count: 1 },
  },
  {
    id: 'fangs',
    name: 'Fangs',
    description: 'Fires a narrow fan of fang darts that pierce enemies.',
    icon: 'icon_fangs',
    sprite: 'part_fangs',
    anchors: [{ x: 0, y: 6, rotation: 0, depth: 2 }],
    ability: 'piercing',
    maxLevel: 5,
    rarities: ALL_RARITIES,
    levels: [
      { damage: 9, cooldown: 1.2, count: 3, pierce: 1, spread: 20, speed: 420 },
      { damage: 10, cooldown: 1.2, count: 3, pierce: 2, spread: 24, speed: 420 },
      { damage: 10, cooldown: 1.1, count: 3, pierce: 3, spread: 28, speed: 440 },
      { damage: 11, cooldown: 1.1, count: 4, pierce: 4, spread: 32, speed: 440 },
      { damage: 12, cooldown: 1.0, count: 4, pierce: 5, spread: 36, speed: 460 },
    ],
    rareBonus: { pierce: 1 },
  },
  {
    id: 'tentacle',
    name: 'Tentacle',
    description: 'Grabs a nearby enemy and hurls it, splashing damage on impact.',
    icon: 'icon_tentacle',
    sprite: 'part_tentacle',
    anchors: [{ x: 14, y: 4, rotation: 0.4, depth: 0 }],
    ability: 'grab',
    maxLevel: 5,
    rarities: ALL_RARITIES,
    levels: [
      { damage: 14, cooldown: 2.4, count: 1, range: 140, radius: 50 },
      { damage: 15, cooldown: 2.4, count: 1, range: 170, radius: 55 },
      { damage: 16, cooldown: 2.2, count: 1, range: 200, radius: 60 },
      { damage: 17, cooldown: 2.2, count: 2, range: 220, radius: 65 },
      { damage: 18, cooldown: 2.0, count: 2, range: 250, radius: 75 },
    ],
    rareBonus: { radius: 15 },
  },
  {
    id: 'bat_wings',
    name: 'Bat Wings',
    description: 'While moving, dash forward with i-frames, hurting enemies in your path.',
    icon: 'icon_bat_wings',
    sprite: 'part_bat_wings',
    anchors: [
      { x: -16, y: -6, rotation: -0.3, depth: -1 },
      { x: 16, y: -6, rotation: 0.3, depth: -1 },
    ],
    ability: 'dash',
    maxLevel: 5,
    rarities: ALL_RARITIES,
    levels: [
      { damage: 12, cooldown: 4.0, distance: 120, duration: 0.2, lingering: 0 },
      { damage: 13, cooldown: 3.6, distance: 135, duration: 0.2, lingering: 0 },
      { damage: 14, cooldown: 3.2, distance: 150, duration: 0.22, lingering: 0 },
      { damage: 15, cooldown: 2.8, distance: 165, duration: 0.24, lingering: 0 },
      { damage: 16, cooldown: 2.5, distance: 180, duration: 0.25, lingering: 1 },
    ],
    rareBonus: { distance: 20 },
  },
  {
    id: 'ribcage',
    name: 'Ribcage',
    description: 'Bones orbit your body, smacking enemies they touch.',
    icon: 'icon_ribcage',
    sprite: 'part_ribcage',
    anchors: [{ x: 0, y: 2, rotation: 0, depth: 1 }],
    ability: 'orbital',
    maxLevel: 5,
    rarities: ALL_RARITIES,
    levels: [
      { damage: 7, count: 2, radius: 60, speed: 2.5 },
      { damage: 7, count: 3, radius: 66, speed: 2.5 },
      { damage: 8, count: 4, radius: 72, speed: 2.7 },
      { damage: 8, count: 5, radius: 78, speed: 2.7 },
      { damage: 9, count: 6, radius: 86, speed: 3.0 },
    ],
    rareBonus: { count: 1 },
  },
  {
    id: 'swamp_gut',
    name: 'Swamp Gut',
    description: 'Periodically burps a toxic pulse that damages and slows enemies.',
    icon: 'icon_swamp_gut',
    sprite: 'part_swamp_gut',
    anchors: [{ x: 0, y: 10, rotation: 0, depth: 1 }],
    ability: 'aoe',
    maxLevel: 5,
    rarities: ALL_RARITIES,
    levels: [
      { damage: 6, cooldown: 3.0, radius: 90, slow: 0.2, duration: 1.0, lingering: 0 },
      { damage: 7, cooldown: 3.0, radius: 105, slow: 0.25, duration: 1.0, lingering: 0 },
      { damage: 7, cooldown: 2.8, radius: 120, slow: 0.3, duration: 1.2, lingering: 0 },
      { damage: 8, cooldown: 2.8, radius: 135, slow: 0.35, duration: 1.2, lingering: 1 },
      { damage: 9, cooldown: 2.6, radius: 150, slow: 0.4, duration: 1.5, lingering: 1 },
    ],
    rareBonus: { radius: 15 },
  },
];
