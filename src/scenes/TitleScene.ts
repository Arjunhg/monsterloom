import Phaser from 'phaser';
import { getSession, type Settings } from '../game/Session';
import { FONT, GAME_HEIGHT, GAME_WIDTH, PALETTE, SCENE, TEX } from '../game/keys';
import { getAudio } from '../juice/AudioManager';

let runStartedFired = false;

type ToggleKey = keyof Settings;

interface ToggleDef {
  label: string;
  key: ToggleKey;
  /** settings value that means "on" for display purposes */
  isOn: (s: Settings) => boolean;
  flip: (s: Settings) => void;
}

const TOGGLES: ToggleDef[] = [
  { label: 'Music', key: 'musicMuted', isOn: (s) => !s.musicMuted, flip: (s) => (s.musicMuted = !s.musicMuted) },
  { label: 'Sound', key: 'sfxMuted', isOn: (s) => !s.sfxMuted, flip: (s) => (s.sfxMuted = !s.sfxMuted) },
  {
    label: 'Screen shake',
    key: 'shakeEnabled',
    isOn: (s) => s.shakeEnabled,
    flip: (s) => (s.shakeEnabled = !s.shakeEnabled),
  },
];

/** Title screen: start button + session settings toggles (Req 1.5, 18.6–18.7). */
export default class TitleScene extends Phaser.Scene {
  private starting = false;

  constructor() {
    super(SCENE.title);
  }

  create(): void {
    this.starting = false;
    const cx = GAME_WIDTH / 2;

    // Night backdrop: vertical gradient + dim ground tiles + vignette.
    const bg = this.add.graphics();
    bg.fillGradientStyle(PALETTE.night, PALETTE.night, 0x2a1850, 0x2a1850, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.add.tileSprite(0, GAME_HEIGHT * 0.45, GAME_WIDTH, GAME_HEIGHT * 0.55, TEX.ground).setOrigin(0, 0).setAlpha(0.7);
    this.add.image(cx, GAME_HEIGHT / 2, TEX.vignette).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);

    // Moon.
    const moon = this.add.graphics();
    moon.fillStyle(PALETTE.dawn, 0.9);
    moon.fillCircle(560, 200, 70);
    moon.fillStyle(PALETTE.night, 1);
    moon.fillCircle(590, 180, 62);

    // Title.
    this.add
      .text(cx, 360, 'Monster Mash\nSurvivor', {
        fontFamily: FONT,
        fontSize: '84px',
        fontStyle: 'bold',
        color: PALETTE.text,
        align: 'center',
        stroke: '#0b0716',
        strokeThickness: 10,
      })
      .setOrigin(0.5);

    // Bobbing player blob.
    const blob = this.add.image(cx, 640, TEX.playerBody).setScale(3);
    this.tweens.add({ targets: blob, y: 610, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // Start button (big tap target, Req 1.5).
    this.makeButton(cx, 880, 460, 130, 'Start Night', '56px', () => this.startRun());

    // Settings toggles.
    const settings = getSession().settings;
    TOGGLES.forEach((t, i) => {
      const y = 1080 + i * 120;
      const label = (): string => `${t.label}: ${t.isOn(settings) ? 'On' : 'Off'}`;
      const btn = this.makeButton(cx, y, 420, 96, label(), '38px', () => {
        t.flip(settings);
        btn.setText(label());
      });
    });

    this.add
      .text(cx, GAME_HEIGHT - 80, 'Drag to move. Survive till dawn.', {
        fontFamily: FONT,
        fontSize: '30px',
        color: PALETTE.textDim,
      })
      .setOrigin(0.5);

    // First interaction unlocks audio (Req 18.7).
    this.input.once('pointerdown', () => this.unlockAudio());
    this.input.keyboard?.once('keydown', () => this.unlockAudio());
    this.input.keyboard?.on('keydown-ENTER', () => this.startRun());
    this.input.keyboard?.on('keydown-SPACE', () => this.startRun());
  }

  private makeButton(
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    fontSize: string,
    onTap: () => void,
  ): Phaser.GameObjects.Text {
    const plate = this.add.graphics();
    const draw = (hover: boolean): void => {
      plate.clear();
      plate.fillStyle(0x0b0716, 0.9);
      plate.fillRoundedRect(x - w / 2, y - h / 2 + 6, w, h, 24);
      plate.fillStyle(hover ? 0x4a3590 : 0x3a2878, 1);
      plate.fillRoundedRect(x - w / 2, y - h / 2, w, h, 24);
      plate.lineStyle(4, PALETTE.playerRim, hover ? 1 : 0.7);
      plate.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 24);
    };
    draw(false);
    const label = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize, fontStyle: 'bold', color: PALETTE.text })
      .setOrigin(0.5);
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => draw(true));
    zone.on('pointerout', () => draw(false));
    zone.on('pointerup', () => {
      this.unlockAudio();
      onTap();
    });
    return label;
  }

  private unlockAudio(): void {
    const session = getSession();
    // Unlock directly too; the window event alone is lost if nothing is listening yet.
    getAudio().unlock();
    if (session.audioUnlocked) return;
    session.audioUnlocked = true;
    (this.sound as unknown as { unlock?: () => void }).unlock?.();
    window.dispatchEvent(new Event('mms-audio-unlock'));
  }

  private startRun(): void {
    if (this.starting) return;
    this.starting = true;
    this.unlockAudio();
    const session = getSession();
    session.sim.restart(session.flags.seed);
    session.platform.track('run_started');
    if (!runStartedFired) {
      runStartedFired = true;
      session.platform.funnel(3, 'run_started', 'boot', 1);
    }
    this.scene.start(SCENE.game);
  }
}
