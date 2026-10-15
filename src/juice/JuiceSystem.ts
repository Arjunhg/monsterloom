/**
 * JuiceSystem (Req 18.1–18.7, 16.7–16.8): turns drained sim events into
 * particles, camera effects and synthesised sounds. Purely presentational:
 * it never touches the sim.
 *
 *   const juice = new JuiceSystem(scene, { enemyColor: (i) => ... });
 *   sim.events.drain((t, a, b, c, d) => juice.handle(t, a, b, c, d));
 *   juice.update(time, delta);
 *
 * Enemy white hit-flash is done by the entity renderer from sim hitFlash.
 */
import Phaser from 'phaser';
import { getSession } from '../game/Session';
import { DEPTH, PALETTE, SFX, TEX } from '../game/keys';
import { EventType } from '../sim/EventBus';
import { getAudio } from './AudioManager';
import { ParticlePool } from './ParticlePool';
import { QualityScaler } from './QualityScaler';
import { RateLimiter } from './RateLimiter';

export interface JuiceOptions {
  /** Tint for an enemy type index (EventBus enemyKilled payload d). */
  enemyColor(typeIndex: number): number;
}

const HURT_SHAKE_MS = 120;
const HURT_SHAKE_INTENSITY = 0.006;
const VIGNETTE_PEAK_ALPHA = 0.6;
const VIGNETTE_FADE_PER_MS = VIGNETTE_PEAK_ALPHA / 380;
const HURT_COLOR = 0xff2040;
const MERGE_COLOR = 0x9cff5a;
const MUTATION_COLOR = 0xc86bff;
const BOSS_COLOR = 0xff6a2a;
const LEVELUP_COLOR = 0xfff6a8;

function shakeEnabled(): boolean {
  try {
    return getSession().settings.shakeEnabled;
  } catch {
    return true;
  }
}

export class JuiceSystem {
  readonly quality = new QualityScaler();

  private readonly scene: Phaser.Scene;
  private readonly opts: JuiceOptions;
  private readonly particles: ParticlePool;
  private readonly killLimiter = new RateLimiter(30);
  private readonly sparkLimiter = new RateLimiter(16);
  private readonly vignette: Phaser.GameObjects.Image | null;
  private nowMs = 0;
  private destroyed = false;

  constructor(scene: Phaser.Scene, opts: JuiceOptions) {
    this.scene = scene;
    this.opts = opts;
    this.particles = new ParticlePool(scene, this.quality);
    if (scene.textures.exists(TEX.vignette)) {
      this.vignette = scene.add
        .image(0, 0, TEX.vignette)
        .setScrollFactor(0)
        .setDepth(DEPTH.overlay)
        .setTint(HURT_COLOR)
        .setAlpha(0)
        .setVisible(false);
    } else {
      this.vignette = null;
    }
  }

  /** Feed every drained EventBus event here. */
  handle(type: number, a: number, b: number, c: number, d: number): void {
    if (this.destroyed) return;
    const cam = this.scene.cameras.main;
    const audio = getAudio();
    switch (type) {
      case EventType.enemyKilled:
        this.particles.burst('deathBurst', b, c, this.safeEnemyColor(d), 10);
        if (this.killLimiter.tryAcquire(this.nowMs)) audio.play(SFX.kill, { pitch: 0.9 + Math.random() * 0.25 });
        break;

      case EventType.playerHurt:
        if (shakeEnabled()) cam.shake(HURT_SHAKE_MS, HURT_SHAKE_INTENSITY);
        this.flashVignette();
        audio.play(SFX.hurt);
        break;

      case EventType.levelUp: {
        const mid = cam.midPoint;
        this.particles.burst('levelUpRing', mid.x, mid.y, LEVELUP_COLOR, 36);
        cam.flash(160, 255, 246, 168, true);
        audio.play(SFX.levelUp);
        break;
      }

      case EventType.orbCollected:
        audio.play(SFX.pickup); // AudioManager rate-limits (50 ms) and steps pitch
        if (this.sparkLimiter.tryAcquire(this.nowMs)) this.particles.burst('hitSpark', b, c, PALETTE.orb, 4);
        break;

      case EventType.merge:
        this.particles.burst('mergeBurst', b, c, MERGE_COLOR, 16 + 4 * Math.max(0, d));
        audio.play(SFX.merge);
        break;

      case EventType.mutation: {
        const mid = cam.midPoint;
        this.particles.burst('mutationBurst', mid.x, mid.y, MUTATION_COLOR, 60);
        cam.flash(300, 200, 107, 255, true);
        if (shakeEnabled()) cam.shake(250, 0.008);
        audio.play(SFX.mutation);
        break;
      }

      case EventType.bossSpawn: {
        const mid = cam.midPoint;
        if (shakeEnabled()) cam.shake(400, 0.01);
        this.particles.burst('mutationBurst', mid.x, mid.y, BOSS_COLOR, 30);
        audio.play(SFX.hurt, { pitch: 0.5, volume: 0.8 });
        break;
      }

      case EventType.bossKilled:
        if (shakeEnabled()) cam.shake(350, 0.012);
        cam.flash(220, 255, 210, 160, true);
        this.particles.burst('mutationBurst', a, b, BOSS_COLOR, 70);
        this.particles.burst('deathBurst', a, b, 0xffffff, 30);
        audio.play(SFX.mutation, { pitch: 0.7 });
        break;

      default:
        break;
    }
  }

  /** Call once per rendered frame. */
  update(timeMs: number, deltaMs: number): void {
    if (this.destroyed) return;
    this.nowMs = timeMs;
    this.quality.update(deltaMs);
    const v = this.vignette;
    if (v && v.visible) {
      const alpha = v.alpha - VIGNETTE_FADE_PER_MS * Math.max(0, deltaMs);
      if (alpha <= 0) v.setAlpha(0).setVisible(false);
      else v.setAlpha(alpha);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.particles.destroy();
    this.vignette?.destroy();
  }

  private flashVignette(): void {
    const v = this.vignette;
    if (!v) return;
    const cam = this.scene.cameras.main;
    // Scroll-factor-0 objects still scale with camera zoom around the centre.
    const zoom = cam.zoom || 1;
    v.setPosition(cam.width / 2, cam.height / 2)
      .setDisplaySize(cam.width / zoom, cam.height / zoom)
      .setAlpha(VIGNETTE_PEAK_ALPHA)
      .setVisible(true);
  }

  private safeEnemyColor(typeIndex: number): number {
    try {
      const c = this.opts.enemyColor(typeIndex);
      return Number.isFinite(c) ? c : 0xffffff;
    } catch {
      return 0xffffff;
    }
  }
}
