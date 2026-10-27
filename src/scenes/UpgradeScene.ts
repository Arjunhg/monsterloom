/**
 * UpgradeScene (Req 8.4, 9.4–9.7, 10.3, 18.4, 20.2): the level-up / token menu.
 *
 * GameScene launches this scene while `sim.state.paused === 'menu'`. Offers are
 * drawn once per menu in create(). Picking one applies it, resolves one pending
 * level-up (or token) and either restarts this scene for the next pending pick
 * (8.4 overflow) or stops it, which resumes the run.
 *
 * Rerolls/bans (Req 25): a "Reroll (n)" button (key R) below the cards redraws all
 * three; each new-part card has a corner "Ban" button that bans the part and
 * redraws only that card. Both are dimmed and non-interactive when unavailable.
 */
import Phaser from 'phaser';
import { describeLevelUp } from '../game/describe';
import { FONT, GAME_WIDTH, PALETTE, RARITY_COLOR, SCENE, SFX, TEX } from '../game/keys';
import { columnLayout, keepFitted } from '../game/layout';
import { getSession } from '../game/Session';
import { getAudio } from '../juice/AudioManager';
import type { RunState } from '../sim/RunState';
import { resolveLevelUp, resolveToken } from '../sim/systems/EnergySystem';
import {
  FALLBACK_HEAL_FRACTION,
  applyOffer,
  banOffer,
  canBan,
  drawOffers,
  rerollOffers,
  type UpgradeOffer,
} from '../sim/upgrades/UpgradeSystem';

const CARD_W = 620;
const CARD_H = 300;
const CARD_GAP = 40;
const CARD_CENTER_Y = 880;
const ICON_SIZE = 130;
/** Input is ignored for this long after the menu opens (stray joystick taps). */
const INPUT_GUARD_MS = 250;
const CARD_FILL = 0x1e1640;
const CARD_FILL_HOVER = 0x2b2158;
/** Reroll / bans row below the cards (last card ends at y 1370; column is 1560 tall). */
const CONTROLS_Y = 1455;
const REROLL_W = 300;
const REROLL_H = 92;
const BAN_W = 112;
const BAN_H = 46;
/** Short input pause after a reroll/ban so a double tap doesn't pick a card mid-entrance. */
const REDRAW_GUARD_MS = 150;
const BTN_FILL = 0x2b2158;
const BTN_FILL_HOVER = 0x3a2d74;
const BAN_COLOR = 0xff4f6a;
const DISABLED_ALPHA = 0.35;

const KEY_TO_INDEX: Record<number, number> = {
  [Phaser.Input.Keyboard.KeyCodes.ONE]: 0,
  [Phaser.Input.Keyboard.KeyCodes.TWO]: 1,
  [Phaser.Input.Keyboard.KeyCodes.THREE]: 2,
  [Phaser.Input.Keyboard.KeyCodes.NUMPAD_ONE]: 0,
  [Phaser.Input.Keyboard.KeyCodes.NUMPAD_TWO]: 1,
  [Phaser.Input.Keyboard.KeyCodes.NUMPAD_THREE]: 2,
};

function cssColor(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** One-line effect text for an offer (Req 9.5). */
function offerDescription(state: RunState, offer: UpgradeOffer): string {
  switch (offer.kind) {
    case 'fallbackHeal':
      return `Restore ${Math.round(FALLBACK_HEAL_FRACTION * 100)}% HP`;
    case 'mutation':
      return state.config.mutations.find((m) => m.id === offer.mutationId)?.description ?? offer.name;
    case 'newPart':
    case 'levelUp': {
      const def = state.config.bodyParts.find((p) => p.id === offer.partId);
      if (!def) return offer.name;
      return describeLevelUp(def, offer.fromLevel ?? 0, offer.toLevel ?? (offer.fromLevel ?? 0) + 1);
    }
  }
}

function levelLine(offer: UpgradeOffer): string {
  if (offer.kind === 'mutation') return 'MUTATION';
  if (offer.kind === 'fallbackHeal') return 'HEAL';
  const from = offer.fromLevel ?? 0;
  if (from === 0) return 'NEW';
  return `Lv ${from} \u2192 ${offer.toLevel ?? from + 1}`;
}

export default class UpgradeScene extends Phaser.Scene {
  private offers: UpgradeOffer[] = [];
  private cards: Phaser.GameObjects.Container[] = [];
  private root!: Phaser.GameObjects.Container;
  private backdrop: Phaser.GameObjects.Rectangle | null = null;
  private ready = false;
  private done = false;
  /** Target of the current press ('card:i', 'ban:i', 'reroll'); activation needs release on the same target. */
  private pressed: string | null = null;
  private showHotkeys = false;
  private rerollBg: Phaser.GameObjects.Rectangle | null = null;
  private rerollBtn: Phaser.GameObjects.Container | null = null;
  private rerollText: Phaser.GameObjects.Text | null = null;
  private bansText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super(SCENE.upgrade);
  }

  create(): void {
    // Instance is reused across restarts: reset per-menu fields.
    this.offers = [];
    this.cards = [];
    this.ready = false;
    this.done = false;
    this.pressed = null;
    this.backdrop = null;
    this.rerollBg = null;
    this.rerollBtn = null;
    this.rerollText = null;
    this.bansText = null;

    const session = getSession();
    const state = session.sim.state;
    const { pendingLevelUps, pendingTokens } = state.energy;
    if (pendingLevelUps + pendingTokens <= 0 || state.outcome !== null) {
      this.scene.stop();
      return;
    }

    // Drawn once per menu (not on resize / re-layout).
    this.offers = drawOffers(state, state.rng.upgrades, 3);

    // Content lives in a GAME_WIDTH-wide column (root, local coords); the backdrop
    // covers the whole canvas. Resizes only re-position these two (offers stay drawn).
    const cx = GAME_WIDTH / 2;
    const backdrop = (this.backdrop = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.65)
      .setOrigin(0, 0));
    backdrop.setInteractive(); // swallow taps so they don't reach the HUD below
    backdrop.on('pointerup', () => {
      this.pressed = null;
    });
    this.root = this.add.container(0, 0);
    this.relayout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.relayout, this);
    keepFitted(this, () => this.relayout());

    const firstTop = CARD_CENTER_Y - CARD_H - CARD_GAP - CARD_H / 2;
    const title = this.add
      .text(cx, firstTop - 130, pendingLevelUps === 0 && pendingTokens > 0 ? 'Upgrade token!' : 'Level up!', {
        fontFamily: FONT,
        fontSize: '64px',
        fontStyle: 'bold',
        color: PALETTE.text,
        stroke: '#140f2e',
        strokeThickness: 8,
      })
      .setOrigin(0.5);
    this.root.add(title);

    const total = pendingLevelUps + pendingTokens;
    if (total > 1) {
      this.root.add(
        this.add
          .text(cx, firstTop - 66, `${total - 1} more`, { fontFamily: FONT, fontSize: '30px', color: PALETTE.textDim })
          .setOrigin(0.5),
      );
    }

    this.showHotkeys = session.input.mode === 'keyboard';
    this.offers.forEach((_, i) => {
      const card = this.renderCard(state, i);
      // Staggered slide/fade entrance.
      card.setAlpha(0);
      card.x = cx + 90;
      this.tweens.add({ targets: card, x: cx, alpha: 1, duration: 260, delay: 60 + i * 90, ease: 'Back.easeOut' });
    });
    this.buildControls(state);

    backdrop.setAlpha(0);
    this.tweens.add({ targets: backdrop, alpha: 1, duration: 180 });
    title.setScale(0.6);
    this.tweens.add({ targets: title, scale: 1, duration: 300, ease: 'Back.easeOut' });

    this.time.delayedCall(INPUT_GUARD_MS, () => {
      this.ready = true;
    });

    this.input.keyboard?.on('keydown', this.onKeyDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  private buildCard(
    state: RunState,
    offer: UpgradeOffer,
    index: number,
    x: number,
    y: number,
    showHotkey: boolean,
  ): Phaser.GameObjects.Container {
    const color = RARITY_COLOR[offer.rarity];
    const card = this.add.container(x, y);

    const bg = this.add.rectangle(0, 0, CARD_W, CARD_H, CARD_FILL, 0.96).setStrokeStyle(6, color);
    card.add(bg);

    const left = -CARD_W / 2;
    const top = -CARD_H / 2;

    card.add(
      this.add
        .text(left + 24, top + 18, offer.rarity.toUpperCase(), {
          fontFamily: FONT,
          fontSize: '24px',
          fontStyle: 'bold',
          color: cssColor(color),
        })
        .setOrigin(0, 0),
    );

    // Icon in a rarity-tinted well.
    const iconX = left + 24 + ICON_SIZE / 2;
    const iconY = 16;
    card.add(this.add.circle(iconX, iconY, ICON_SIZE / 2 + 8, color, 0.18).setStrokeStyle(3, color, 0.8));
    const iconKey = this.textures.exists(offer.icon) ? offer.icon : TEX.iconHeal;
    if (this.textures.exists(iconKey)) {
      const icon = this.add.image(iconX, iconY, iconKey);
      const s = ICON_SIZE / Math.max(1, icon.width, icon.height);
      icon.setScale(s);
      card.add(icon);
    }

    const textX = left + 24 + ICON_SIZE + 36;
    const textW = CARD_W / 2 - textX - 24;
    card.add(
      this.add.text(textX, top + 58, offer.name, {
        fontFamily: FONT,
        fontSize: '40px',
        fontStyle: 'bold',
        color: PALETTE.text,
        wordWrap: { width: textW },
      }),
    );
    card.add(
      this.add.text(textX, top + 112, levelLine(offer), {
        fontFamily: FONT,
        fontSize: '28px',
        fontStyle: 'bold',
        color: offer.kind === 'mutation' ? cssColor(RARITY_COLOR.epic) : '#fff6a8',
      }),
    );
    card.add(
      this.add.text(textX, top + 156, offerDescription(state, offer), {
        fontFamily: FONT,
        fontSize: '26px',
        color: PALETTE.textDim,
        wordWrap: { width: textW },
        maxLines: 3,
      }),
    );

    if (showHotkey) {
      const hx = CARD_W / 2 - 40;
      const hy = top + 40;
      card.add(this.add.circle(hx, hy, 24, 0x000000, 0.4).setStrokeStyle(2, color));
      card.add(
        this.add
          .text(hx, hy, String(index + 1), { fontFamily: FONT, fontSize: '28px', fontStyle: 'bold', color: PALETTE.text })
          .setOrigin(0.5),
      );
    }

    // Whole card is the hit area. Selection requires press + release on the same card.
    this.wirePress(bg, card, `card:${index}`, 1, () => this.select(index), (hover) =>
      bg.setFillStyle(hover ? CARD_FILL_HOVER : CARD_FILL, 0.96),
    );

    // Ban control (Req 25.3, 25.5, 25.6): only new parts can be banned; dimmed at 0 Bans.
    if (offer.kind === 'newPart') {
      const bx = CARD_W / 2 - BAN_W / 2 - 18;
      const by = CARD_H / 2 - BAN_H / 2 - 14;
      const ban = this.add.container(bx, by);
      const banBg = this.add.rectangle(0, 0, BAN_W, BAN_H, 0x000000, 0.45).setStrokeStyle(3, BAN_COLOR);
      ban.add(banBg);
      ban.add(
        this.add
          .text(0, 0, '\u2715 Ban', { fontFamily: FONT, fontSize: '24px', fontStyle: 'bold', color: cssColor(BAN_COLOR) })
          .setOrigin(0.5),
      );
      card.add(ban);
      if (canBan(state, offer)) {
        this.wirePress(banBg, ban, `ban:${index}`, 1, () => this.ban(index), (hover) =>
          banBg.setFillStyle(hover ? 0x4a1020 : 0x000000, hover ? 0.8 : 0.45),
        );
      } else {
        ban.setAlpha(DISABLED_ALPHA);
      }
    }

    return card;
  }

  /**
   * Press-and-release-on-same-target button behaviour shared by cards, Ban and
   * Reroll. `base` is the resting scale of `visual`.
   */
  private wirePress(
    hit: Phaser.GameObjects.Rectangle,
    visual: Phaser.GameObjects.Container,
    id: string,
    base: number,
    activate: () => void,
    onHover: (hover: boolean) => void,
  ): void {
    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => {
      onHover(true);
      visual.setScale(base * 1.02);
    });
    hit.on('pointerout', () => {
      onHover(false);
      visual.setScale(base);
      if (this.pressed === id) this.pressed = null;
    });
    hit.on('pointerdown', () => {
      if (!this.ready || this.done) return;
      this.pressed = id;
      visual.setScale(base * 0.97);
    });
    hit.on('pointerup', () => {
      visual.setScale(base * 1.02);
      const hit2 = this.pressed === id;
      this.pressed = null;
      if (hit2) activate();
    });
  }

  /** Builds (or rebuilds) the card for slot `i` in place inside the root container. */
  private renderCard(state: RunState, i: number): Phaser.GameObjects.Container {
    const old = this.cards[i];
    if (old) {
      this.tweens.killTweensOf(old);
      old.destroy();
    }
    const y = CARD_CENTER_Y + (i - 1) * (CARD_H + CARD_GAP);
    const card = this.buildCard(state, this.offers[i], i, GAME_WIDTH / 2, y, this.showHotkeys);
    this.cards[i] = card;
    this.root.add(card);
    return card;
  }

  /** Rebuilds the given slots with a short pop-in and refreshes the counters. */
  private redrawSlots(state: RunState, slots: readonly number[]): void {
    for (const i of slots) {
      const card = this.renderCard(state, i);
      card.setAlpha(0).setScale(0.92);
      this.tweens.add({ targets: card, alpha: 1, scale: 1, duration: 140, delay: slots.length > 1 ? i * 40 : 0, ease: 'Back.easeOut' });
    }
    // Ban buttons on untouched new-part cards must show as disabled once Bans hit 0.
    if (state.build.bans <= 0) {
      for (let i = 0; i < this.cards.length; i++) {
        if (!slots.includes(i) && this.offers[i]?.kind === 'newPart') this.renderCard(state, i);
      }
    }
    this.refreshControls(state);
    this.ready = false;
    this.time.delayedCall(REDRAW_GUARD_MS, () => {
      this.ready = true;
    });
  }

  /** Reroll button + "Bans left" label below the cards (Req 25.2, 25.4, 25.5). */
  private buildControls(state: RunState): void {
    const rx = GAME_WIDTH / 2 - 160;
    const btn = (this.rerollBtn = this.add.container(rx, CONTROLS_Y));
    const bg = (this.rerollBg = this.add
      .rectangle(0, 0, REROLL_W, REROLL_H, BTN_FILL, 0.96)
      .setStrokeStyle(4, RARITY_COLOR.rare));
    btn.add(bg);
    this.rerollText = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: PALETTE.text })
      .setOrigin(0.5);
    btn.add(this.rerollText);
    this.root.add(btn);
    this.wirePress(bg, btn, 'reroll', 1, () => this.reroll(), (hover) =>
      bg.setFillStyle(hover ? BTN_FILL_HOVER : BTN_FILL, 0.96),
    );

    this.bansText = this.add
      .text(GAME_WIDTH / 2 + 170, CONTROLS_Y, '', {
        fontFamily: FONT,
        fontSize: '32px',
        fontStyle: 'bold',
        color: cssColor(BAN_COLOR),
      })
      .setOrigin(0.5);
    this.root.add(this.bansText);
    this.refreshControls(state);
  }

  private refreshControls(state: RunState): void {
    const { rerolls, bans } = state.build;
    if (this.rerollText) this.rerollText.setText(`Reroll (${rerolls})${this.showHotkeys ? '  [R]' : ''}`);
    if (this.rerollBg && this.rerollBtn) {
      if (rerolls > 0) {
        if (!this.rerollBg.input) this.rerollBg.setInteractive({ useHandCursor: true });
        else this.rerollBg.input.enabled = true;
        this.rerollBtn.setAlpha(1);
      } else {
        this.rerollBg.disableInteractive();
        this.rerollBg.setFillStyle(BTN_FILL, 0.96);
        this.rerollBtn.setAlpha(DISABLED_ALPHA).setScale(1);
      }
    }
    if (this.bansText) this.bansText.setText(`Bans left: ${bans}`).setAlpha(bans > 0 ? 1 : DISABLED_ALPHA);
  }

  /** Reroll all offers (no-op at 0 Rerolls). */
  private reroll(): void {
    if (!this.ready || this.done) return;
    const state = getSession().sim.state;
    const next = rerollOffers(state, state.rng.upgrades, this.offers);
    if (!next) return;
    getAudio().play(SFX.click);
    this.offers = next;
    this.redrawSlots(state, next.map((_, i) => i));
  }

  /** Ban the new part in `slot` and redraw just that card (no-op if not bannable). */
  private ban(slot: number): void {
    if (!this.ready || this.done) return;
    const state = getSession().sim.state;
    const next = banOffer(state, state.rng.upgrades, this.offers, slot);
    if (!next) return;
    getAudio().play(SFX.click);
    this.offers = next;
    this.redrawSlots(state, [slot]);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.keyCode === Phaser.Input.Keyboard.KeyCodes.R) {
      this.reroll();
      return;
    }
    const index = KEY_TO_INDEX[event.keyCode];
    if (index === undefined) return;
    this.select(index);
  }

  private select(index: number): void {
    if (!this.ready || this.done) return;
    const offer = this.offers[index];
    if (!offer) return;
    this.done = true;

    getAudio().play(SFX.click);
    const state = getSession().sim.state;
    applyOffer(state, offer);
    if (state.energy.pendingLevelUps > 0) resolveLevelUp(state);
    else resolveToken(state);

    if (state.paused === 'menu') this.scene.restart();
    else this.scene.stop();
  }

  /** Canvas resize: stretch the backdrop and re-centre the content column (no redraw). */
  private relayout(): void {
    const { width, height, ox, oy } = columnLayout(this);
    this.backdrop?.setSize(width, height);
    this.root?.setPosition(ox, oy);
  }

  private onShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.relayout, this);
    this.input.keyboard?.off('keydown', this.onKeyDown, this);
    this.tweens.killAll();
    this.cards = [];
    this.offers = [];
  }
}
