/**
 * UpgradeScene (Req 8.4, 9.4–9.7, 10.3, 18.4, 20.2): the level-up / token menu.
 *
 * GameScene launches this scene while `sim.state.paused === 'menu'`. Offers are
 * drawn once per menu in create(). Picking one applies it, resolves one pending
 * level-up (or token) and either restarts this scene for the next pending pick
 * (8.4 overflow) or stops it, which resumes the run.
 */
import Phaser from 'phaser';
import { describeLevelUp } from '../game/describe';
import { FONT, GAME_HEIGHT, GAME_WIDTH, PALETTE, RARITY_COLOR, SCENE, SFX, TEX } from '../game/keys';
import { getSession } from '../game/Session';
import { getAudio } from '../juice/AudioManager';
import type { RunState } from '../sim/RunState';
import { resolveLevelUp, resolveToken } from '../sim/systems/EnergySystem';
import { FALLBACK_HEAL_FRACTION, applyOffer, drawOffers, type UpgradeOffer } from '../sim/upgrades/UpgradeSystem';

const CARD_W = 620;
const CARD_H = 300;
const CARD_GAP = 40;
const CARD_CENTER_Y = 880;
const ICON_SIZE = 130;
/** Input is ignored for this long after the menu opens (stray joystick taps). */
const INPUT_GUARD_MS = 250;
const CARD_FILL = 0x1e1640;
const CARD_FILL_HOVER = 0x2b2158;

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
  private ready = false;
  private done = false;
  private pressed = -1;

  constructor() {
    super(SCENE.upgrade);
  }

  create(): void {
    // Instance is reused across restarts: reset per-menu fields.
    this.offers = [];
    this.cards = [];
    this.ready = false;
    this.done = false;
    this.pressed = -1;

    const session = getSession();
    const state = session.sim.state;
    const { pendingLevelUps, pendingTokens } = state.energy;
    if (pendingLevelUps + pendingTokens <= 0 || state.outcome !== null) {
      this.scene.stop();
      return;
    }

    // Drawn once per menu (not on resize / re-layout).
    this.offers = drawOffers(state, state.rng.upgrades, 3);

    const cx = GAME_WIDTH / 2;
    this.root = this.add.container(0, 0);

    const backdrop = this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.65);
    backdrop.setInteractive(); // swallow taps so they don't reach the HUD below
    backdrop.on('pointerup', () => {
      this.pressed = -1;
    });
    this.root.add(backdrop);

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

    const showHotkeys = session.input.mode === 'keyboard';
    this.offers.forEach((offer, i) => {
      const y = CARD_CENTER_Y + (i - 1) * (CARD_H + CARD_GAP);
      const card = this.buildCard(state, offer, i, cx, y, showHotkeys);
      this.cards.push(card);
      this.root.add(card);
      // Staggered slide/fade entrance.
      card.setAlpha(0);
      card.x = cx + 90;
      this.tweens.add({ targets: card, x: cx, alpha: 1, duration: 260, delay: 60 + i * 90, ease: 'Back.easeOut' });
    });

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
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => {
      bg.setFillStyle(CARD_FILL_HOVER, 0.96);
      card.setScale(1.02);
    });
    bg.on('pointerout', () => {
      bg.setFillStyle(CARD_FILL, 0.96);
      card.setScale(1);
      if (this.pressed === index) this.pressed = -1;
    });
    bg.on('pointerdown', () => {
      if (!this.ready || this.done) return;
      this.pressed = index;
      card.setScale(0.97);
    });
    bg.on('pointerup', () => {
      card.setScale(1.02);
      if (this.pressed === index) this.select(index);
      this.pressed = -1;
    });

    return card;
  }

  private onKeyDown(event: KeyboardEvent): void {
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

  private onShutdown(): void {
    this.input.keyboard?.off('keydown', this.onKeyDown, this);
    this.tweens.killAll();
    this.cards = [];
    this.offers = [];
  }
}
