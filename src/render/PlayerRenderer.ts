/**
 * PlayerRenderer (design "Rendering"): a Container with the blob body, a bright
 * rim (Req 19.3) and one Image per visible body-part copy placed at the part's
 * anchors (Req 11.2), plus mutation sprites (Req 20.3). Merged parts are hidden.
 *
 * Copies: parts with several anchors and a `count` param (Extra Eye) show
 * min(anchors, count at the current level) copies; parts with several anchors
 * and no count (Bat Wings: left + right) show every anchor.
 *
 * Call `rebuild()` whenever partGained / partLevelled / mutation is drained;
 * it re-syncs synchronously so new parts are visible in the same frame.
 * Also used by ResultsScene as a static portrait (`interactive: false`:
 * no invulnerability blink, no facing flip).
 */
import Phaser from 'phaser';
import { DEPTH, PALETTE, TEX } from '../game/keys';
import type { Anchor } from '../data/bodyParts';
import type { CosmeticLook } from '../meta/Shop';
import type { RunState } from '../sim/RunState';

export interface PlayerRendererOptions {
  /** false = static portrait (ResultsScene). Default true. */
  interactive?: boolean;
  /** Equipped cosmetic look (task 23). Visual only; never affects the sim. */
  cosmetic?: CosmeticLook | null;
}

/** Body display width ≈ player radius × this. */
const BODY_SIZE_PER_RADIUS = 2.6;
const RIM_SCALE = 1.14;

interface PartSlot {
  img: Phaser.GameObjects.Image;
  anchor: Anchor;
  phase: number;
}

export class PlayerRenderer {
  readonly container: Phaser.GameObjects.Container;
  readonly interactive: boolean;
  private readonly body: Phaser.GameObjects.Image;
  private readonly rim: Phaser.GameObjects.Image;
  /** Pool of part images (reused across rebuilds; destroyed only with the renderer). */
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private readonly slots: PartSlot[] = [];
  private baseScale = 1;
  private bodyTex = '';
  private readonly cosmetic: CosmeticLook | null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: RunState,
    opts: PlayerRendererOptions = {},
  ) {
    this.interactive = opts.interactive ?? true;
    this.cosmetic = opts.cosmetic ?? null;
    this.rim = scene.add.image(0, 0, '__WHITE');
    this.body = scene.add.image(0, 0, '__WHITE');
    this.container = scene.add.container(0, 0, [this.rim, this.body]).setDepth(DEPTH.player);
    this.rebuild();
  }

  /** Re-creates the part layout from state.build. Synchronous (Req 11.2). */
  rebuild(): void {
    this.refreshBodyTexture();
    const cfg = this.state.config;
    const build = this.state.build;

    // Parts hidden by mutations: OwnedPart.merged, plus `consumes` of owned mutations.
    const hidden = new Set<string>();
    for (const m of cfg.mutations) if (build.mutations.has(m.id)) for (const c of m.consumes) hidden.add(c);

    const wanted: Array<{ tex: string; anchor: Anchor }> = [];
    for (const def of cfg.bodyParts) {
      const owned = build.parts.get(def.id);
      if (!owned || owned.merged || hidden.has(def.id) || def.anchors.length === 0) continue;
      const params = def.levels[Math.min(def.levels.length, Math.max(1, owned.level)) - 1];
      const copies =
        params?.count !== undefined ? Math.max(1, Math.min(def.anchors.length, params.count)) : def.anchors.length;
      for (let i = 0; i < copies; i++) wanted.push({ tex: def.sprite, anchor: def.anchors[i] });
    }
    for (const m of cfg.mutations) {
      if (!build.mutations.has(m.id)) continue;
      wanted.push({ tex: TEX.mutationSprite(m.spriteKey), anchor: mutationAnchor(this.state, m.consumes) });
    }

    // Assign pooled images.
    while (this.pool.length < wanted.length) this.pool.push(this.scene.add.image(0, 0, '__WHITE'));
    this.slots.length = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const img = this.pool[i];
      if (i >= wanted.length) {
        img.setVisible(false);
        continue;
      }
      const w = wanted[i];
      const key = this.scene.textures.exists(w.tex) ? w.tex : '__WHITE';
      if (img.texture.key !== key) img.setTexture(key);
      if (this.cosmetic?.bodyTint !== undefined) img.setTint(this.cosmetic.bodyTint);
      else img.clearTint();
      img.setVisible(true).setPosition(w.anchor.x, w.anchor.y).setRotation(w.anchor.rotation);
      this.slots.push({ img, anchor: w.anchor, phase: i * 1.7 });
    }

    // Order children by anchor depth: negative depths behind the body (rim just behind body).
    const ordered = this.slots.slice().sort((a, b) => a.anchor.depth - b.anchor.depth);
    const children: Phaser.GameObjects.GameObject[] = [];
    let bodyPlaced = false;
    for (const s of ordered) {
      if (!bodyPlaced && s.anchor.depth >= 0) {
        children.push(this.rim, this.body);
        bodyPlaced = true;
      }
      children.push(s.img);
    }
    if (!bodyPlaced) children.push(this.rim, this.body);
    for (const img of this.pool) if (!img.visible) children.push(img);
    this.container.removeAll(false);
    this.container.add(children);
  }

  /** Positions the container (world coords) and animates idle squash / part wobble. */
  sync(x: number, y: number, timeMs: number): void {
    if (this.bodyTex === '__WHITE' && this.scene.textures.exists(TEX.playerBody)) this.rebuild();
    const c = this.container;
    c.setPosition(x, y);
    const squash = Math.sin(timeMs * 0.006) * 0.045;
    const s = this.baseScale;
    const p = this.state.player;
    const flip = this.interactive && p.lastDirX < 0 ? -1 : 1;
    c.setScale(s * (1 + squash) * flip, s * (1 - squash));
    for (const slot of this.slots) {
      const w = Math.sin(timeMs * 0.005 + slot.phase);
      slot.img.setRotation(slot.anchor.rotation + w * 0.08);
      slot.img.setPosition(slot.anchor.x, slot.anchor.y + w * 0.8);
    }
    // Blink while invulnerable.
    if (this.interactive && p.invuln > 0 && this.state.outcome === null) {
      c.setAlpha(Math.floor(timeMs / 70) % 2 === 0 ? 0.35 : 1);
    } else c.setAlpha(1);
  }

  /** Base scale applied to the body (excluding squash), e.g. for dash ghosts. */
  get bodyScale(): number {
    return this.baseScale;
  }

  setVisible(v: boolean): void {
    this.container.setVisible(v);
  }

  destroy(): void {
    this.container.destroy(true);
    this.pool.length = 0;
    this.slots.length = 0;
  }

  private refreshBodyTexture(): void {
    const key = this.scene.textures.exists(TEX.playerBody) ? TEX.playerBody : '__WHITE';
    this.bodyTex = key;
    if (this.body.texture.key !== key) this.body.setTexture(key);
    if (this.rim.texture.key !== key) this.rim.setTexture(key);
    this.rim.setTintFill(this.cosmetic?.rimColor ?? PALETTE.playerRim).setScale(RIM_SCALE).setAlpha(0.9);
    const w = Math.max(1, this.body.frame.width);
    // Clamp so a tiny fallback texture doesn't blow the parts up.
    this.baseScale = Phaser.Math.Clamp((this.state.player.radius * BODY_SIZE_PER_RADIUS) / w, 0.5, 4);
    if (key === '__WHITE') this.body.setTint(0x7be07b);
    else if (this.cosmetic?.bodyTint !== undefined) this.body.setTint(this.cosmetic.bodyTint);
    else this.body.clearTint();
  }
}

/** Mutation sprite anchor: centroid of the first consumed part's anchors (fallback: above centre). */
function mutationAnchor(state: RunState, consumes: string[]): Anchor {
  for (const id of consumes) {
    const def = state.config.bodyParts.find((p) => p.id === id);
    if (!def || def.anchors.length === 0) continue;
    let x = 0;
    let y = 0;
    for (const a of def.anchors) {
      x += a.x;
      y += a.y;
    }
    return { x: x / def.anchors.length, y: y / def.anchors.length, rotation: 0, depth: 3 };
  }
  return { x: 0, y: -12, rotation: 0, depth: 3 };
}
