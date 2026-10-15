/**
 * ResultsScene (task 10.5, Req 15.1–15.3, 17.3, 20.6): end-of-run summary.
 *
 * Shows a dawn (victory) or night (defeat) backdrop, a static portrait of the
 * final monster build, a stats card (outcome, survival time, kills, level-ups,
 * parts with levels, mutations, seed) and two big buttons:
 *   "Another night" → sim.restart() in place + GameScene (which relaunches HUD and music)
 *   "Title"         → TitleScene
 * Input is ignored for the first 600 ms so a tap that ended the run can't skip the screen.
 */
import Phaser from 'phaser';
import { FONT, GAME_HEIGHT, GAME_WIDTH, PALETTE, SCENE, SFX } from '../game/keys';
import { getSession } from '../game/Session';
import { getAudio } from '../juice/AudioManager';
import { PlayerRenderer } from '../render/PlayerRenderer';
import type { RunState } from '../sim/RunState';

const INPUT_GRACE_MS = 600;
const PORTRAIT_SCALE = 2.2;
const PORTRAIT_Y = 470;
const BUTTON_H = 112;

/** m:ss of a duration in seconds. */
function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function partsSummary(state: RunState): { count: number; list: string } {
  const names: string[] = [];
  for (const def of state.config.bodyParts) {
    const owned = state.build.parts.get(def.id);
    if (owned) names.push(`${def.name} Lv${owned.level}`);
  }
  return { count: names.length, list: names.length > 0 ? names.join(', ') : '—' };
}

function mutationsSummary(state: RunState): string {
  const names = state.config.mutations.filter((m) => state.build.mutations.has(m.id)).map((m) => m.name);
  return names.length > 0 ? names.join(', ') : '—';
}

export default class ResultsScene extends Phaser.Scene {
  private portrait: PlayerRenderer | null = null;
  private createdAt = 0;
  private leaving = false;

  constructor() {
    super(SCENE.results);
  }

  create(): void {
    // Scene instance is reused across runs: reset per-visit fields.
    this.leaving = false;
    this.createdAt = this.time.now;
    this.portrait = null;

    const session = getSession();
    const state = session.sim.state;
    const victory = state.outcome === 'victory';
    const cx = GAME_WIDTH / 2;
    this.cameras.main.setBackgroundColor(victory ? PALETTE.dawn : PALETTE.night);

    this.drawBackdrop(victory);

    // Headline.
    this.add
      .text(cx, 150, victory ? 'You survived the night!' : 'The night took you…', {
        fontFamily: FONT,
        fontSize: '60px',
        fontStyle: 'bold',
        color: PALETTE.text,
        align: 'center',
        stroke: '#0b0716',
        strokeThickness: 10,
        wordWrap: { width: GAME_WIDTH - 60 },
      })
      .setOrigin(0.5);

    // Portrait on a pedestal.
    const pedestal = this.add.graphics();
    pedestal.fillStyle(0x000000, 0.35);
    pedestal.fillEllipse(cx, PORTRAIT_Y + 120, 300, 64);
    pedestal.fillStyle(victory ? 0xffe2a8 : 0x3a2878, 0.6);
    pedestal.fillEllipse(cx, PORTRAIT_Y + 112, 240, 44);

    const portrait = new PlayerRenderer(this, state, { interactive: false });
    // sync() owns the inner container's scale (idle squash), so scale a wrapper instead.
    const frame = this.add.container(cx, PORTRAIT_Y, [portrait.container]).setScale(PORTRAIT_SCALE);
    frame.setDepth(10);
    portrait.sync(0, 0, this.time.now);
    this.portrait = portrait;

    this.drawStatsCard(state, victory);

    // Buttons.
    this.makeButton(cx, 1340, 480, BUTTON_H, 'Another night', '50px', () => this.anotherNight());
    this.makeButton(cx, 1470, 320, BUTTON_H - 16, 'Title', '42px', () => this.toTitle());
    this.input.keyboard?.on('keydown-ENTER', () => this.anotherNight());
    this.input.keyboard?.on('keydown-SPACE', () => this.anotherNight());

    // Analytics once per results visit (= once per run).
    session.platform.track('run_ended', {
      outcome: state.outcome ?? 'unknown',
      survivalSec: Math.floor(state.clock.elapsed),
      kills: state.stats.kills,
      levelUps: state.energy.levelUps,
      seed: state.seed,
    });

    // Music: keep the loop going after a victory, silence it after a defeat.
    if (!victory) {
      try {
        getAudio().stopMusic();
      } catch {
        // Audio is optional.
      }
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  update(time: number): void {
    // Gentle idle (squash + part wobble) around the wrapper's origin.
    this.portrait?.sync(0, Math.sin(time * 0.002) * 4, time);
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  private drawBackdrop(victory: boolean): void {
    const cx = GAME_WIDTH / 2;
    const bg = this.add.graphics();
    if (victory) {
      // Warm dawn: violet top fading to peach/gold at the horizon.
      bg.fillGradientStyle(0x3a2a6e, 0x3a2a6e, 0xf2a16b, 0xf2a16b, 1);
      bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT * 0.55);
      bg.fillGradientStyle(0xf2a16b, 0xf2a16b, PALETTE.dawn, PALETTE.dawn, 1);
      bg.fillRect(0, GAME_HEIGHT * 0.55, GAME_WIDTH, GAME_HEIGHT * 0.45);

      // Rising sun with a soft glow, behind the portrait.
      const sun = this.add.graphics();
      sun.fillStyle(0xffe9a8, 0.25);
      sun.fillCircle(0, 0, 210);
      sun.fillStyle(0xffd27a, 0.5);
      sun.fillCircle(0, 0, 160);
      sun.fillStyle(0xfff3c4, 1);
      sun.fillCircle(0, 0, 120);
      sun.setPosition(cx, PORTRAIT_Y + 260);
      this.tweens.add({ targets: sun, y: PORTRAIT_Y - 40, duration: 2600, ease: 'Sine.easeOut' });
      this.tweens.add({
        targets: sun,
        scale: 1.04,
        duration: 1400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        delay: 2600,
      });
    } else {
      // Deep night with a few dim stars and a pale moon.
      bg.fillGradientStyle(0x07051a, 0x07051a, PALETTE.night, PALETTE.night, 1);
      bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT * 0.6);
      bg.fillGradientStyle(PALETTE.night, PALETTE.night, 0x2a1850, 0x2a1850, 1);
      bg.fillRect(0, GAME_HEIGHT * 0.6, GAME_WIDTH, GAME_HEIGHT * 0.4);
      const stars = this.add.graphics();
      for (let i = 0; i < 40; i++) {
        // Deterministic scatter (no RNG needed for decoration).
        const x = (i * 157.3) % GAME_WIDTH;
        const y = (i * 97.1) % (GAME_HEIGHT * 0.5);
        stars.fillStyle(0xf4f1ff, 0.25 + ((i * 37) % 50) / 100);
        stars.fillCircle(x, y, 1.5 + (i % 3));
      }
      this.tweens.add({ targets: stars, alpha: 0.6, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const moon = this.add.graphics();
      moon.fillStyle(0xd8d4f0, 0.8);
      moon.fillCircle(590, 290, 54);
      moon.fillStyle(0x07051a, 1);
      moon.fillCircle(612, 274, 48);
    }
  }

  private drawStatsCard(state: RunState, victory: boolean): void {
    const cx = GAME_WIDTH / 2;
    const top = 680;
    const w = GAME_WIDTH - 80;
    const h = 570;
    const card = this.add.graphics();
    card.fillStyle(0x0b0716, 0.78);
    card.fillRoundedRect(cx - w / 2, top, w, h, 28);
    card.lineStyle(4, victory ? PALETTE.dawn : PALETTE.playerRim, 0.6);
    card.strokeRoundedRect(cx - w / 2, top, w, h, 28);

    const parts = partsSummary(state);
    const rows: Array<[string, string]> = [
      ['Outcome', victory ? 'Victory' : 'Defeat'],
      ['Survival time', formatTime(state.clock.elapsed)],
      ['Kills', String(state.stats.kills)],
      ['Level-ups', String(state.energy.levelUps)],
      ['Parts built', String(parts.count)],
    ];
    const left = cx - w / 2 + 40;
    const right = cx + w / 2 - 40;
    const labelStyle = { fontFamily: FONT, fontSize: '32px', color: PALETTE.textDim };
    const valueStyle = { fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: PALETTE.text };
    let y = top + 36;
    for (const [label, value] of rows) {
      this.add.text(left, y, label, labelStyle);
      this.add.text(right, y, value, valueStyle).setOrigin(1, 0);
      y += 52;
    }

    const wrapStyle = {
      fontFamily: FONT,
      fontSize: '26px',
      color: PALETTE.text,
      wordWrap: { width: w - 80 },
      lineSpacing: 4,
    };
    const partsText = this.add.text(left, y, parts.list, wrapStyle);
    y += partsText.height + 16;
    this.add.text(left, y, 'Mutations', labelStyle);
    y += 42;
    this.add.text(left, y, mutationsSummary(state), { ...wrapStyle, color: '#e0b8ff' });

    // Seed (Req 17.3), small text at the card's bottom.
    this.add
      .text(cx, top + h - 20, `Seed ${state.seed}`, { fontFamily: FONT, fontSize: '22px', color: PALETTE.textDim })
      .setOrigin(0.5, 1);
  }

  private makeButton(
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    fontSize: string,
    onTap: () => void,
  ): void {
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
    this.add.text(x, y, text, { fontFamily: FONT, fontSize, fontStyle: 'bold', color: PALETTE.text }).setOrigin(0.5);
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => draw(true));
    zone.on('pointerout', () => draw(false));
    zone.on('pointerup', onTap);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private canAct(): boolean {
    return !this.leaving && this.time.now - this.createdAt >= INPUT_GRACE_MS;
  }

  private click(): void {
    try {
      getAudio().play(SFX.click);
    } catch {
      // Audio is optional.
    }
  }

  private anotherNight(): void {
    if (!this.canAct()) return;
    this.leaving = true;
    this.click();
    const session = getSession();
    // In-place reset (Req 15.2–15.3); new random seed unless ?seed= pins it.
    session.sim.restart(session.flags.seed);
    this.scene.start(SCENE.game);
  }

  private toTitle(): void {
    if (!this.canAct()) return;
    this.leaving = true;
    this.click();
    this.scene.start(SCENE.title);
  }

  private onShutdown(): void {
    this.portrait?.destroy();
    this.portrait = null;
    // Keyboard listeners are scene-scoped plugins but persist across restarts; drop ours.
    this.input.keyboard?.off('keydown-ENTER');
    this.input.keyboard?.off('keydown-SPACE');
  }
}
