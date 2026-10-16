/**
 * AbilityVisuals: ability effects that are not pooled entities.
 * - Ribcage bones (TEX.bone images at ribcageBonePositions)
 * - Swamp Gut puddles (translucent green circles)
 * - Bat Wings dash trail (fading body ghosts while dashing)
 * - Beholder Gaze beam (thick additive glowing line, Req 20.3)
 * - Werewolf Frenzy shockwave ring, Bone Storm burst flash, Bog Kraken tentacles
 *
 * Sim positions are offset by (renderPlayer − simPlayer) so effects attached to
 * the player follow the interpolated sprite without jitter.
 */
import Phaser from 'phaser';
import { DEPTH, TEX } from '../game/keys';
import { batWingsDashing } from '../sim/abilities/batWings';
import { beholderBeam } from '../sim/abilities/beholderGaze';
import { bogKrakenGrabs, bogKrakenView } from '../sim/abilities/bogKraken';
import { boneStormPulse } from '../sim/abilities/boneStorm';
import { werewolfShockwave } from '../sim/abilities/werewolfFrenzy';
import { ribcageBonePositions } from '../sim/abilities/ribcage';
import { swampGutPuddle } from '../sim/abilities/swampGut';
import type { SimContext } from '../sim/SimContext';

const GHOST_COUNT = 6;
const GHOST_FADE_PER_SEC = 3;
const GHOST_INTERVAL_MS = 30;
/** Segments per Bog Kraken tentacle line. */
const TENTACLE_SEGMENTS = 10;
const TENTACLE_WOBBLE_PX = 10;

export class AbilityVisuals {
  /** Normal-blend layer (puddles). */
  private readonly g: Phaser.GameObjects.Graphics;
  /** Additive layer (beam). */
  private readonly glow: Phaser.GameObjects.Graphics;
  private readonly bones: Phaser.GameObjects.Image[] = [];
  private readonly ghosts: Phaser.GameObjects.Image[] = [];
  private ghostNext = 0;
  private lastGhostAt = -Infinity;
  private readonly bonePos: number[] = [];
  private readonly grabPos: number[] = [];
  private readonly ribIdx: number;
  private readonly swampIdx: number;
  private readonly batIdx: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: SimContext,
  ) {
    const parts = ctx.state.config.bodyParts;
    this.ribIdx = parts.findIndex((p) => p.id === 'ribcage');
    this.swampIdx = parts.findIndex((p) => p.id === 'swamp_gut');
    this.batIdx = parts.findIndex((p) => p.id === 'bat_wings');
    this.g = scene.add.graphics().setDepth(DEPTH.decal);
    this.glow = scene.add.graphics().setDepth(DEPTH.effect).setBlendMode(Phaser.BlendModes.ADD);
  }

  /** (rx, ry) = interpolated player render position; bodyScale = PlayerRenderer.bodyScale (dash ghosts). */
  render(rx: number, ry: number, timeMs: number, deltaMs: number, bodyScale = 1): void {
    const s = this.ctx.state;
    const p = s.player;
    const ox = rx - p.x;
    const oy = ry - p.y;
    const parts = s.build.parts;
    const g = this.g;
    const glow = this.glow;
    g.clear();
    glow.clear();

    // Swamp puddle.
    if (this.swampIdx >= 0 && parts.has('swamp_gut')) {
      const pd = swampGutPuddle(this.ctx, this.swampIdx);
      if (pd.active && pd.radius > 0) {
        const fade = Math.min(1, pd.timeLeft / 0.4);
        g.fillStyle(0x5fd35a, 0.22 * fade);
        g.fillCircle(pd.x, pd.y, pd.radius);
        g.lineStyle(3, 0x9dff6a, 0.45 * fade);
        g.strokeCircle(pd.x, pd.y, pd.radius * (0.96 + 0.04 * Math.sin(timeMs * 0.01)));
      }
    }

    // Ribcage bones.
    let n = 0;
    if (this.ribIdx >= 0 && parts.has('ribcage')) n = ribcageBonePositions(this.ctx, this.ribIdx, this.bonePos);
    const boneKey = this.scene.textures.exists(TEX.bone) ? TEX.bone : '__WHITE';
    while (this.bones.length < n) {
      this.bones.push(this.scene.add.image(0, 0, boneKey).setDepth(DEPTH.projectile - 1));
    }
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      if (i >= n) {
        b.setVisible(false);
        continue;
      }
      if (b.texture.key !== boneKey) b.setTexture(boneKey);
      const bx = this.bonePos[2 * i] + ox;
      const by = this.bonePos[2 * i + 1] + oy;
      b.setPosition(bx, by).setRotation(Math.atan2(by - ry, bx - rx) + Math.PI / 2).setVisible(true);
    }

    // Bat Wings dash trail.
    const dashing = this.batIdx >= 0 && parts.has('bat_wings') && batWingsDashing(this.ctx, this.batIdx);
    if (dashing && timeMs - this.lastGhostAt >= GHOST_INTERVAL_MS) {
      this.lastGhostAt = timeMs;
      const bodyKey = this.scene.textures.exists(TEX.playerBody) ? TEX.playerBody : '__WHITE';
      let ghost = this.ghosts[this.ghostNext];
      if (!ghost) {
        ghost = this.scene.add
          .image(0, 0, bodyKey)
          .setDepth(DEPTH.player - 1)
          .setTintFill(0xb48cff)
          .setBlendMode(Phaser.BlendModes.ADD);
        this.ghosts[this.ghostNext] = ghost;
      }
      if (ghost.texture.key !== bodyKey) ghost.setTexture(bodyKey);
      ghost.setPosition(rx, ry).setScale(bodyScale).setAlpha(0.55).setVisible(true);
      this.ghostNext = (this.ghostNext + 1) % GHOST_COUNT;
    }
    const fade = (GHOST_FADE_PER_SEC * deltaMs) / 1000;
    for (const gh of this.ghosts) {
      if (!gh || !gh.visible) continue;
      const a = gh.alpha - fade;
      if (a <= 0) gh.setVisible(false);
      else gh.setAlpha(a);
    }

    // Beholder beam.
    const beam = beholderBeam(this.ctx);
    if (beam.active) {
      const x1 = beam.x1 + ox;
      const y1 = beam.y1 + oy;
      const x2 = beam.x2 + ox;
      const y2 = beam.y2 + oy;
      const flicker = 0.85 + 0.15 * Math.sin(timeMs * 0.03);
      glow.lineStyle(beam.width * 1.6, 0xff3fc8, 0.25 * flicker);
      glow.lineBetween(x1, y1, x2, y2);
      glow.lineStyle(beam.width, 0xff7ae0, 0.45 * flicker);
      glow.lineBetween(x1, y1, x2, y2);
      glow.lineStyle(beam.width * 0.35, 0xfff0ff, 0.9);
      glow.lineBetween(x1, y1, x2, y2);
      glow.fillStyle(0xfff0ff, 0.8);
      glow.fillCircle(x2, y2, beam.width * 0.4);
    }

    this.renderMutationEffects(rx, ry, timeMs);
  }

  /** Werewolf shockwave ring, Bone Storm flash, Bog Kraken tentacles. */
  private renderMutationEffects(rx: number, ry: number, timeMs: number): void {
    const g = this.g;
    const glow = this.glow;

    // Werewolf Frenzy: expanding orange-red ring at the dash end point.
    const wave = werewolfShockwave(this.ctx);
    if (wave.active) {
      const a = 1 - wave.t01;
      const r = Math.max(4, wave.radius);
      glow.fillStyle(0xff5a1f, 0.18 * a);
      glow.fillCircle(wave.x, wave.y, r);
      glow.lineStyle(10 * a + 2, 0xff3b1f, 0.75 * a);
      glow.strokeCircle(wave.x, wave.y, r);
      glow.lineStyle(3, 0xffc27a, 0.9 * a);
      glow.strokeCircle(wave.x, wave.y, r * 0.92);
    }

    // Bone Storm: brief bone-white flash around the player on each burst.
    const flash = boneStormPulse(this.ctx);
    if (flash.active) {
      const a = 1 - flash.t01;
      glow.fillStyle(0xfff6dc, 0.35 * a);
      glow.fillCircle(rx, ry, 30 + 50 * flash.t01);
      glow.lineStyle(4, 0xffffff, 0.7 * a);
      glow.strokeCircle(rx, ry, 40 + 70 * flash.t01);
    }

    // Bog Kraken: wobbly dark-green tentacles from the anchor to each grabbed enemy.
    const n = bogKrakenGrabs(this.ctx, this.grabPos);
    if (n > 0) {
      const kv = bogKrakenView(this.ctx);
      const a = 1 - kv.t01 * 0.7;
      for (let i = 0; i < n; i++) {
        const tx = this.grabPos[2 * i];
        const ty = this.grabPos[2 * i + 1];
        const dx = tx - kv.x;
        const dy = ty - kv.y;
        const len = Math.hypot(dx, dy);
        const nx = len > 1e-6 ? -dy / len : 0;
        const ny = len > 1e-6 ? dx / len : 0;
        for (let pass = 0; pass < 2; pass++) {
          if (pass === 0) g.lineStyle(9, 0x1f4a1c, 0.85 * a);
          else g.lineStyle(4, 0x4f8f3a, 0.9 * a);
          g.beginPath();
          g.moveTo(kv.x, kv.y);
          for (let k = 1; k <= TENTACLE_SEGMENTS; k++) {
            const t = k / TENTACLE_SEGMENTS;
            const w = Math.sin(t * Math.PI) * TENTACLE_WOBBLE_PX * Math.sin(timeMs * 0.02 + t * 7 + i * 2);
            g.lineTo(kv.x + dx * t + nx * w, kv.y + dy * t + ny * w);
          }
          g.strokePath();
        }
        g.fillStyle(0x1f4a1c, 0.9 * a);
        g.fillCircle(tx, ty, 6);
      }
    }
  }

  destroy(): void {
    this.g.destroy();
    this.glow.destroy();
    for (const b of this.bones) b.destroy();
    for (const gh of this.ghosts) gh?.destroy();
    this.bones.length = 0;
    this.ghosts.length = 0;
  }
}
