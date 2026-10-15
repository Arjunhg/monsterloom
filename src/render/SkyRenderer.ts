/**
 * SkyRenderer (Req 13.3, 19.3): scrolling ground TileSprite plus a full-screen
 * gradient overlay whose colours move midnight indigo → violet → amber → pale
 * dawn with skyPhase. Overall brightness follows skyBrightness (monotone), so
 * the scene only ever gets lighter as the night progresses. A few ambient
 * fireflies drift above the ground.
 */
import Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH, PALETTE, TEX } from '../game/keys';
import { skyBrightness, skyPhase } from '../sim/systems/ClockSystem';
import type { RunState } from '../sim/RunState';

/** Keyframes: [top colour, bottom colour] per stop, evenly spaced over phase 0..1. */
const SKY_STOPS: ReadonlyArray<readonly [number, number]> = [
  [PALETTE.night, 0x1d1650], // midnight indigo
  [0x2b1a5c, 0x4a2a78], // violet
  [0x7a3f6a, 0xd9864a], // amber
  [0xbfc8e6, PALETTE.dawn], // pale dawn
];
/** Overlay alpha at brightness 0 → 1 (night is heavily tinted; dawn lightly). */
const OVERLAY_ALPHA_NIGHT = 0.55;
const OVERLAY_ALPHA_DAWN = 0.2;
/** Ground tint grey level at brightness 0 → 1. */
const GROUND_DARK = 0x60;
const GROUND_LIGHT = 0xff;
const FIREFLY_COUNT = 14;

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const r = Math.round(ar + (((b >> 16) & 0xff) - ar) * t);
  const g = Math.round(ag + (((b >> 8) & 0xff) - ag) * t);
  const bl = Math.round(ab + ((b & 0xff) - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Interpolated [top, bottom] sky colours at `phase`. */
export function skyColors(phase: number): [number, number] {
  const p = Phaser.Math.Clamp(Number.isFinite(phase) ? phase : 0, 0, 1);
  const seg = p * (SKY_STOPS.length - 1);
  const i = Math.min(SKY_STOPS.length - 2, Math.floor(seg));
  const t = seg - i;
  const a = SKY_STOPS[i];
  const b = SKY_STOPS[i + 1];
  return [lerpColor(a[0], b[0], t), lerpColor(a[1], b[1], t)];
}

interface Firefly {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  phase: number;
  speed: number;
}

export class SkyRenderer {
  private readonly ground: Phaser.GameObjects.TileSprite;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly fireflies: Firefly[] = [];
  private lastPhaseKey = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: RunState,
  ) {
    const groundKey = scene.textures.exists(TEX.ground) ? TEX.ground : '__WHITE';
    this.ground = scene.add
      .tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, groundKey)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.ground);
    if (groundKey === '__WHITE') this.ground.setTint(0x2a2440);
    // Sits directly above the ground (below decals/entities) so sprites keep full contrast (Req 19.3).
    this.overlay = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.ground + 1);

    const particleKey = scene.textures.exists(TEX.particle) ? TEX.particle : '__WHITE';
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const img = scene.add
        .image(0, 0, particleKey)
        .setScrollFactor(0)
        .setDepth(DEPTH.effect - 1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xd8ff7a)
        .setScale(0.5);
      this.fireflies.push({
        img,
        x: Math.random() * GAME_WIDTH,
        y: Math.random() * GAME_HEIGHT,
        phase: Math.random() * Math.PI * 2,
        speed: 6 + Math.random() * 10,
      });
    }
  }

  render(timeMs: number, deltaMs: number): void {
    const cam = this.scene.cameras.main;
    this.ground.setTilePosition(cam.scrollX, cam.scrollY);

    const clock = this.state.clock;
    const phase = skyPhase(clock.elapsed, clock.duration);
    const bright = skyBrightness(phase);
    // Redraw only when the phase moved noticeably (≈ 500 steps over a run).
    const key = Math.round(phase * 500);
    if (key !== this.lastPhaseKey) {
      this.lastPhaseKey = key;
      const [top, bottom] = skyColors(phase);
      const a = OVERLAY_ALPHA_NIGHT + (OVERLAY_ALPHA_DAWN - OVERLAY_ALPHA_NIGHT) * bright;
      const g = this.overlay;
      g.clear();
      g.fillGradientStyle(top, top, bottom, bottom, a, a, a, a);
      g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      const grey = Math.round(GROUND_DARK + (GROUND_LIGHT - GROUND_DARK) * bright);
      if (this.ground.texture.key !== '__WHITE') this.ground.setTint((grey << 16) | (grey << 8) | grey);
    }

    // Fireflies fade out towards dawn; they drift with a slight parallax.
    const dt = Math.min(0.1, deltaMs / 1000);
    const ffAlpha = 0.8 * (1 - bright);
    for (const f of this.fireflies) {
      f.y -= f.speed * dt;
      f.x += Math.sin(timeMs * 0.0011 + f.phase) * 12 * dt;
      if (f.y < -10) {
        f.y = GAME_HEIGHT + 10;
        f.x = Math.random() * GAME_WIDTH;
      }
      const sx = Phaser.Math.Wrap(f.x - cam.scrollX * 0.15, 0, GAME_WIDTH);
      const sy = Phaser.Math.Wrap(f.y - cam.scrollY * 0.15, 0, GAME_HEIGHT);
      f.img.setPosition(sx, sy).setAlpha(ffAlpha * (0.5 + 0.5 * Math.sin(timeMs * 0.003 + f.phase)));
    }
  }

  destroy(): void {
    this.ground.destroy();
    this.overlay.destroy();
    for (const f of this.fireflies) f.img.destroy();
    this.fireflies.length = 0;
  }
}
