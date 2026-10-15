/**
 * Procedural pixel-art texture generator (task 10.1, design "Rendering").
 *
 * Every texture the game uses is drawn here with Phaser Graphics and baked
 * with generateTexture, so there is no binary art dependency. Sprites are
 * authored as small character grids ("pixel maps") and drawn as chunky
 * rects at 2–5 px per art pixel.
 *
 * Key naming: body part / enemy / mutation keys come straight from the data
 * strings (bodyParts[].sprite / .icon, enemies[].sprite, mutations[].spriteKey).
 * They currently equal TEX.partSprite(id) / TEX.partIcon(id) / TEX.enemy(sprite);
 * if they ever differ, the DATA strings win (that is what the renderers look up).
 */
import Phaser from 'phaser';
import { GAME_CONFIG } from '../data';
import { PALETTE, TEX } from '../game/keys';

type Grid = readonly string[];
type Pal = Readonly<Record<string, number>>;

/** Outline colour used around enemies (1 px dark). */
const OUTLINE = 0x0b0716;

// ---------------------------------------------------------------------------
// Pixel maps
// ---------------------------------------------------------------------------

const PLAYER_GRID: Grid = [
  '....GGGG....',
  '..GGGGGGGG..',
  '.GLLGGGGGGG.',
  '.GLGGGGGGGG.',
  'GGWWGGGGWWGG',
  'GGWKGGGGWKGG',
  'GGGGGGGGGGGG',
  'PPGGGMMGGGPP',
  'PPPPGGGGPPPP',
  'PPPPPPPPPPPP',
  '.PPPPPPPPPP.',
  '..PP.PP.PP..',
];
const PLAYER_PAL: Pal = {
  G: 0x6fdc5a,
  L: 0xc8ff9e,
  P: 0x8a4fd8,
  W: 0xffffff,
  K: 0x1a1030,
  M: 0x3a1450,
};

/** 8×8 part sprites, keyed by body part id. */
const PART_GRIDS: Record<string, { grid: Grid; pal: Pal }> = {
  blob_spit: {
    grid: ['...GG...', '..GGGG..', '.GGLGGG.', '.GLGGGG.', 'GGGGGGGG', 'GGGGGDGG', '.GGGDGG.', '..GGGG..'],
    pal: { G: 0x7dff5a, L: 0xe6ffcc, D: 0x3d9a2a },
  },
  extra_eye: {
    grid: ['..WWWW..', '.WWWWWW.', 'WWBBBBWW', 'WBBKHBBW', 'WBBKKBBW', 'WWBBBBWW', '.WWWWWW.', '..WWWW..'],
    pal: { W: 0xf4f1ff, B: 0x3fa0ff, K: 0x120a24, H: 0xffffff },
  },
  fangs: {
    grid: ['RRRRRRRR', 'RWWRRWWR', '.WW..WW.', '.WW..WW.', '..W..W..', '..W..W..', '........', '........'],
    pal: { R: 0xc0304a, W: 0xfffbe8 },
  },
  tentacle: {
    grid: ['......PP', '.....PPL', '....PPP.', '...PPP..', '..PPP...', '.PPP..P.', '.PP..PP.', '..PPPP..'],
    pal: { P: 0xb45ad8, L: 0xf0b8ff },
  },
  bat_wings: {
    grid: ['D.......', 'DD....D.', 'DDD..DD.', 'DMDDDDD.', 'DMMDDMDD', 'DMMMMMDD', 'DD.D.D.D', 'D.......'],
    pal: { D: 0x3b2160, M: 0x7a4fb0 },
  },
  ribcage: {
    grid: ['...BB...', 'BBBBBBBB', 'B..BB..B', 'BBBBBBBB', 'B..BB..B', 'BBBBBBBB', '.B.BB.B.', '...BB...'],
    pal: { B: 0xf2ead2 },
  },
  swamp_gut: {
    grid: ['..SSSS..', '.SSLSSS.', 'SSSSSBSS', 'SBSSSSSS', 'SSSSBSSS', 'SSBSSSSS', '.SSSSSS.', '..SSSS..'],
    pal: { S: 0x6f8f2a, L: 0xc9e86a, B: 0xa8d84a },
  },
};

/** Fallback for part ids added to data without a hand-made grid. */
const GENERIC_PART = {
  grid: ['..XXXX..', '.XXXXXX.', 'XXLXXXXX', 'XLXXXXXX', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..'] as Grid,
  pal: { X: 0x9a7cff, L: 0xe0d6ff } as Pal,
};

const MUTATION_GRIDS: Record<string, { grid: Grid; pal: Pal }> = {
  mutation_beholder: {
    grid: [
      '..PPPPPPPP..',
      '.PPWWWWWWPP.',
      'PPWWWWWWWWPP',
      'PWWWRRRRWWWP',
      'PWWRRKKRRWWP',
      'PWWRKHKKRWWP',
      'PWWRKKKKRWWP',
      'PWWWRRRRWWWP',
      '.PPWWWWWWPP.',
      '..PPPPPPPP..',
      '...P.PP.P...',
      '..PP.P..PP..',
    ],
    pal: { P: 0xb45ad8, W: 0xf4f1ff, R: 0xff4f6a, K: 0x120a24, H: 0xffffff },
  },
};

const ENEMY_GRIDS: Record<string, { grid: Grid; pal: Pal; px: number }> = {
  // Green zombie, arms out.
  enemy_shambler: {
    px: 4,
    grid: [
      '...GGGG...',
      '..GGGGGG..',
      '..GRGGRG..',
      '..GGGGGG..',
      '...GDDG...',
      'GGBBBBBBGG',
      '..BBBBBB..',
      '..BBDBBB..',
      '..BB..BB..',
      '..GG..GG..',
    ],
    pal: { G: 0x7fbf5a, R: 0xff3b3b, D: 0x2e4a22, B: 0x5a4a7a },
  },
  // Small red devil with horns.
  enemy_imp: {
    px: 3,
    grid: [
      'Y......Y',
      'RY....YR',
      '.RRRRRR.',
      '.RWRRWR.',
      '.RRRRRR.',
      '..RKKR..',
      '.RRRRRR.',
      '.R.RR.RT',
    ],
    pal: { R: 0xe8323c, Y: 0xffd23f, W: 0xfff6a8, K: 0x3a0a10, T: 0xa01c28 },
  },
  // Bone-white skull with steel armour.
  enemy_skull_knight: {
    px: 4,
    grid: [
      '...WWWW...',
      '..WWWWWW..',
      '.WWWWWWWW.',
      '.WKKWWKKW.',
      '.WKRWWKRW.',
      '..WWKKWW..',
      '..WKWKWK..',
      'AAAAAAAAAA',
      'AASAAAASAA',
      '.AAAHHAAA.',
      '.AA....AA.',
      '.AA....AA.',
    ],
    pal: { W: 0xefe9d8, K: 0x1a1426, R: 0xff3fc8, A: 0x7d8aa6, S: 0xc9d3e8, H: 0xd9a63a },
  },
};

const GENERIC_ENEMY = {
  px: 4,
  grid: ['..XXXX..', '.XXXXXX.', 'XXWXXWXX', 'XXXXXXXX', 'XXKKKKXX', '.XXXXXX.', '.X.XX.X.', '........'] as Grid,
  pal: { X: 0xa04fd8, W: 0xffffff, K: 0x1a1030 } as Pal,
};

const TOKEN_GRID: Grid = ['..YYYY..', '.YYLLYY.', 'YYLYYYYY', 'YLYYDYYY', 'YYYDDYYY', 'YYYYDYYY', '.YYYYYY.', '..YYYY..'];
const TOKEN_PAL: Pal = { Y: 0xffc83d, L: 0xfff2a8, D: 0xb07a12 };

const PROJ_PLAYER_GRID: Grid = ['.GGGG.', 'GGLLGG', 'GLGGGG', 'GGGGGG', 'GGGGDG', '.GGGG.'];
const PROJ_PLAYER_PAL: Pal = { G: 0x7dff5a, L: 0xeaffd8, D: 0x3d9a2a };

const PROJ_ENEMY_GRID: Grid = ['.MMMM.', 'MMLMMM', 'MMKKMM', 'MMKKMM', 'MMMMMM', '.MMMM.'];
const PROJ_ENEMY_PAL: Pal = { M: PALETTE.enemyProjectile, L: 0xffc0ee, K: 0x2a0626 };

const BONE_GRID: Grid = ['BB....BB', 'BBBBBBBB', 'BBBBBBBB', 'BB....BB'];
const BONE_PAL: Pal = { B: 0xf2ead2 };

const HEART_GRID: Grid = ['.RR..RR.', 'RRLRRRRR', 'RLRRRRRR', 'RRRRRRRR', '.RRRRRR.', '..RRRR..', '...RR...', '........'];
const HEART_PAL: Pal = { R: PALETTE.hp, L: 0xffc2cc };

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function gridSize(grid: Grid): { w: number; h: number } {
  return { w: grid.reduce((m, r) => Math.max(m, r.length), 0), h: grid.length };
}

/** Draws filled cells of a pixel map; '.' and unknown chars are transparent. */
function drawGrid(g: Phaser.GameObjects.Graphics, grid: Grid, pal: Pal, px: number, ox: number, oy: number): void {
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y] ?? '';
    for (let x = 0; x < row.length; x++) {
      const c = pal[row.charAt(x)];
      if (c === undefined) continue;
      g.fillStyle(c, 1);
      g.fillRect(ox + x * px, oy + y * px, px, px);
    }
  }
}

/** Draws the silhouette of a pixel map in one colour, offset by `d` in 8 directions (outline / rim). */
function drawSilhouette(
  g: Phaser.GameObjects.Graphics,
  grid: Grid,
  pal: Pal,
  px: number,
  ox: number,
  oy: number,
  color: number,
  d: number,
): void {
  g.fillStyle(color, 1);
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y] ?? '';
    for (let x = 0; x < row.length; x++) {
      if (pal[row.charAt(x)] === undefined) continue;
      g.fillRect(ox + x * px - d, oy + y * px - d, px + 2 * d, px + 2 * d);
    }
  }
}

function bake(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (g: Phaser.GameObjects.Graphics) => void,
  out: string[],
): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
  out.push(key);
}

/** Bakes a pixel map, optionally with a 1-px outline (pad 1) or a rim (pad = rim width). */
function bakeGrid(
  scene: Phaser.Scene,
  key: string,
  grid: Grid,
  pal: Pal,
  px: number,
  out: string[],
  edge?: { color: number; width: number },
): void {
  const { w, h } = gridSize(grid);
  const pad = edge ? edge.width : 0;
  bake(
    scene,
    key,
    w * px + pad * 2,
    h * px + pad * 2,
    (g) => {
      if (edge) drawSilhouette(g, grid, pal, px, pad, pad, edge.color, edge.width);
      drawGrid(g, grid, pal, px, pad, pad);
    },
    out,
  );
}

/** Deterministic tiny PRNG so the ground tile is identical every boot. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates every game texture. Returns the list of keys created.
 * Throws if Phaser fails to bake a texture (BootScene catches and falls back).
 */
export function generateTextures(scene: Phaser.Scene): string[] {
  const out: string[] = [];

  // Player body: purple-green blob with a bright rim (Req 19.3).
  bakeGrid(scene, TEX.playerBody, PLAYER_GRID, PLAYER_PAL, 4, out, { color: PALETTE.playerRim, width: 2 });

  // Body parts: sprite (3 px/pixel, dark 1 px outline) + icon (dark rounded tile, 4 px/pixel).
  for (const part of GAME_CONFIG.bodyParts) {
    const art = PART_GRIDS[part.id] ?? GENERIC_PART;
    bakeGrid(scene, part.sprite, art.grid, art.pal, 3, out, { color: OUTLINE, width: 1 });
    bakeIcon(scene, part.icon, art.grid, art.pal, out);
  }

  // Mutations.
  for (const m of GAME_CONFIG.mutations) {
    const art = MUTATION_GRIDS[m.spriteKey] ?? { grid: GENERIC_PART.grid, pal: GENERIC_PART.pal };
    const px = art.grid.length >= 12 ? 4 : 6;
    bakeGrid(scene, m.spriteKey, art.grid, art.pal, px, out, { color: OUTLINE, width: 1 });
  }

  // Enemies: distinct silhouettes with 1 px dark outline.
  for (const e of GAME_CONFIG.enemies) {
    const art = ENEMY_GRIDS[e.sprite] ?? GENERIC_ENEMY;
    bakeGrid(scene, e.sprite, art.grid, art.pal, art.px, out, { color: OUTLINE, width: 1 });
  }

  // Energy orb: cyan glowing dot, 14 px.
  bake(
    scene,
    TEX.orb,
    14,
    14,
    (g) => {
      g.fillStyle(PALETTE.orb, 0.25);
      g.fillCircle(7, 7, 7);
      g.fillStyle(PALETTE.orb, 0.55);
      g.fillCircle(7, 7, 5);
      g.fillStyle(PALETTE.orb, 1);
      g.fillRect(4, 4, 6, 6);
      g.fillStyle(0xffffff, 1);
      g.fillRect(5, 5, 2, 2);
    },
    out,
  );

  bakeGrid(scene, TEX.token, TOKEN_GRID, TOKEN_PAL, 2, out, { color: OUTLINE, width: 1 });
  bakeGrid(scene, TEX.projectilePlayer, PROJ_PLAYER_GRID, PROJ_PLAYER_PAL, 2, out);
  bakeGrid(scene, TEX.projectileEnemy, PROJ_ENEMY_GRID, PROJ_ENEMY_PAL, 3, out, { color: OUTLINE, width: 1 });
  bakeGrid(scene, TEX.bone, BONE_GRID, BONE_PAL, 3, out, { color: OUTLINE, width: 1 });

  // Ground: 64×64 tileable dark graveyard grass with speckles.
  bake(
    scene,
    TEX.ground,
    64,
    64,
    (g) => {
      g.fillStyle(0x1d1838, 1);
      g.fillRect(0, 0, 64, 64);
      const rnd = lcg(1337);
      const speckles = [0x262046, 0x2a2350, 0x17132e, 0x24344a];
      for (let i = 0; i < 70; i++) {
        const c = speckles[Math.floor(rnd() * speckles.length)] ?? 0x262046;
        g.fillStyle(c, 1);
        // Snap to 2 px grid; staying inside 0..62 keeps the tile seamless.
        g.fillRect(Math.floor(rnd() * 32) * 2, Math.floor(rnd() * 32) * 2, 2, 2);
      }
      // A few grass tufts.
      g.fillStyle(0x2f4a3a, 1);
      for (let i = 0; i < 6; i++) {
        const x = 4 + Math.floor(rnd() * 28) * 2;
        const y = 4 + Math.floor(rnd() * 26) * 2;
        g.fillRect(x, y, 2, 4);
        g.fillRect(x - 2, y + 2, 2, 2);
        g.fillRect(x + 2, y + 1, 2, 3);
      }
    },
    out,
  );

  bake(
    scene,
    TEX.particle,
    4,
    4,
    (g) => {
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 4, 4);
    },
    out,
  );

  // Vignette: 256×256 radial dark edges (canvas gradient; Graphics has no radial fill).
  bakeVignette(scene, out);

  // Virtual joystick.
  bake(
    scene,
    TEX.joystickBase,
    160,
    160,
    (g) => {
      g.fillStyle(0xffffff, 0.12);
      g.fillCircle(80, 80, 78);
      g.lineStyle(4, 0xffffff, 0.45);
      g.strokeCircle(80, 80, 76);
    },
    out,
  );
  bake(
    scene,
    TEX.joystickKnob,
    72,
    72,
    (g) => {
      g.fillStyle(0xffffff, 0.75);
      g.fillCircle(36, 36, 34);
      g.fillStyle(PALETTE.playerRim, 0.9);
      g.fillCircle(36, 36, 22);
    },
    out,
  );

  // UI icons.
  bake(
    scene,
    TEX.iconHeal,
    48,
    48,
    (g) => {
      g.fillStyle(0x2a2050, 1);
      g.fillRoundedRect(0, 0, 48, 48, 8);
      drawGrid(g, HEART_GRID, HEART_PAL, 4, 8, 10);
    },
    out,
  );
  bake(
    scene,
    TEX.iconPause,
    48,
    48,
    (g) => {
      g.fillStyle(0x000000, 0.45);
      g.fillRoundedRect(0, 0, 48, 48, 10);
      g.fillStyle(0xffffff, 1);
      g.fillRect(14, 12, 7, 24);
      g.fillRect(27, 12, 7, 24);
    },
    out,
  );
  bake(
    scene,
    TEX.panel,
    96,
    96,
    (g) => {
      g.fillStyle(0x0b0716, 0.92);
      g.fillRoundedRect(0, 0, 96, 96, 16);
      g.fillStyle(0x2a2050, 1);
      g.fillRoundedRect(4, 4, 88, 88, 13);
      g.lineStyle(2, 0x6b55b8, 1);
      g.strokeRoundedRect(5, 5, 86, 86, 12);
    },
    out,
  );

  return out;
}

/** Part icon: dark rounded tile with the part pixel map centred at 4 px/pixel. */
function bakeIcon(scene: Phaser.Scene, key: string, grid: Grid, pal: Pal, out: string[]): void {
  const size = 48;
  const { w, h } = gridSize(grid);
  const px = 4;
  bake(
    scene,
    key,
    size,
    size,
    (g) => {
      g.fillStyle(0x1a1433, 1);
      g.fillRoundedRect(0, 0, size, size, 8);
      const ox = Math.floor((size - w * px) / 2);
      const oy = Math.floor((size - h * px) / 2);
      drawSilhouette(g, grid, pal, px, ox, oy, OUTLINE, 1);
      drawGrid(g, grid, pal, px, ox, oy);
    },
    out,
  );
}

function bakeVignette(scene: Phaser.Scene, out: string[]): void {
  const key = TEX.vignette;
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, 256, 256);
  if (!tex) throw new Error('createCanvas failed for vignette');
  const ctx = tex.getContext();
  const grad = ctx.createRadialGradient(128, 128, 60, 128, 128, 182);
  grad.addColorStop(0, 'rgba(8,4,20,0)');
  grad.addColorStop(0.6, 'rgba(8,4,20,0.35)');
  grad.addColorStop(1, 'rgba(8,4,20,0.9)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  tex.refresh();
  out.push(key);
}

/** Every key generateTextures() is expected to produce (used for placeholder fallback). */
export function expectedTextureKeys(): string[] {
  const keys: string[] = [
    TEX.playerBody,
    TEX.orb,
    TEX.token,
    TEX.projectilePlayer,
    TEX.projectileEnemy,
    TEX.bone,
    TEX.ground,
    TEX.particle,
    TEX.vignette,
    TEX.joystickBase,
    TEX.joystickKnob,
    TEX.iconHeal,
    TEX.iconPause,
    TEX.panel,
  ];
  for (const p of GAME_CONFIG.bodyParts) keys.push(p.sprite, p.icon);
  for (const m of GAME_CONFIG.mutations) keys.push(m.spriteKey);
  for (const e of GAME_CONFIG.enemies) keys.push(e.sprite);
  return keys;
}

/**
 * Fallback when generation fails: a coloured circle for every missing key so
 * the game stays playable (Req 1.9).
 */
export function generatePlaceholders(scene: Phaser.Scene): string[] {
  const out: string[] = [];
  const colors = [0x6fdc5a, 0x8a4fd8, 0xff4f6a, 0x3ff0ff, 0xffc83d, 0xf2ead2];
  expectedTextureKeys().forEach((key, i) => {
    if (scene.textures.exists(key)) return;
    try {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(colors[i % colors.length] ?? 0xffffff, 1);
      g.fillCircle(16, 16, 16);
      g.generateTexture(key, 32, 32);
      g.destroy();
      out.push(key);
    } catch {
      /* nothing more we can do for this key */
    }
  });
  return out;
}
