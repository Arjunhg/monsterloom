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
import { columnLayout, onResizeSettled, type ColumnLayout } from '../game/layout';
import { getSession, syncMetaBonuses, type RunMode } from '../game/Session';
import { dailyScore, submitPendingDailyScore } from '../meta/DailyChallenge';
import { META_CURRENCY_NAME } from '../meta/MetaProgression';
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
  private layout: ColumnLayout = { width: GAME_WIDTH, height: GAME_HEIGHT, ox: 0, oy: 0 };
  private createdAt = 0;
  private leaving = false;
  /** Bones awarded for this visit's run (task 20); null until awarded. */
  private metaReward: number | null = null;
  private bonesValueText: Phaser.GameObjects.Text | null = null;
  /** Finished-run stats snapshot, taken at create so a fast restart can't skew the reward. */
  private runSummary = { elapsed: 0, kills: 0, victory: false };
  /** Daily-run context snapshot (task 21). */
  private runKind: RunMode = 'normal';
  private runDailyDate: string | null = null;
  private dailyStatus = '';
  private dailyStatusText: Phaser.GameObjects.Text | null = null;
  private dailySubmitFailed = false;
  private submittingDaily = false;
  private visitAlive = false;

  constructor() {
    super(SCENE.results);
  }

  create(data?: { relayout?: boolean }): void {
    // A relayout is a restart triggered by a canvas resize: same visit, so the
    // run-ended analytics / music logic below must not run again.
    const relayout = data?.relayout === true;
    // Scene instance is reused across runs: reset per-visit fields.
    this.leaving = false;
    this.visitAlive = true;
    this.bonesValueText = null;
    this.dailyStatusText = null;
    if (!relayout) {
      this.metaReward = null;
      const session = getSession();
      const st = session.sim.state;
      this.runSummary = { elapsed: st.clock.elapsed, kills: st.stats.kills, victory: st.outcome === 'victory' };
      this.runKind = session.runMode;
      this.runDailyDate = session.dailyDate;
      this.dailyStatus = '';
      this.dailySubmitFailed = false;
      this.submittingDaily = false;
    }
    if (!relayout) this.createdAt = this.time.now;
    this.portrait = null;

    const session = getSession();
    const state = session.sim.state;
    const victory = state.outcome === 'victory';
    const L = (this.layout = columnLayout(this));
    const cx = L.width / 2;
    const oy = L.oy;
    this.cameras.main.setBackgroundColor(victory ? PALETTE.dawn : PALETTE.night);

    this.drawBackdrop(victory);

    // Headline.
    this.add
      .text(cx, oy + 150, victory ? 'You survived the night!' : 'The night took you…', {
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
    pedestal.fillEllipse(cx, oy + PORTRAIT_Y + 120, 300, 64);
    pedestal.fillStyle(victory ? 0xffe2a8 : 0x3a2878, 0.6);
    pedestal.fillEllipse(cx, oy + PORTRAIT_Y + 112, 240, 44);

    const portrait = new PlayerRenderer(this, state, { interactive: false });
    // sync() owns the inner container's scale (idle squash), so scale a wrapper instead.
    const frame = this.add.container(cx, oy + PORTRAIT_Y, [portrait.container]).setScale(PORTRAIT_SCALE);
    frame.setDepth(10);
    portrait.sync(0, 0, this.time.now);
    this.portrait = portrait;

    // Meta reward (task 20): award once per visit, after the boot load has
    // settled so a late load can't clobber the reward. Save is async; a
    // failure only toasts — state stays in memory and retries next run end.
    if (!relayout) {
      if (session.meta.loadOutcome !== 'not-loaded') this.awardMeta();
      else void session.metaReady.then(() => this.awardMeta());
    }

    // Ranked daily submission (task 21): record first so the score survives
    // until accepted, then submit. Failure shows on the card's status line
    // with tap-to-retry (non-blocking, Req 27.6).
    if (!relayout && this.runKind === 'daily-ranked' && this.runDailyDate) {
      session.daily.recordPending({
        date: this.runDailyDate,
        score: dailyScore(this.runSummary.elapsed, this.runSummary.kills, this.runSummary.victory),
        survivalSec: this.runSummary.elapsed,
        kills: this.runSummary.kills,
        victory: this.runSummary.victory,
      });
      void session.daily.flush();
      void this.submitDaily();
    }

    this.drawStatsCard(state, victory);

    // Buttons.
    this.makeButton(cx, oy + 1340, 480, BUTTON_H, 'Another night', '50px', () => this.anotherNight());
    this.makeButton(cx, oy + 1470, 320, BUTTON_H - 16, 'Title', '42px', () => this.toTitle());
    this.input.keyboard?.on('keydown-ENTER', () => this.anotherNight());
    this.input.keyboard?.on('keydown-SPACE', () => this.anotherNight());

    if (!relayout) {
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
    }

    // Re-layout on canvas resize (Scale.EXPAND) by restarting as the same visit.
    onResizeSettled(this, () => {
      if (!this.leaving) this.scene.restart({ relayout: true });
    });
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
    const { width: W, height: H, ox, oy } = this.layout;
    const cx = W / 2;
    const bg = this.add.graphics();
    if (victory) {
      // Warm dawn: violet top fading to peach/gold at the horizon.
      bg.fillGradientStyle(0x3a2a6e, 0x3a2a6e, 0xf2a16b, 0xf2a16b, 1);
      bg.fillRect(0, 0, W, H * 0.55);
      bg.fillGradientStyle(0xf2a16b, 0xf2a16b, PALETTE.dawn, PALETTE.dawn, 1);
      bg.fillRect(0, H * 0.55, W, H * 0.45);

      // Rising sun with a soft glow, behind the portrait.
      const sun = this.add.graphics();
      sun.fillStyle(0xffe9a8, 0.25);
      sun.fillCircle(0, 0, 210);
      sun.fillStyle(0xffd27a, 0.5);
      sun.fillCircle(0, 0, 160);
      sun.fillStyle(0xfff3c4, 1);
      sun.fillCircle(0, 0, 120);
      sun.setPosition(cx, oy + PORTRAIT_Y + 260);
      this.tweens.add({ targets: sun, y: oy + PORTRAIT_Y - 40, duration: 2600, ease: 'Sine.easeOut' });
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
      bg.fillRect(0, 0, W, H * 0.6);
      bg.fillGradientStyle(PALETTE.night, PALETTE.night, 0x2a1850, 0x2a1850, 1);
      bg.fillRect(0, H * 0.6, W, H * 0.4);
      const stars = this.add.graphics();
      // Same star density per screen area on wide/tall canvases.
      const starCount = Math.round((40 * (W * H)) / (GAME_WIDTH * GAME_HEIGHT));
      for (let i = 0; i < starCount; i++) {
        // Deterministic scatter (no RNG needed for decoration).
        const x = (i * 157.3) % W;
        const y = (i * 97.1) % (H * 0.5);
        stars.fillStyle(0xf4f1ff, 0.25 + ((i * 37) % 50) / 100);
        stars.fillCircle(x, y, 1.5 + (i % 3));
      }
      this.tweens.add({ targets: stars, alpha: 0.6, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const moon = this.add.graphics();
      moon.fillStyle(0xd8d4f0, 0.8);
      moon.fillCircle(ox + 590, oy + 290, 54);
      moon.fillStyle(0x07051a, 1);
      moon.fillCircle(ox + 612, oy + 274, 48);
    }
  }

  private drawStatsCard(state: RunState, victory: boolean): void {
    const cx = this.layout.width / 2;
    const top = this.layout.oy + 680;
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
      [`${META_CURRENCY_NAME} earned`, this.metaReward === null ? '…' : `+${this.metaReward}`],
    ];
    if (this.runKind !== 'normal') {
      rows.push(['Daily score', String(dailyScore(this.runSummary.elapsed, this.runSummary.kills, this.runSummary.victory))]);
    }
    const rowGap = rows.length > 6 ? 46 : 52;
    const left = cx - w / 2 + 40;
    const right = cx + w / 2 - 40;
    const labelStyle = { fontFamily: FONT, fontSize: '32px', color: PALETTE.textDim };
    const valueStyle = { fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: PALETTE.text };
    let y = top + 36;
    for (const [label, value] of rows) {
      this.add.text(left, y, label, labelStyle);
      const valueText = this.add.text(right, y, value, valueStyle).setOrigin(1, 0);
      if (label === `${META_CURRENCY_NAME} earned`) this.bonesValueText = valueText;
      y += rowGap;
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

    // Seed (Req 17.3), small text at the card's bottom. Daily runs show the
    // submission status here instead; tapping it retries a failed submit.
    if (this.runKind === 'normal') {
      this.add
        .text(cx, top + h - 20, `Seed ${state.seed}`, { fontFamily: FONT, fontSize: '22px', color: PALETTE.textDim })
        .setOrigin(0.5, 1);
    } else {
      const initial =
        this.dailyStatus ||
        (this.runKind === 'daily-ranked' ? 'Submitting score…' : `Daily ${this.runDailyDate} · Practice — not submitted`);
      this.dailyStatusText = this.add
        .text(cx, top + h - 20, initial, {
          fontFamily: FONT,
          fontSize: '22px',
          color: PALETTE.textDim,
          align: 'center',
          wordWrap: { width: w - 40 },
        })
        .setOrigin(0.5, 1);
      const retryZone = this.add.zone(cx, top + h - 32, w, 56).setInteractive({ useHandCursor: true });
      retryZone.on('pointerup', () => {
        if (this.dailySubmitFailed) void this.submitDaily();
      });
    }
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

  /** Awards Bones for the finished run and queues the save (once per visit). */
  private awardMeta(): void {
    if (this.metaReward !== null) return;
    const session = getSession();
    this.metaReward = session.meta.awardRun(this.runSummary.elapsed, this.runSummary.kills, this.runSummary.victory);
    if (this.visitAlive) this.bonesValueText?.setText(`+${this.metaReward}`);
    void session.meta.flush().then((ok) => {
      if (ok || !this.visitAlive) return;
      this.showToast(
        session.meta.saveBlocked
          ? 'Saved progress was corrupted — earnings kept for this session'
          : "Couldn't save progress — will retry next run",
      );
    });
  }

  private setDailyStatus(status: string): void {
    this.dailyStatus = status;
    if (this.visitAlive) this.dailyStatusText?.setText(status);
  }

  /** Submits the recorded ranked score; failures stay pending for retry (Req 27.6). */
  private async submitDaily(): Promise<void> {
    if (this.submittingDaily) return;
    const session = getSession();
    if (!session.daily.state.pending) return;
    this.submittingDaily = true;
    this.dailySubmitFailed = false;
    this.setDailyStatus('Submitting score…');
    try {
      const outcome = await submitPendingDailyScore(session.platform, session.daily);
      if (outcome?.accepted) {
        this.setDailyStatus(
          `Daily ${this.runDailyDate} · Submitted${outcome.rank ? ` · Rank #${outcome.rank}` : ''}`,
        );
      } else {
        this.dailySubmitFailed = true;
        this.setDailyStatus(
          outcome?.reason ? `Not recorded: ${outcome.reason} — tap to retry` : "Couldn't submit score — tap to retry",
        );
      }
    } catch {
      this.dailySubmitFailed = true;
      this.setDailyStatus("Couldn't submit score — tap to retry");
    } finally {
      this.submittingDaily = false;
    }
  }

  /** Small non-blocking message near the top of the screen. */
  private showToast(message: string): void {
    const cx = this.layout.width / 2;
    const y = this.layout.oy + 64;
    const text = this.add
      .text(cx, y, message, {
        fontFamily: FONT,
        fontSize: '26px',
        color: PALETTE.text,
        backgroundColor: '#0b0716',
        padding: { x: 18, y: 10 },
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 80 },
      })
      .setOrigin(0.5)
      .setDepth(100);
    this.tweens.add({ targets: text, alpha: 0, delay: 3200, duration: 600, onComplete: () => text.destroy() });
  }

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
    // Another Night is always a normal run: restore meta bonuses and seed.
    session.runMode = 'normal';
    session.dailyDate = null;
    syncMetaBonuses(session);
    // In-place reset (Req 15.2–15.3); new random seed unless ?seed= pins it.
    // Re-enter fullscreen if the player left it since the run started.
    void session.platform.requestFullscreen();
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
    this.visitAlive = false;
    this.portrait?.destroy();
    this.portrait = null;
    // Keyboard listeners are scene-scoped plugins but persist across restarts; drop ours.
    this.input.keyboard?.off('keydown-ENTER');
    this.input.keyboard?.off('keydown-SPACE');
  }
}
