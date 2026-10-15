/**
 * Shared presentation-layer constants (task 10). Every scene, renderer and
 * the BootScene texture generator use these names — keep them in sync.
 */

export const SCENE = {
  boot: 'boot',
  title: 'title',
  game: 'game',
  hud: 'hud',
  upgrade: 'upgrade',
  results: 'results',
} as const;

/** Logical canvas size (portrait, Req 1.4). */
export const GAME_WIDTH = 720;
export const GAME_HEIGHT = 1560;

/**
 * Texture keys. BootScene generates every one of these procedurally (pixel
 * art drawn with Graphics + generateTexture), so the game has no binary art
 * dependency. Body part and enemy sprites are looked up via the `sprite` /
 * `icon` fields in src/data, which use these same strings.
 */
export const TEX = {
  // Player and parts (data: bodyParts[].sprite / .icon)
  playerBody: 'player_body',
  partSprite: (partId: string) => `part_${partId}`,
  partIcon: (partId: string) => `icon_${partId}`,
  mutationSprite: (spriteKey: string) => spriteKey, // e.g. 'mutation_beholder'
  // Enemies (data: enemies[].sprite, e.g. 'enemy_shambler')
  enemy: (sprite: string) => sprite,
  // World
  orb: 'orb',
  token: 'token',
  projectilePlayer: 'proj_player',
  projectileEnemy: 'proj_enemy',
  bone: 'bone',
  ground: 'ground_tile',
  particle: 'particle',
  vignette: 'vignette',
  joystickBase: 'joystick_base',
  joystickKnob: 'joystick_knob',
  // UI
  iconHeal: 'icon_fallback_heal',
  iconPause: 'icon_pause',
  panel: 'ui_panel',
} as const;

/** Sound effect keys; AudioManager synthesises them (no audio files needed). */
export const SFX = {
  hurt: 'sfx_hurt',
  levelUp: 'sfx_levelup',
  pickup: 'sfx_pickup',
  merge: 'sfx_merge',
  mutation: 'sfx_mutation',
  kill: 'sfx_kill',
  click: 'sfx_click',
} as const;
export type SfxKey = (typeof SFX)[keyof typeof SFX];

/** Rarity frame colours (Req 10.3). */
export const RARITY_COLOR = { common: 0x9aa4b2, rare: 0x4aa3ff, epic: 0xc86bff } as const;

/** Readability palette (Req 19.3). */
export const PALETTE = {
  night: 0x140f2e,
  dawn: 0xf2c48d,
  orb: 0x3ff0ff,
  enemyProjectile: 0xff3fc8,
  playerRim: 0xfff6a8,
  hp: 0xff4f6a,
  energy: 0x3ff0ff,
  text: '#f4f1ff',
  textDim: '#b8b0d8',
} as const;

/** Font used for all Text objects (system fonts only; nothing to load). */
export const FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';

/** Depth layers (design "Rendering"). */
export const DEPTH = {
  ground: 0,
  decal: 5,
  orb: 10,
  enemy: 20,
  player: 30,
  projectile: 40,
  effect: 50,
  overlay: 60,
} as const;
