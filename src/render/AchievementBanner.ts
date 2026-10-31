/**
 * AchievementBanner (Req 32): the honored unlock presentation — a
 * gold-trimmed plaque with a medal that slides in from the top, holds,
 * and leaves. Deliberately grander than the small utility toasts, and it
 * queues multiple unlocks one at a time so nothing overlaps or is lost.
 *
 * Pure presentation: callers pass name/description; the banner owns its
 * tweens and cleans up with the scene.
 */
import Phaser from 'phaser';
import { FONT, PALETTE, SFX } from '../game/keys';
import { getAudio } from '../juice/AudioManager';

const PLAQUE_W = 600;
const PLAQUE_H = 140;
const HOLD_MS = 3400;
const GOLD = 0xffd166;
const GOLD_DARK = 0xb8862f;

interface Queued {
  name: string;
  description: string;
}

export class AchievementBanner {
  private readonly root: Phaser.GameObjects.Container;
  private readonly glow: Phaser.GameObjects.Graphics;
  private readonly medal: Phaser.GameObjects.Graphics;
  private readonly kicker: Phaser.GameObjects.Text;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly descText: Phaser.GameObjects.Text;
  private readonly queue: Queued[] = [];
  private busy = false;
  private readonly homeY: number;

  /** (x, y) = plaque centre once slid in. Starts hidden above it. */
  constructor(
    private readonly scene: Phaser.Scene,
    x: number,
    y: number,
  ) {
    this.homeY = y;
    const w = PLAQUE_W;
    const h = PLAQUE_H;

    const glow = scene.add.graphics();
    glow.fillStyle(0xffd166, 0.16);
    glow.fillCircle(0, 0, 74);
    glow.fillStyle(0xffd166, 0.12);
    glow.fillCircle(0, 0, 100);
    glow.setPosition(-w / 2 + 78, 0);
    this.glow = glow;

    const plaque = scene.add.graphics();
    plaque.fillStyle(0x160f2e, 0.97);
    plaque.fillRoundedRect(-w / 2, -h / 2, w, h, 22);
    plaque.lineStyle(5, GOLD, 1);
    plaque.strokeRoundedRect(-w / 2, -h / 2, w, h, 22);
    plaque.lineStyle(2, GOLD_DARK, 0.9);
    plaque.strokeRoundedRect(-w / 2 + 9, -h / 2 + 9, w - 18, h - 18, 16);
    // Claw-slash accents on the top corners.
    plaque.lineStyle(4, GOLD, 0.85);
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const cx = sx * (w / 2 - 26 - i * 13);
        plaque.lineBetween(cx, -h / 2 + 6, cx - sx * 7, -h / 2 + 24);
      }
    }

    const medal = scene.add.graphics();
    medal.setPosition(-w / 2 + 78, 0);
    // Ribbons.
    medal.fillStyle(0xc0392b, 1);
    medal.fillTriangle(-20, -6, -4, -6, -24, 34);
    medal.fillTriangle(20, -6, 4, -6, 24, 34);
    // Disc + rim.
    medal.fillStyle(GOLD_DARK, 1);
    medal.fillCircle(0, -8, 36);
    medal.fillStyle(GOLD, 1);
    medal.fillCircle(0, -8, 30);
    medal.fillStyle(0xffe9a8, 1);
    medal.fillCircle(0, -8, 22);
    // Fang marks.
    medal.fillStyle(0x7a5310, 1);
    medal.fillTriangle(-13, -20, -5, -20, -9, -4);
    medal.fillTriangle(5, -20, 13, -20, 9, -4);
    medal.fillCircle(0, 2, 3.5);
    this.medal = medal;

    const textX = -w / 2 + 136;
    this.kicker = scene.add
      .text(textX, -44, 'ACHIEVEMENT UNLOCKED', {
        fontFamily: FONT,
        fontSize: '21px',
        fontStyle: 'bold',
        color: '#ffd166',
      })
      .setOrigin(0, 0.5);
    this.nameText = scene.add
      .text(textX, -6, '', {
        fontFamily: FONT,
        fontSize: '42px',
        fontStyle: 'bold',
        color: PALETTE.text,
        stroke: '#0b0716',
        strokeThickness: 7,
      })
      .setOrigin(0, 0.5);
    this.descText = scene.add
      .text(textX, 32, '', { fontFamily: FONT, fontSize: '24px', color: PALETTE.textDim })
      .setOrigin(0, 0.5);

    this.root = scene.add
      .container(x, y - 260, [glow, plaque, medal, this.kicker, this.nameText, this.descText])
      .setDepth(400)
      .setAlpha(0)
      .setVisible(false);
  }

  /** Queues an unlock plaque. `delayMs` lets a preceding small toast read first. */
  show(name: string, description: string, delayMs = 0): void {
    this.queue.push({ name, description });
    if (!this.busy) {
      if (delayMs > 0) {
        this.busy = true;
        this.scene.time.delayedCall(delayMs, () => {
          this.busy = false;
          this.next();
        });
      } else {
        this.next();
      }
    }
  }

  private next(): void {
    const item = this.queue.shift();
    if (!item) {
      this.busy = false;
      return;
    }
    this.busy = true;
    this.nameText.setText(item.name);
    this.descText.setText(item.description);
    this.root.setY(this.homeY - 260).setAlpha(0).setVisible(true).setScale(0.92);
    this.medal.setScale(0.4);
    this.glow.setAlpha(0);
    getAudio().play(SFX.levelUp);

    this.scene.tweens.add({
      targets: this.root,
      y: this.homeY,
      alpha: 1,
      scale: 1,
      duration: 480,
      ease: 'Back.easeOut',
    });
    this.scene.tweens.add({ targets: this.medal, scale: 1, duration: 520, delay: 120, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: this.glow, alpha: 1, duration: 600, delay: 150, yoyo: true, repeat: 2 });
    this.scene.time.delayedCall(HOLD_MS, () => {
      this.scene.tweens.add({
        targets: this.root,
        y: this.homeY - 240,
        alpha: 0,
        duration: 420,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          this.root.setVisible(false);
          this.busy = false;
          this.next();
        },
      });
    });
  }
}
