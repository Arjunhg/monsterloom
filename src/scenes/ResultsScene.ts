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
import { encodeChallenge } from '../meta/ChallengeLink';
import { dailyScore, submitPendingDailyScore } from '../meta/DailyChallenge';
import { META_CURRENCY_NAME } from '../meta/MetaProgression';
import { evaluateAchievements } from '../meta/Achievements';
import { AchievementBanner } from '../render/AchievementBanner';
import { cosmeticLookFor } from '../meta/Shop';
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
  /** Achievement names unlocked by this run (Req 32), shown on the card. */
  private newBadges: string[] = [];
  private achievementBanner: AchievementBanner | null = null;
  private duelValueText: Phaser.GameObjects.Text | null = null;
  private duelPoll: Phaser.Time.TimerEvent | null = null;
  private bonesValueText: Phaser.GameObjects.Text | null = null;
  /** Finished-run stats snapshot, taken at create so a fast restart can't skew the reward. */
  private runSummary = { elapsed: 0, kills: 0, bonusKills: 0, surgeKills: 0, victory: false };
  /** Daily-run context snapshot (task 21). */
  private runKind: RunMode = 'normal';
  private runDailyDate: string | null = null;
  private dailyStatus = '';
  private dailyStatusText: Phaser.GameObjects.Text | null = null;
  private dailySubmitFailed = false;
  private submittingDaily = false;
  /** Friend-challenge target snapshot (task 22). */
  private runTarget: number | null = null;
  private sharingCard = false;
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
    this.achievementBanner = null;
    this.duelValueText = null;
    this.duelPoll?.remove(false);
    this.duelPoll = null;
    if (!relayout) {
      this.metaReward = null;
      this.newBadges = [];
      const session = getSession();
      const st = session.sim.state;
      this.runSummary = {
        elapsed: st.clock.elapsed,
        kills: st.stats.kills,
        bonusKills: st.stats.bonusKills,
        surgeKills: st.stats.surgeKills,
        victory: st.outcome === 'victory',
      };
      this.runKind = session.runMode;
      this.runDailyDate = session.dailyDate;
      this.runTarget = session.challengeTarget;
      this.sharingCard = false;
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

    const portrait = new PlayerRenderer(this, state, {
      interactive: false,
      cosmetic: cosmeticLookFor(session.meta.state),
    });
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
        score: dailyScore(this.runSummary.elapsed, this.runSummary.kills + this.runSummary.bonusKills, this.runSummary.victory),
        survivalSec: this.runSummary.elapsed,
        kills: this.runSummary.kills,
        victory: this.runSummary.victory,
      });
      void session.daily.flush();
      void this.submitDaily();
    }

    this.drawStatsCard(state, victory);
    if (this.runKind === 'duel' && !relayout) {
      this.duelPoll = this.time.addEvent({
        delay: 400,
        loop: true,
        callback: () => {
          if (this.duelValueText) this.duelValueText.setText(this.duelVerdictText());
        },
      });
    }

    // Buttons.
    this.makeButton(cx, oy + 1312, 480, BUTTON_H, 'Another night', '50px', () => this.anotherNight());
    this.makeButton(cx - 140, oy + 1448, 264, BUTTON_H - 20, 'Share Card', '36px', () => void this.shareCard());
    this.makeButton(cx + 150, oy + 1448, 244, BUTTON_H - 20, 'Title', '40px', () => this.toTitle());
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
    if (this.runKind === 'challenge') {
      const score = dailyScore(this.runSummary.elapsed, this.runSummary.kills + this.runSummary.bonusKills, this.runSummary.victory);
      rows.push(['Score / Target', `${score} / ${this.runTarget ?? '—'}`]);
    } else if (this.runKind === 'duel') {
      rows.push(['Duel result', this.duelVerdictText()]);
    } else if (this.runKind !== 'normal') {
      rows.push(['Daily score', String(dailyScore(this.runSummary.elapsed, this.runSummary.kills + this.runSummary.bonusKills, this.runSummary.victory))]);
    }
    const rowGap = rows.length > 6 || this.newBadges.length > 0 ? 42 : 52;
    const left = cx - w / 2 + 40;
    const right = cx + w / 2 - 40;
    const labelStyle = { fontFamily: FONT, fontSize: '32px', color: PALETTE.textDim };
    const valueStyle = { fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: PALETTE.text };
    let y = top + 36;
    for (const [label, value] of rows) {
      this.add.text(left, y, label, labelStyle);
      const valueText = this.add.text(right, y, value, valueStyle).setOrigin(1, 0);
      if (label === `${META_CURRENCY_NAME} earned`) this.bonesValueText = valueText;
      if (label === 'Duel result') this.duelValueText = valueText;
      y += rowGap;
    }

    const wrapStyle = {
      fontFamily: FONT,
      fontSize: '26px',
      color: PALETTE.text,
      wordWrap: { width: w - 80 },
      lineSpacing: 4,
    };
    if (this.newBadges.length > 0) {
      const badgesText = this.add.text(left, y, `New badges: ${this.newBadges.join(' · ')}`, {
        ...wrapStyle,
        fontSize: '25px',
        fontStyle: 'bold',
        color: '#ffd166',
      });
      y += badgesText.height + 14;
    }
    const partsText = this.add.text(left, y, parts.list, wrapStyle);
    y += partsText.height + 16;
    this.add.text(left, y, 'Mutations', labelStyle);
    y += 42;
    this.add.text(left, y, mutationsSummary(state), { ...wrapStyle, color: '#e0b8ff' });

    // Seed (Req 17.3), small text at the card's bottom. Daily runs show the
    // submission status here instead; tapping it retries a failed submit.
    if (this.runKind === 'challenge') {
      const score = dailyScore(this.runSummary.elapsed, this.runSummary.kills + this.runSummary.bonusKills, this.runSummary.victory);
      const target = this.runTarget ?? 0;
      this.add
        .text(
          cx,
          top + h - 20,
          score >= target ? `Challenge beaten! Target was ${target}` : `Challenge · Target ${target} · Missed by ${target - score}`,
          { fontFamily: FONT, fontSize: '22px', color: score >= target ? '#9fe8a8' : PALETTE.textDim, align: 'center', wordWrap: { width: w - 40 } },
        )
        .setOrigin(0.5, 1);
    } else if (this.runKind === 'normal' || this.runKind === 'duel') {
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
    this.metaReward = session.meta.awardRun(
      this.runSummary.elapsed,
      this.runSummary.kills,
      this.runSummary.victory,
      this.runSummary.surgeKills,
    );
    if (this.visitAlive) this.bonesValueText?.setText(`+${this.metaReward}`);
    // Achievements (Req 32): evaluate once with the award; toast + card row.
    const st = session.sim.state;
    const isDaily = this.runKind === 'daily-ranked' || this.runKind === 'daily-practice';
    const dailyFinishes = isDaily ? session.daily.recordFinish() : session.daily.state.finishedCount;
    if (isDaily) void session.daily.flush();
    const score = dailyScore(
      this.runSummary.elapsed,
      this.runSummary.kills + this.runSummary.bonusKills,
      this.runSummary.victory,
    );
    const unlocked = evaluateAchievements(session.meta, {
      victory: this.runSummary.victory,
      kills: this.runSummary.kills,
      bestNoDamageSec: st.stats.bestNoDamageSec,
      mutationsOwned: st.build.mutations.size,
      challengeBeaten: this.runKind === 'challenge' && this.runTarget !== null && score >= this.runTarget,
      dailyFinishes,
      cosmeticsOwned: session.meta.state.cosmetics.length,
    });
    if (unlocked.length > 0) {
      this.newBadges = unlocked.map((a) => a.name);
      if (this.visitAlive) {
        if (!this.achievementBanner) {
          this.achievementBanner = new AchievementBanner(this, this.layout.width / 2, this.layout.oy + 210);
        }
        for (const a of unlocked) this.achievementBanner.show(a.name, a.description, 500);
      }
    }
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

  /**
   * Monster Card share (task 22.3, Req 28.1-28.2): renders the card, encodes
   * this run's seed + score as a challenge payload, and opens the host share
   * flow. On share failure/cancel: toast + copy a plain challenge link.
   */
  private async shareCard(): Promise<void> {
    if (this.sharingCard || !this.canAct()) return;
    this.sharingCard = true;
    this.click();
    try {
      const session = getSession();
      const state = session.sim.state;
      const score = dailyScore(this.runSummary.elapsed, this.runSummary.kills + this.runSummary.bonusKills, this.runSummary.victory);
      const encoded = encodeChallenge({ v: 1, seed: state.seed >>> 0, score });
      const blob = await this.renderCardBlob(state.outcome === 'victory', score);
      let shared = false;
      try {
        const res = await session.platform.share({
          image: blob,
          text: `I scored ${score} in Monster Mash Survivor — beat my monster!`,
          shareParams: { challenge: encoded },
          title: 'Monster Mash Survivor',
          filename: 'monster-card.png',
        });
        shared = res.completed;
      } catch {
        shared = false;
      }
      if (!this.visitAlive) return;
      if (shared) {
        this.showToast('Card shared!');
        return;
      }
      let copied = false;
      try {
        const base = `${window.location.origin}${window.location.pathname}`;
        await navigator.clipboard.writeText(`${base}?challenge=${encoded}`);
        copied = true;
      } catch {
        copied = false;
      }
      if (this.visitAlive) {
        this.showToast(copied ? 'Share unavailable — challenge link copied' : 'Share unavailable');
      }
    } catch {
      if (this.visitAlive) this.showToast("Couldn't create the card — try again");
    } finally {
      this.sharingCard = false;
    }
  }

  /** Renders the 720×960 Monster Card off-screen and snapshots it to a PNG Blob. */
  private renderCardBlob(victory: boolean, score: number): Promise<Blob> {
    const W = 720;
    const H = 960;
    const state = getSession().sim.state;
    const rt = this.make.renderTexture({ width: W, height: H }, false);
    const temps: Phaser.GameObjects.GameObject[] = [];
    try {
      const bg = this.make.graphics({}, false);
      temps.push(bg);
      if (victory) bg.fillGradientStyle(0x3a2a6e, 0x3a2a6e, 0xf2a16b, 0xf2a16b, 1);
      else bg.fillGradientStyle(PALETTE.night, PALETTE.night, 0x2a1850, 0x2a1850, 1);
      bg.fillRect(0, 0, W, H);
      bg.lineStyle(10, PALETTE.playerRim, 0.85);
      bg.strokeRect(5, 5, W - 10, H - 10);
      bg.fillStyle(0x0b0716, 0.55);
      bg.fillEllipse(W / 2, 560, 340, 72);
      rt.draw(bg);

      const title = this.make.text(
        {
          x: W / 2,
          y: 92,
          text: 'Monster Mash\nSurvivor',
          style: { fontFamily: FONT, fontSize: '58px', fontStyle: 'bold', color: PALETTE.text, align: 'center', stroke: '#0b0716', strokeThickness: 8 },
        },
        false,
      );
      title.setOrigin(0.5);
      temps.push(title);
      rt.draw(title);

      // Static portrait of the final build (parts + mutations), scaled up.
      const portrait = new PlayerRenderer(this, state, {
        interactive: false,
        cosmetic: cosmeticLookFor(getSession().meta.state),
      });
      portrait.container.setPosition(W / 2, 440).setScale(6);
      rt.draw(portrait.container);
      portrait.destroy();

      const parts = partsSummary(state);
      const lines: Array<[string, number, string, string]> = [
        [victory ? 'SURVIVED THE NIGHT' : 'THE NIGHT GOT THEM', 648, '44px', victory ? '#ffe9a8' : '#d8d4f0'],
        [`Survived ${formatTime(state.clock.elapsed)} · ${state.stats.kills} kills`, 712, '36px', PALETTE.text],
        [`Score ${score}`, 772, '44px', '#ffd166'],
        [parts.list, 836, '26px', PALETTE.textDim],
        ['Beat my score — tap the link to try!', 912, '28px', PALETTE.text],
      ];
      for (const [text, y, size, color] of lines) {
        const t = this.make.text(
          {
            x: W / 2,
            y,
            text,
            style: { fontFamily: FONT, fontSize: size, fontStyle: 'bold', color, align: 'center', wordWrap: { width: W - 80 } },
          },
          false,
        );
        t.setOrigin(0.5);
        temps.push(t);
        rt.draw(t);
      }
    } catch (err) {
      for (const t of temps) t.destroy();
      rt.destroy();
      return Promise.reject(err instanceof Error ? err : new Error('card render failed'));
    }
    for (const t of temps) t.destroy();
    return new Promise<Blob>((resolve, reject) => {
      rt.snapshot((img) => {
        try {
          const image = img as HTMLImageElement;
          const canvas = document.createElement('canvas');
          canvas.width = W;
          canvas.height = H;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no 2d context');
          ctx.drawImage(image, 0, 0, W, H);
          canvas.toBlob((blob) => {
            rt.destroy();
            if (blob) resolve(blob);
            else reject(new Error('card snapshot failed'));
          }, 'image/png');
        } catch (err) {
          rt.destroy();
          reject(err instanceof Error ? err : new Error('card snapshot failed'));
        }
      });
    });
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

  private duelVerdictText(): string {
    const duel = getSession().duel;
    if (!duel) return '—';
    if (duel.verdict === 'win') return duel.forfeit ? 'Rival fled — YOU WIN' : 'YOU WIN';
    if (duel.verdict === 'lose') return `${duel.rivalName} wins`;
    if (duel.verdict === 'draw') return 'Draw!';
    return duel.rivalFinal ? '…' : 'Waiting for rival…';
  }

  private anotherNight(): void {
    if (!this.canAct()) return;
    this.leaving = true;
    this.click();
    const session = getSession();
    session.duel?.leave();
    session.duel = null;
    // Another Night is always a normal run: restore meta bonuses and seed.
    session.runMode = 'normal';
    session.dailyDate = null;
    session.challengeTarget = null;
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
    const session = getSession();
    session.duel?.leave();
    session.duel = null;
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
