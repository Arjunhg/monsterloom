/**
 * HudScene (task 10.3; Req 8.5, 12.4, 13.5, 14.1–14.4, 18.6, 1.8, 22.1).
 *
 * Runs in parallel above GameScene. It only READS sim state and listens to the
 * cross-scene protocol on `this.game.events`:
 *   listens 'sim-event'     (type, a, b, c, d)  → part row rebuild, behaviour banner
 *   listens 'pause-changed' (paused, kind)      → pause overlay show / hide
 *   emits   'request-pause'                      (pause button)
 *   emits   'request-resume'                     (overlay Resume / key / auto-pause tap)
 *
 * Layout (game px, canvas 720 × 1560): everything interactive lives in the top
 * bar (≤ ~25% of the height), well above the joystick zone (lower 60%). The top
 * bar and pause button rects are registered with InputManager.setHudRects so a
 * touch there never starts the joystick (Req 14.3).
 */
import Phaser from 'phaser';
import { FONT, GAME_HEIGHT, GAME_WIDTH, PALETTE, RARITY_COLOR, SCENE, SFX, TEX } from '../game/keys';
import { getSession, type Session } from '../game/Session';
import { getAudio } from '../juice/AudioManager';
import { creditRate } from '../data/balance';
import { EventType } from '../sim/EventBus';
import type { Rect } from '../sim/input/InputManager';
import { fillFraction } from '../sim/systems/EnergySystem';
import { skyPhase, timeRemaining } from '../sim/systems/ClockSystem';

/** Minimum margin from the canvas edge / safe-area inset (game px). */
const MARGIN = 24;
/** Pause button hit area: 88 game px ≈ 44 CSS px on a 360-CSS-px-wide phone (Req 14.4). */
const PAUSE_SIZE = 88;
const GAP = 16;
const HP_H = 34;
const ENERGY_H = 18;
const LV_W = 84;
const ICON = 56;
const ICON_STEP = 64;
const PART_ROW_OFFSET = 128;
const TOP_BAR_H = PART_ROW_OFFSET + ICON + 8; // relative to the top inset
const BANNER_MS = 2000;
const DEBUG_INTERVAL_MS = 250;
const DPS_WINDOW_SEC = 5;
/** Keys pressed within this time after the overlay opened are ignored (the ESC that opened it). */
const KEY_GUARD_MS = 200;

const MOON = 0xdfe6ff;
const SUN = 0xffc83d;

const OVERLAY_DEPTH = 1000;

interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface Button {
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

function setTextIfChanged(t: Phaser.GameObjects.Text, s: string): void {
  if (t.text !== s) t.setText(s);
}

function lerpColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const r = Math.round(ar + (((b >> 16) & 0xff) - ar) * k);
  const g = Math.round(ag + (((b >> 8) & 0xff) - ag) * k);
  const bl = Math.round(ab + ((b & 0xff) - ab) * k);
  return (r << 16) | (g << 8) | bl;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/**
 * Reads the CSS safe-area insets (--sat/--sab/--sal/--sar on :root) in CSS px.
 * Custom properties holding env() are not always resolved by getComputedStyle,
 * so a hidden probe element with `padding: var(--sat) …` is used to get px values.
 */
function readCssInsets(): Insets {
  const zero: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
  if (typeof document === 'undefined' || !document.body) return zero;
  try {
    const root = getComputedStyle(document.documentElement);
    const direct = (name: string): number => parseFloat(root.getPropertyValue(name));
    let top = direct('--sat');
    let bottom = direct('--sab');
    let left = direct('--sal');
    let right = direct('--sar');
    if (![top, bottom, left, right].every(Number.isFinite)) {
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;width:0;height:0;' +
        'padding-top:var(--sat,0px);padding-bottom:var(--sab,0px);padding-left:var(--sal,0px);padding-right:var(--sar,0px);';
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      top = parseFloat(cs.paddingTop);
      bottom = parseFloat(cs.paddingBottom);
      left = parseFloat(cs.paddingLeft);
      right = parseFloat(cs.paddingRight);
      probe.remove();
    }
    const fix = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);
    return { top: fix(top), bottom: fix(bottom), left: fix(left), right: fix(right) };
  } catch {
    return zero;
  }
}

export default class HudScene extends Phaser.Scene {
  private session!: Session;
  private insets: Insets = { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN };

  // Top bar.
  private hpBg!: Phaser.GameObjects.Rectangle;
  private hpFill!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;
  private energyBg!: Phaser.GameObjects.Rectangle;
  private energyFill!: Phaser.GameObjects.Rectangle;
  private levelText!: Phaser.GameObjects.Text;
  private dawnIcon!: Phaser.GameObjects.Graphics;
  private timeText!: Phaser.GameObjects.Text;
  private killText!: Phaser.GameObjects.Text;
  private partRow!: Phaser.GameObjects.Container;
  private pauseBg!: Phaser.GameObjects.Rectangle;
  private pauseIcon!: Phaser.GameObjects.Image;
  private pauseArmed = false;
  private lastPhaseBucket = -1;
  private lastBuildSize = -1;

  // Banner.
  private banner!: Phaser.GameObjects.Text;
  private bannerTween: Phaser.Tweens.Tween | null = null;

  // Pause overlay.
  private overlay!: Phaser.GameObjects.Container;
  private overlayBackdrop!: Phaser.GameObjects.Rectangle;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlayButtons: Button[] = [];
  private musicBtn!: Button;
  private sfxBtn!: Button;
  private shakeBtn!: Button;
  private overlayVisible = false;
  private overlayKind: 'user' | 'auto' = 'user';
  private overlayShownAt = 0;
  private backdropArmed = false;

  // Debug.
  private debugText: Phaser.GameObjects.Text | null = null;
  private debugAccumMs = 0;
  private dpsT: number[] = [];
  private dpsD: number[] = [];

  constructor() {
    super(SCENE.hud);
  }

  create(): void {
    // Scene instances are reused across runs: reset per-run fields.
    this.session = getSession();
    this.pauseArmed = false;
    this.lastPhaseBucket = -1;
    this.lastBuildSize = -1;
    this.bannerTween = null;
    this.overlayButtons = [];
    this.overlayVisible = false;
    this.overlayKind = 'user';
    this.overlayShownAt = 0;
    this.backdropArmed = false;
    this.debugText = null;
    this.debugAccumMs = 0;
    this.dpsT = [];
    this.dpsD = [];

    this.buildTopBar();
    this.buildBanner();
    this.buildOverlay();
    if (this.session.flags.debug) this.buildDebug();

    this.layout();
    this.rebuildPartRow();

    const ge = this.game.events;
    ge.on('sim-event', this.onSimEvent, this);
    ge.on('pause-changed', this.onPauseChanged, this);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.input.keyboard?.on('keydown', this.onKeyDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    // If the run is already user/auto paused when the HUD (re)starts, show the overlay.
    const paused = this.session.sim.state.paused;
    if (paused === 'user' || paused === 'auto') this.showOverlay(paused);
  }

  update(_time: number, delta: number): void {
    const state = this.session.sim.state;
    const p = state.player;

    // HP.
    const maxHp = p.maxHp > 0 ? p.maxHp : 1;
    this.hpFill.scaleX = Math.min(1, Math.max(0, p.hp / maxHp));
    setTextIfChanged(this.hpText, `${Math.max(0, Math.ceil(p.hp))} / ${Math.ceil(p.maxHp)}`);

    // Energy + level (Req 8.5).
    this.energyFill.scaleX = fillFraction(state);
    setTextIfChanged(this.levelText, `Lv ${state.energy.levelUps}`);

    // Time to dawn (Req 13.5) + moon→sun icon.
    setTextIfChanged(this.timeText, formatTime(timeRemaining(state)));
    const bucket = Math.round(skyPhase(state.clock.elapsed, state.clock.duration) * 50);
    if (bucket !== this.lastPhaseBucket) {
      this.lastPhaseBucket = bucket;
      this.drawDawnIcon(bucket / 50);
    }

    // Kills.
    setTextIfChanged(this.killText, `☠ ${state.stats.kills}`);

    // Part row safety net (e.g. sim restarted while the HUD stayed alive).
    const size = state.build.parts.size * 100 + state.build.mutations.size;
    if (size !== this.lastBuildSize) this.rebuildPartRow();

    // Pause button only meaningful while running.
    const canPause = state.paused === false && state.outcome === null;
    const a = canPause ? 1 : 0.35;
    if (this.pauseBg.alpha !== a) {
      this.pauseBg.setAlpha(a);
      this.pauseIcon.setAlpha(a);
    }

    if (this.debugText) {
      this.debugAccumMs += delta;
      if (this.debugAccumMs >= DEBUG_INTERVAL_MS) {
        this.debugAccumMs = 0;
        this.updateDebug();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  private textStyle(size: number, color: string = PALETTE.text): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: FONT,
      fontSize: `${size}px`,
      color,
      fontStyle: 'bold',
      stroke: '#0b0820',
      strokeThickness: Math.max(3, Math.round(size / 6)),
    };
  }

  private buildTopBar(): void {
    this.hpBg = this.add.rectangle(0, 0, 10, HP_H, 0x0b0820, 0.7).setOrigin(0, 0).setStrokeStyle(2, 0x000000, 0.8);
    this.hpFill = this.add.rectangle(0, 0, 10, HP_H - 6, PALETTE.hp).setOrigin(0, 0);
    this.hpText = this.add.text(0, 0, '', this.textStyle(22)).setOrigin(0.5);

    this.levelText = this.add.text(0, 0, '', this.textStyle(26)).setOrigin(0, 0.5);
    this.energyBg = this.add
      .rectangle(0, 0, 10, ENERGY_H, 0x0b0820, 0.7)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x000000, 0.8);
    this.energyFill = this.add.rectangle(0, 0, 10, ENERGY_H - 6, PALETTE.energy).setOrigin(0, 0);

    this.dawnIcon = this.add.graphics();
    this.timeText = this.add.text(0, 0, '', this.textStyle(30)).setOrigin(0, 0.5);
    this.killText = this.add.text(0, 0, '', this.textStyle(30)).setOrigin(1, 0.5);

    this.partRow = this.add.container(0, 0);

    this.pauseBg = this.add
      .rectangle(0, 0, PAUSE_SIZE, PAUSE_SIZE, 0x0b0820, 0.55)
      .setOrigin(0, 0)
      .setStrokeStyle(3, 0xffffff, 0.35)
      .setInteractive({ useHandCursor: true });
    this.pauseIcon = this.add.image(0, 0, TEX.iconPause).setDisplaySize(48, 48);
    if (!this.textures.exists(TEX.iconPause)) this.pauseIcon.setVisible(false);
    this.pauseBg.on('pointerdown', () => (this.pauseArmed = true));
    this.pauseBg.on('pointerout', () => (this.pauseArmed = false));
    this.pauseBg.on('pointerup', () => {
      if (!this.pauseArmed) return;
      this.pauseArmed = false;
      getAudio().play(SFX.click);
      this.game.events.emit('request-pause');
    });
  }

  private buildBanner(): void {
    this.banner = this.add
      .text(GAME_WIDTH / 2, 0, '', { ...this.textStyle(40, '#fff6a8'), align: 'center' })
      .setOrigin(0.5)
      .setAlpha(0)
      .setVisible(false);
  }

  private makeButton(
    y: number,
    w: number,
    h: number,
    text: string,
    fill: number,
    textColor: string,
    onTap: () => void,
  ): Button {
    const x = GAME_WIDTH / 2;
    const bg = this.add.rectangle(x, y, w, h, fill, 1).setStrokeStyle(4, 0x000000, 0.6);
    const label = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: '36px', color: textColor, fontStyle: 'bold' })
      .setOrigin(0.5);
    let armed = false;
    bg.on('pointerdown', () => (armed = true));
    bg.on('pointerout', () => (armed = false));
    bg.on('pointerup', () => {
      if (!armed) return;
      armed = false;
      getAudio().play(SFX.click);
      onTap();
    });
    const btn = { bg, label };
    this.overlayButtons.push(btn);
    this.overlay.add([bg, label]);
    return btn;
  }

  private buildOverlay(): void {
    this.overlay = this.add.container(0, 0).setDepth(OVERLAY_DEPTH).setVisible(false);
    this.overlayBackdrop = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.65)
      .setInteractive();
    // The backdrop swallows taps; in 'auto' mode an explicit tap on it resumes (Req 1.8).
    this.overlayBackdrop.on('pointerdown', () => (this.backdropArmed = true));
    this.overlayBackdrop.on('pointerup', () => {
      if (!this.backdropArmed) return;
      this.backdropArmed = false;
      if (this.overlayKind === 'auto') this.requestResume();
    });
    this.overlayTitle = this.add
      .text(GAME_WIDTH / 2, 500, 'Paused', {
        ...this.textStyle(56),
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 2 * MARGIN - 40 },
      })
      .setOrigin(0.5);
    this.overlay.add([this.overlayBackdrop, this.overlayTitle]);

    this.makeButton(680, 400, 104, 'Resume', 0xfff6a8, '#140f2e', () => this.requestResume());
    const settings = this.session.settings;
    this.musicBtn = this.makeButton(830, 440, 92, '', 0x2a2150, PALETTE.text, () => {
      settings.musicMuted = !settings.musicMuted;
      this.applySettings();
    });
    this.sfxBtn = this.makeButton(942, 440, 92, '', 0x2a2150, PALETTE.text, () => {
      settings.sfxMuted = !settings.sfxMuted;
      this.applySettings();
    });
    this.shakeBtn = this.makeButton(1054, 440, 92, '', 0x2a2150, PALETTE.text, () => {
      settings.shakeEnabled = !settings.shakeEnabled;
      this.applySettings();
    });
    this.makeButton(1210, 400, 92, 'Quit to title', 0x5a1f35, PALETTE.text, () => this.quitToTitle());
    this.refreshToggleLabels();
    this.setOverlayInteractive(false);
  }

  private buildDebug(): void {
    this.debugText = this.add
      .text(0, 0, '', {
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize: '20px',
        color: '#c8ffd0',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: { x: 8, y: 6 },
      })
      .setOrigin(0, 1)
      .setDepth(OVERLAY_DEPTH - 1);
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  /** Converts CSS safe-area insets (relative to the viewport) to game px insets of the canvas. */
  private computeInsets(): Insets {
    const css = readCssInsets();
    let top = css.top;
    let bottom = css.bottom;
    let left = css.left;
    let right = css.right;
    // Scale.FIT letterboxes the canvas: only the part of an inset overlapping the canvas matters.
    const canvas = this.game.canvas;
    if (canvas && typeof canvas.getBoundingClientRect === 'function' && typeof window !== 'undefined') {
      const r = canvas.getBoundingClientRect();
      top = Math.max(0, top - r.top);
      left = Math.max(0, left - r.left);
      bottom = Math.max(0, bottom - (window.innerHeight - r.bottom));
      right = Math.max(0, right - (window.innerWidth - r.right));
    }
    const ds = this.scale.displayScale; // game px per CSS px
    const sx = Number.isFinite(ds.x) && ds.x > 0 ? ds.x : 1;
    const sy = Number.isFinite(ds.y) && ds.y > 0 ? ds.y : 1;
    return {
      top: Math.max(MARGIN, top * sy + MARGIN),
      bottom: Math.max(MARGIN, bottom * sy + MARGIN),
      left: Math.max(MARGIN, left * sx + MARGIN),
      right: Math.max(MARGIN, right * sx + MARGIN),
    };
  }

  private layout(): void {
    const ins = (this.insets = this.computeInsets());
    const T = ins.top;
    const L = ins.left;
    const R = ins.right;

    const pauseX = GAME_WIDTH - R - PAUSE_SIZE;
    this.pauseBg.setPosition(pauseX, T);
    this.pauseIcon.setPosition(pauseX + PAUSE_SIZE / 2, T + PAUSE_SIZE / 2);

    const colW = Math.max(200, pauseX - GAP - L);

    // Fill rects have origin (0, 0); their scaleX is the fill fraction, set every frame.
    this.hpBg.setPosition(L, T).setSize(colW, HP_H);
    this.hpFill.setPosition(L + 3, T + 3).setSize(colW - 6, HP_H - 6);
    this.hpText.setPosition(L + colW / 2, T + HP_H / 2);

    const ey = T + 44;
    this.levelText.setPosition(L, ey + ENERGY_H / 2);
    const ew = colW - LV_W;
    this.energyBg.setPosition(L + LV_W, ey).setSize(ew, ENERGY_H);
    this.energyFill.setPosition(L + LV_W + 3, ey + 3).setSize(ew - 6, ENERGY_H - 6);

    const sy = T + 96;
    this.dawnIcon.setPosition(L + 16, sy);
    this.timeText.setPosition(L + 40, sy);
    this.killText.setPosition(L + colW, sy);

    this.partRow.setPosition(L, T + PART_ROW_OFFSET);
    this.banner.setPosition(GAME_WIDTH / 2, T + TOP_BAR_H + 60);
    if (this.debugText) this.debugText.setPosition(L, GAME_HEIGHT - ins.bottom);

    this.lastPhaseBucket = -1;
    this.rebuildPartRow();

    // HUD rects in game px (Req 14.3): top bar strip + pause button (with slop).
    const rects: Rect[] = [
      { x: 0, y: 0, w: GAME_WIDTH, h: T + TOP_BAR_H },
      { x: pauseX - 8, y: T - 8, w: PAUSE_SIZE + 16, h: PAUSE_SIZE + 16 },
    ];
    this.session.input.setHudRects(rects);
  }

  // ---------------------------------------------------------------------------
  // Part icons row (Req 14.2)
  // ---------------------------------------------------------------------------

  private rebuildPartRow(): void {
    const state = this.session.sim.state;
    const cfg = state.config;
    this.lastBuildSize = state.build.parts.size * 100 + state.build.mutations.size;
    this.partRow.removeAll(true);

    const entries: Array<{ key: string; level: number; dim: boolean; epic: boolean }> = [];
    for (const [id, owned] of state.build.parts) {
      const def = cfg.bodyParts.find((p) => p.id === id);
      entries.push({ key: def?.icon ?? TEX.partIcon(id), level: owned.level, dim: owned.merged, epic: false });
    }
    for (const id of state.build.mutations) {
      const def = cfg.mutations.find((m) => m.id === id);
      entries.push({ key: def?.spriteKey ?? id, level: 0, dim: false, epic: true });
    }

    const avail = GAME_WIDTH - this.insets.left - this.insets.right;
    const step = entries.length > 1 ? Math.min(ICON_STEP, (avail - ICON) / (entries.length - 1)) : ICON_STEP;
    const objs: Array<Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image | Phaser.GameObjects.Text> = [];
    entries.forEach((e, i) => {
      const x = i * step;
      const start = objs.length;
      objs.push(
        this.add
          .rectangle(x, 0, ICON, ICON, 0x0b0820, 0.6)
          .setOrigin(0, 0)
          .setStrokeStyle(e.epic ? 4 : 2, e.epic ? RARITY_COLOR.epic : 0xffffff, e.epic ? 1 : 0.25),
      );
      if (this.textures.exists(e.key)) {
        const img = this.add.image(x + ICON / 2, ICON / 2, e.key);
        img.setScale((ICON - 10) / Math.max(img.width, img.height, 1));
        objs.push(img);
      }
      if (e.level > 0) {
        objs.push(
          this.add.text(x + ICON - 2, ICON + 2, String(e.level), this.textStyle(22, '#fff6a8')).setOrigin(1, 1),
        );
      }
      // Merged parts (consumed by a mutation) stay listed but dimmed.
      if (e.dim) for (let k = start; k < objs.length; k++) objs[k].setAlpha(0.4);
    });
    this.partRow.add(objs);
  }

  private drawDawnIcon(phase: number): void {
    const g = this.dawnIcon;
    const r = 14;
    g.clear();
    // Sun rays fade in towards dawn.
    if (phase > 0.05) {
      g.lineStyle(3, SUN, phase);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.lineBetween(Math.cos(a) * (r + 3), Math.sin(a) * (r + 3), Math.cos(a) * (r + 8), Math.sin(a) * (r + 8));
      }
    }
    g.fillStyle(lerpColor(MOON, SUN, phase), 1);
    g.fillCircle(0, 0, r);
    // Crescent "bite" fades out as the moon becomes the sun.
    if (phase < 0.95) {
      g.fillStyle(PALETTE.night, 1 - phase);
      g.fillCircle(r * 0.55, -r * 0.35, r * 0.85);
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  private onSimEvent(type: number, a: number): void {
    if (type === EventType.partGained || type === EventType.partLevelled || type === EventType.mutation) {
      this.rebuildPartRow();
    } else if (type === EventType.behaviourIntroduced) {
      const cfg = this.session.sim.state.config;
      const enemy = cfg.enemies[a];
      if (enemy) {
        // Prefer the stage's authored banner (Req 22.1); fall back to the monster name.
        const stage = cfg.stages.find((s) => s.banner && s.addTypes.includes(enemy.id));
        this.showBanner(stage?.banner ?? `${enemy.name} appears!`);
      }
    }
  }

  private showBanner(text: string): void {
    this.bannerTween?.stop();
    this.banner.setText(text).setVisible(true).setAlpha(1);
    this.bannerTween = this.tweens.add({
      targets: this.banner,
      alpha: 0,
      delay: BANNER_MS - 400,
      duration: 400,
      onComplete: () => {
        this.banner.setVisible(false);
        this.bannerTween = null;
      },
    });
  }

  private onPauseChanged(paused: boolean, kind?: 'user' | 'auto'): void {
    if (paused) this.showOverlay(kind === 'auto' ? 'auto' : 'user');
    else this.hideOverlay();
  }

  private showOverlay(kind: 'user' | 'auto'): void {
    // An auto pause on top of a user pause keeps the stricter "tap to resume" wording.
    this.overlayKind = this.overlayVisible && this.overlayKind === 'auto' ? 'auto' : kind;
    setTextIfChanged(this.overlayTitle, this.overlayKind === 'auto' ? 'Paused — tap to resume' : 'Paused');
    this.refreshToggleLabels();
    if (!this.overlayVisible) {
      this.overlayVisible = true;
      this.overlayShownAt = performance.now();
      this.backdropArmed = false;
      this.overlay.setVisible(true);
      this.setOverlayInteractive(true);
      this.scene.bringToTop();
    }
  }

  private hideOverlay(): void {
    if (!this.overlayVisible) return;
    this.overlayVisible = false;
    this.overlay.setVisible(false);
    this.setOverlayInteractive(false);
    if (this.scene.isActive(SCENE.upgrade)) this.scene.bringToTop(SCENE.upgrade);
  }

  private setOverlayInteractive(on: boolean): void {
    const objs: Phaser.GameObjects.Rectangle[] = [this.overlayBackdrop, ...this.overlayButtons.map((b) => b.bg)];
    for (const o of objs) {
      if (on) o.setInteractive({ useHandCursor: o !== this.overlayBackdrop });
      else o.disableInteractive();
    }
    if (on) this.pauseBg.disableInteractive();
    else this.pauseBg.setInteractive({ useHandCursor: true });
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (!this.overlayVisible) return;
    if (performance.now() - this.overlayShownAt < KEY_GUARD_MS) return; // the ESC that opened it
    const code = ev.code;
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space' || code === 'Escape') {
      this.requestResume();
    }
  }

  private requestResume(): void {
    // Hide immediately; GameScene answers with pause-changed(false) as well.
    this.game.events.emit('request-resume');
    this.hideOverlay();
  }

  private applySettings(): void {
    this.refreshToggleLabels();
    try {
      getAudio().applySettings();
    } catch {
      // Audio is optional.
    }
  }

  private refreshToggleLabels(): void {
    const s = this.session.settings;
    setTextIfChanged(this.musicBtn.label, `Music: ${s.musicMuted ? 'Off' : 'On'}`);
    setTextIfChanged(this.sfxBtn.label, `Sound: ${s.sfxMuted ? 'Off' : 'On'}`);
    setTextIfChanged(this.shakeBtn.label, `Screen shake: ${s.shakeEnabled ? 'On' : 'Off'}`);
  }

  private quitToTitle(): void {
    try {
      getAudio().stopMusic();
      getAudio().setSuspended(false);
    } catch {
      // Audio is optional.
    }
    const sm = this.scene;
    if (sm.isActive(SCENE.upgrade) || sm.isPaused(SCENE.upgrade)) sm.stop(SCENE.upgrade);
    sm.stop(SCENE.game);
    // start() from this scene also shuts this (HUD) scene down.
    sm.start(SCENE.title);
  }

  // ---------------------------------------------------------------------------
  // Debug overlay (?debug=1)
  // ---------------------------------------------------------------------------

  private updateDebug(): void {
    const text = this.debugText;
    if (!text) return;
    const state = this.session.sim.state;
    const t = state.clock.elapsed;
    const dmg = state.stats.damageDealt;

    // DPS over a 5 s sliding window of sim time (pauses don't dilute it).
    const ts = this.dpsT;
    const ds = this.dpsD;
    if (ts.length > 0 && (t < ts[ts.length - 1] || dmg < ds[ds.length - 1])) {
      ts.length = 0; // run restarted
      ds.length = 0;
    }
    if (ts.length === 0 || t > ts[ts.length - 1]) {
      ts.push(t);
      ds.push(dmg);
    }
    while (ts.length > 1 && t - ts[0] > DPS_WINDOW_SEC) {
      ts.shift();
      ds.shift();
    }
    const span = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0;
    const dps = span > 0 ? (ds[ds.length - 1] - ds[0]) / span : 0;

    const s =
      `credit rate ${creditRate(t, state.config.balance).toFixed(2)}/s\n` +
      `credits     ${state.director.credits.toFixed(1)}\n` +
      `enemies     ${state.enemies.count}\n` +
      `projectiles ${state.projectiles.count}\n` +
      `orbs        ${state.orbs.count}\n` +
      `dps (5s)    ${dps.toFixed(1)}\n` +
      `fps         ${this.game.loop.actualFps.toFixed(0)}`;
    setTextIfChanged(text, s);
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  private onShutdown(): void {
    const ge = this.game.events;
    ge.off('sim-event', this.onSimEvent, this);
    ge.off('pause-changed', this.onPauseChanged, this);
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.input.keyboard?.off('keydown', this.onKeyDown, this);
    this.bannerTween?.stop();
    this.bannerTween = null;
    try {
      this.session.input.setHudRects([]);
    } catch {
      // ignore
    }
  }
}
