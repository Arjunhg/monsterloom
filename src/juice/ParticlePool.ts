/**
 * ParticlePool (design "JuiceSystem"): one pre-built ParticleEmitter per
 * effect family, fired with `explode(count)`. No emitters are created per
 * event. Burst counts are scaled by the QualityScaler (Req 16.7).
 */
import Phaser from 'phaser';
import { DEPTH, TEX } from '../game/keys';
import type { QualityScaler } from './QualityScaler';

export type ParticleFamily = 'deathBurst' | 'mergeBurst' | 'mutationBurst' | 'levelUpRing' | 'hitSpark';

type EmitterConfig = Phaser.Types.GameObjects.Particles.ParticleEmitterConfig;

const FAMILY_CONFIG: Record<ParticleFamily, EmitterConfig> = {
  deathBurst: {
    speed: { min: 60, max: 220 },
    angle: { min: 0, max: 360 },
    lifespan: { min: 300, max: 550 },
    scale: { start: 0.9, end: 0 },
    alpha: { start: 1, end: 0 },
  },
  mergeBurst: {
    speed: { min: 40, max: 170 },
    angle: { min: 0, max: 360 },
    lifespan: { min: 450, max: 700 },
    scale: { start: 1.4, end: 0 },
    alpha: { start: 1, end: 0 },
  },
  mutationBurst: {
    speed: { min: 150, max: 520 },
    angle: { min: 0, max: 360 },
    lifespan: { min: 600, max: 1000 },
    scale: { start: 1.6, end: 0 },
    alpha: { start: 1, end: 0 },
    blendMode: 'ADD',
  },
  levelUpRing: {
    // Narrow speed band so the burst reads as an expanding ring (Req 18.4).
    speed: { min: 380, max: 420 },
    angle: { min: 0, max: 360 },
    lifespan: 520,
    scale: { start: 1.2, end: 0.2 },
    alpha: { start: 1, end: 0 },
    blendMode: 'ADD',
  },
  hitSpark: {
    speed: { min: 30, max: 100 },
    angle: { min: 0, max: 360 },
    lifespan: { min: 150, max: 250 },
    scale: { start: 0.5, end: 0 },
    alpha: { start: 1, end: 0 },
    blendMode: 'ADD',
  },
};

const FAMILIES = Object.keys(FAMILY_CONFIG) as ParticleFamily[];

export class ParticlePool {
  private readonly emitters = new Map<ParticleFamily, Phaser.GameObjects.Particles.ParticleEmitter>();
  private readonly quality: QualityScaler;

  constructor(scene: Phaser.Scene, quality: QualityScaler) {
    this.quality = quality;
    if (!scene.textures.exists(TEX.particle)) return; // texture missing: bursts become no-ops
    for (const family of FAMILIES) {
      const emitter = scene.add.particles(0, 0, TEX.particle, { ...FAMILY_CONFIG[family], emitting: false });
      emitter.setDepth(DEPTH.effect);
      this.emitters.set(family, emitter);
    }
  }

  /** Emits round(baseCount × particleScale) particles of `family` at (x, y) tinted `color`. */
  burst(family: ParticleFamily, x: number, y: number, color: number, baseCount: number): void {
    const emitter = this.emitters.get(family);
    if (!emitter || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const count = Math.round(baseCount * this.quality.particleScale);
    if (count <= 0) return;
    emitter.setParticleTint(color);
    emitter.explode(count, x, y);
  }

  destroy(): void {
    for (const e of this.emitters.values()) e.destroy();
    this.emitters.clear();
  }
}
