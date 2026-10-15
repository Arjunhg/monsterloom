/**
 * EntityRenderer (design "Rendering"): pooled Images for enemies, player and
 * enemy projectiles, orbs and tokens. Images are created on demand (never more
 * than the store capacity) and never destroyed during a run; unused ones are
 * hidden. Positions are interpolated between prev and current sim positions.
 */
import Phaser from 'phaser';
import { DEPTH, PALETTE, TEX } from '../game/keys';
import { PROJECTILE_SIDE, type RunState } from '../sim/RunState';

/** Entities further than this outside the camera view are hidden. */
const CULL_MARGIN = 200;
/** Enemy display width ≈ radius × this (before merge-tier scale). */
const ENEMY_SIZE_PER_RADIUS = 2.4;
const PROJ_SIZE_PER_RADIUS = 2.6;
const MIN_PROJ_SIZE = 10;

class ImagePool {
  readonly items: Phaser.GameObjects.Image[] = [];
  used = 0;
  private lastUsed = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly capacity: number,
    private readonly texture: string,
    private readonly depth: number,
    private readonly additive = false,
  ) {}

  /** Returns the next free image (created on demand), or null if the pool is full. */
  next(): Phaser.GameObjects.Image | null {
    if (this.used >= this.capacity) return null;
    let img = this.items[this.used];
    if (!img) {
      img = this.scene.add.image(0, 0, texOrWhite(this.scene, this.texture)).setDepth(this.depth).setVisible(false);
      if (this.additive) img.setBlendMode(Phaser.BlendModes.ADD);
      this.items.push(img);
    }
    this.used++;
    return img;
  }

  begin(): void {
    this.used = 0;
  }

  /** Hides images that were in use last frame but not this one. */
  end(): void {
    for (let i = this.used; i < this.lastUsed; i++) this.items[i].setVisible(false);
    this.lastUsed = this.used;
  }

  destroy(): void {
    for (const img of this.items) img.destroy();
    this.items.length = 0;
    this.used = this.lastUsed = 0;
  }
}

function texOrWhite(scene: Phaser.Scene, key: string): string {
  return scene.textures.exists(key) ? key : '__WHITE';
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class EntityRenderer {
  private readonly enemies: ImagePool;
  private readonly playerProj: ImagePool;
  private readonly enemyProj: ImagePool;
  private readonly orbs: ImagePool;
  private readonly tokens: ImagePool;
  /** Per enemy type: resolved texture key and base scale (computed lazily). */
  private readonly enemyTex: string[] = [];
  private readonly enemyBase: number[] = [];
  private readonly view = new Phaser.Geom.Rectangle();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: RunState,
  ) {
    const s = state;
    this.enemies = new ImagePool(scene, s.enemies.capacity, TEX.particle, DEPTH.enemy);
    this.playerProj = new ImagePool(scene, s.projectiles.capacity, TEX.projectilePlayer, DEPTH.projectile);
    this.enemyProj = new ImagePool(scene, s.projectiles.capacity, TEX.projectileEnemy, DEPTH.projectile + 1);
    this.orbs = new ImagePool(scene, s.orbs.capacity, TEX.orb, DEPTH.orb, true);
    this.tokens = new ImagePool(scene, s.tokens.capacity, TEX.token, DEPTH.orb + 1);
  }

  /** Syncs every pooled image with the sim. `alpha` = interpolation factor, `timeMs` for pulses. */
  render(alpha: number, timeMs: number): void {
    const cam = this.scene.cameras.main;
    const wv = cam.worldView;
    const v = this.view;
    v.setTo(wv.x - CULL_MARGIN, wv.y - CULL_MARGIN, wv.width + CULL_MARGIN * 2, wv.height + CULL_MARGIN * 2);
    this.renderEnemies(alpha);
    this.renderProjectiles(alpha);
    this.renderOrbs(timeMs);
    this.renderTokens(timeMs);
  }

  destroy(): void {
    this.enemies.destroy();
    this.playerProj.destroy();
    this.enemyProj.destroy();
    this.orbs.destroy();
    this.tokens.destroy();
  }

  private inView(x: number, y: number): boolean {
    const v = this.view;
    return x >= v.x && x <= v.right && y >= v.y && y <= v.bottom;
  }

  private resolveEnemyType(typeIndex: number): void {
    const def = this.state.config.enemies[typeIndex];
    const key = def ? TEX.enemy(def.sprite) : '';
    const tex = texOrWhite(this.scene, key);
    if (this.enemyTex[typeIndex] === tex) return;
    this.enemyTex[typeIndex] = tex;
    const frame = this.scene.textures.getFrame(tex);
    const w = Math.max(1, frame ? frame.width : 1);
    this.enemyBase[typeIndex] = ((def?.radius ?? 12) * ENEMY_SIZE_PER_RADIUS) / w;
  }

  private renderEnemies(alpha: number): void {
    const e = this.state.enemies;
    const px = this.state.player.x;
    const pool = this.enemies;
    pool.begin();
    const ids = e.pool.activeIds;
    for (let k = 0; k < e.count; k++) {
      const id = ids[k];
      const x = lerp(e.prevX[id], e.x[id], alpha);
      const y = lerp(e.prevY[id], e.y[id], alpha);
      if (!this.inView(x, y)) continue;
      const img = pool.next();
      if (!img) break;
      const type = e.typeId[id];
      // Re-resolve while the texture is missing (BootScene may still be generating).
      if (this.enemyTex[type] === undefined || this.enemyTex[type] === '__WHITE') this.resolveEnemyType(type);
      const tex = this.enemyTex[type];
      if (img.texture.key !== tex) img.setTexture(tex);
      img.setPosition(x, y);
      img.setScale(e.scale[id] * this.enemyBase[type]);
      img.setFlipX(px < x);
      if (e.hitFlash[id] > 0) img.setTintFill(0xffffff); // Req 18.1
      else if (img.isTinted) img.clearTint();
      img.setVisible(true);
    }
    pool.end();
  }

  private renderProjectiles(alpha: number): void {
    const p = this.state.projectiles;
    this.playerProj.begin();
    this.enemyProj.begin();
    const ids = p.pool.activeIds;
    for (let k = 0; k < p.count; k++) {
      const id = ids[k];
      const x = lerp(p.prevX[id], p.x[id], alpha);
      const y = lerp(p.prevY[id], p.y[id], alpha);
      if (!this.inView(x, y)) continue;
      const enemySide = p.side[id] === PROJECTILE_SIDE.ENEMY;
      const pool = enemySide ? this.enemyProj : this.playerProj;
      const img = pool.next();
      if (!img) continue;
      if (img.texture.key === '__WHITE') {
        const key = enemySide ? TEX.projectileEnemy : TEX.projectilePlayer;
        if (this.scene.textures.exists(key)) img.setTexture(key).clearTint();
        else img.setTint(enemySide ? PALETTE.enemyProjectile : PALETTE.playerRim);
      }
      const w = Math.max(1, img.frame.width);
      img.setPosition(x, y);
      img.setScale(Math.max(MIN_PROJ_SIZE, p.radius[id] * PROJ_SIZE_PER_RADIUS) / w);
      if (p.vx[id] !== 0 || p.vy[id] !== 0) img.setRotation(Math.atan2(p.vy[id], p.vx[id]));
      img.setVisible(true);
    }
    this.playerProj.end();
    this.enemyProj.end();
  }

  private renderOrbs(timeMs: number): void {
    const o = this.state.orbs;
    const pool = this.orbs;
    pool.begin();
    const ids = o.pool.activeIds;
    for (let k = 0; k < o.count; k++) {
      const id = ids[k];
      const x = o.x[id];
      const y = o.y[id];
      if (!this.inView(x, y)) continue;
      const img = pool.next();
      if (!img) break;
      if (img.texture.key === '__WHITE') {
        if (this.scene.textures.exists(TEX.orb)) img.setTexture(TEX.orb).clearTint();
        else img.setTint(PALETTE.orb);
      }
      // Bigger orbs (merged by the cap) render a little larger; slight pulse.
      const size = 1 + Math.min(0.8, Math.log10(1 + o.value[id]) * 0.35);
      img.setPosition(x, y);
      img.setScale(size * (1 + 0.12 * Math.sin(timeMs * 0.008 + id)));
      img.setVisible(true);
    }
    pool.end();
  }

  private renderTokens(timeMs: number): void {
    const t = this.state.tokens;
    const pool = this.tokens;
    pool.begin();
    const ids = t.pool.activeIds;
    for (let k = 0; k < t.count; k++) {
      const id = ids[k];
      const x = t.x[id];
      const y = t.y[id];
      if (!this.inView(x, y)) continue;
      const img = pool.next();
      if (!img) break;
      if (img.texture.key === '__WHITE' && this.scene.textures.exists(TEX.token)) img.setTexture(TEX.token);
      img.setPosition(x, y + Math.sin(timeMs * 0.004 + id) * 4);
      img.setScale(1 + 0.06 * Math.sin(timeMs * 0.006 + id));
      img.setVisible(true);
    }
    pool.end();
  }
}
