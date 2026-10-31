/**
 * GameScene (design "Frame flow", "Scene graph and modes"): owns the per-frame
 * loop — input → sim.advance → drain events → render (interpolated) — plus the
 * camera, auto-pause wiring (Req 1.7–1.8) and an error boundary.
 *
 * Cross-scene protocol (this.game.events):
 *   emits  'sim-event'      (type, a, b, c, d)  every drained EventBus event
 *   emits  'pause-changed'  (paused: boolean, kind: 'user' | 'auto')
 *   listens 'request-pause'  → sim.pause('user')      (HUD pause button, ESC)
 *   listens 'request-resume' → sim.resume() + audio   (HUD pause overlay only)
 */
import Phaser from 'phaser';
import { DEPTH, FONT, GAME_WIDTH, PALETTE, SCENE } from '../game/keys';
import { fitCameraToCanvas } from '../game/layout';
import { getSession, type Session } from '../game/Session';
import { cosmeticLookFor } from '../meta/Shop';
import { getAudio } from '../juice/AudioManager';
import { JuiceSystem } from '../juice/JuiceSystem';
import { AbilityVisuals } from '../render/AbilityVisuals';
import { EntityRenderer } from '../render/EntityRenderer';
import { InputAdapter } from '../render/InputAdapter';
import { JoystickView } from '../render/JoystickView';
import { PlayerRenderer } from '../render/PlayerRenderer';
import { SkyRenderer } from '../render/SkyRenderer';
import { TelegraphRenderer } from '../render/TelegraphRenderer';
import { spawnEnemy } from '../sim/entities';
import { applyDevLoadout, readDevLoadout, type DevLoadout } from '../game/devLoadout';
import { EventType, type EventCode } from '../sim/EventBus';
import type { PlatformSubscription } from '../platform/PlatformService';

/** Delay between the run ending and the results screen (lets the death/dawn juice play). */
const RESULTS_DELAY_MS = 1200;
/** Particle colour per enemy id (juice burst, Req 18.2); unknown ids use the fallback. */
const ENEMY_COLORS: Record<string, number> = {
  shambler: 0x7fbf5a,
  imp: 0xff6a3d,
  skull_knight: 0xe8e2d0,
  bat: 0x8a4fd8,
  ghost: 0xbfe8ff,
  slime: 0x5fd35a,
  witch: 0xc86bff,
  boss: 0xff3f6a,
};
const ENEMY_COLOR_FALLBACK = 0xff4f6a;

export default class GameScene extends Phaser.Scene {
  private session!: Session;
  private adapter!: InputAdapter;
  private entities!: EntityRenderer;
  private telegraphs!: TelegraphRenderer;
  private player!: PlayerRenderer;
  private sky!: SkyRenderer;
  private abilities!: AbilityVisuals;
  private joystick!: JoystickView;
  private juice!: JuiceSystem;

  private devLoadout: DevLoadout | null = null;
  private resultsTimerMs = -1;
  private goingToResults = false;
  private upgradeLaunchGuard = 0;
  private autoPaused = false;
  private broken = false;
  private needsRebuild = false;
  private stressType = 0;
  private cleanup: Array<() => void> = [];

  constructor() {
    super(SCENE.game);
  }

  create(): void {
    // Phaser reuses the scene instance across restarts: reset all per-run fields here.
    this.resultsTimerMs = -1;
    this.goingToResults = false;
    this.upgradeLaunchGuard = 0;
    this.autoPaused = false;
    this.broken = false;
    this.needsRebuild = false;
    this.stressType = 0;
    this.cleanup = [];

    const session = (this.session = getSession());
    const sim = session.sim;
    const state = sim.state;
    const cam = this.cameras.main;
    cam.setBackgroundColor(PALETTE.night);
    cam.setZoom(1);

    // Dev-only test loadout (?mutation=…, ?parts=…, ?god=1, ?t=…). Null in production.
    this.devLoadout = readDevLoadout();
    if (this.devLoadout) applyDevLoadout(state, this.devLoadout);

    this.sky = new SkyRenderer(this, state);
    this.entities = new EntityRenderer(this, state);
    this.telegraphs = new TelegraphRenderer(this, state);
    this.abilities = new AbilityVisuals(this, sim.ctx);
    this.player = new PlayerRenderer(this, state, { cosmetic: cosmeticLookFor(session.meta.state) });
    this.joystick = new JoystickView(this, session.input.joystickRadius);
    this.adapter = new InputAdapter(this);
    this.adapter.isOverHud = (x, y) =>
      session.input.getHudRects().some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    const enemies = state.config.enemies;
    this.juice = new JuiceSystem(this, {
      enemyColor: (i) => ENEMY_COLORS[enemies[i]?.id ?? ''] ?? ENEMY_COLOR_FALLBACK,
    });

    // Initial camera position (no physics; set every frame in update()).
    cam.centerOn(state.player.x, state.player.y);

    if (!this.scene.isActive(SCENE.hud)) this.scene.launch(SCENE.hud);
    else this.scene.bringToTop(SCENE.hud);

    try {
      getAudio().startMusic();
    } catch (err) {
      session.platform.log('[GameScene] startMusic failed', err);
    }

    this.wirePause();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  update(time: number, delta: number): void {
    if (this.broken) return;
    try {
      this.frame(time, delta);
    } catch (err) {
      this.fail(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  private frame(time: number, delta: number): void {
    const session = this.session;
    const sim = session.sim;
    const state = sim.state;

    // 0. View size contract: the sim reads ctx.view (world px, zoom 1) for spawn
    // distances/density, so mirror the current camera size before advancing.
    const cam = this.cameras.main;
    fitCameraToCanvas(this); // camera can be created at a stale size on restart in the RUN host
    const view = sim.ctx.view;
    const zoom = cam.zoom || 1;
    view.width = cam.width / zoom;
    view.height = cam.height / zoom;
    // Joystick activation zone spans the whole (possibly wide) canvas.
    session.input.setScreenSize(this.scale.width, this.scale.height);

    // 1. Input.
    const raw = this.adapter.read();
    const v = session.input.update(raw);
    sim.setInput(v.x, v.y);

    // 2. Dev stress mode (?stress=N): keep N enemies alive, player invincible.
    if (session.flags.stress > 0 && state.outcome === null && state.paused === false) this.applyStress();
    if (this.devLoadout?.god) state.player.hp = state.player.maxHp;

    // 3. Simulate.
    const alpha = sim.advance(delta / 1000);

    // 4. Drain events once; fan out to juice, player renderer and other scenes.
    this.needsRebuild = false;
    state.events.drain(this.onSimEvent);
    if (this.needsRebuild) this.player.rebuild(); // same frame as the event (Req 11.2)

    // 5. Render (interpolated).
    const p = state.player;
    const rx = p.prevX + (p.x - p.prevX) * alpha;
    const ry = p.prevY + (p.y - p.prevY) * alpha;
    this.cameras.main.centerOn(rx, ry);
    this.sky.render(time, delta);
    this.entities.render(alpha, time);
    this.telegraphs.render(alpha, time);
    this.abilities.render(rx, ry, time, delta, this.player.bodyScale);
    this.player.sync(rx, ry, time);
    this.joystick.render(session.input.joystick);
    this.juice.update(time, delta);

    // 6. Upgrade menu (Req 9): UpgradeScene resolves offers and stops itself.
    if (this.upgradeLaunchGuard > 0) this.upgradeLaunchGuard--;
    if (state.paused === 'menu' && state.outcome === null && this.upgradeLaunchGuard === 0) {
      if (!this.scene.isActive(SCENE.upgrade) && !this.scene.isPaused(SCENE.upgrade)) {
        this.scene.launch(SCENE.upgrade);
        this.scene.bringToTop(SCENE.upgrade);
        // scene.launch is queued; don't re-launch before it has actually started.
        this.upgradeLaunchGuard = 2;
      }
    }

    // 7. Run end → results after a short delay.
    if (state.outcome !== null && !this.goingToResults) {
      if (this.resultsTimerMs < 0) this.resultsTimerMs = 0;
      this.resultsTimerMs += delta;
      if (this.resultsTimerMs >= RESULTS_DELAY_MS) {
        this.goingToResults = true;
        if (this.scene.isActive(SCENE.upgrade) || this.scene.isPaused(SCENE.upgrade)) this.scene.stop(SCENE.upgrade);
        this.scene.stop(SCENE.hud);
        this.scene.start(SCENE.results);
      }
    }
  }

  private readonly onSimEvent = (type: EventCode, a: number, b: number, c: number, d: number): void => {
    this.juice.handle(type, a, b, c, d);
    if (type === EventType.partGained || type === EventType.partLevelled || type === EventType.mutation) {
      this.needsRebuild = true;
    }
    this.game.events.emit('sim-event', type, a, b, c, d);
  };

  private applyStress(): void {
    const state = this.session.sim.state;
    const target = Math.min(this.session.flags.stress, state.enemies.capacity);
    const types = state.config.enemies.length;
    const p = state.player;
    p.hp = p.maxHp;
    if (types === 0) return;
    const rng = Math.random;
    let guard = target;
    while (state.enemies.count < target && guard-- > 0) {
      const ang = rng() * Math.PI * 2;
      const dist = 450 + rng() * 350;
      // Round-robin over non-boss types.
      let t = this.stressType++ % types;
      if (state.config.enemies[t].behaviour === 'boss') t = this.stressType++ % types;
      if (spawnEnemy(state, t, p.x + Math.cos(ang) * dist, p.y + Math.sin(ang) * dist) < 0) break;
    }
  }

  // ---------------------------------------------------------------------------
  // Pause wiring (Req 1.7–1.8)
  // ---------------------------------------------------------------------------

  private wirePause(): void {
    const { platform } = this.session;
    const subs: PlatformSubscription[] = [platform.onPause(() => this.autoPause())];
    this.cleanup.push(() => subs.forEach((s) => s.unsubscribe()));

    if (typeof document !== 'undefined') {
      const onVis = (): void => {
        if (document.visibilityState === 'hidden') this.autoPause();
      };
      document.addEventListener('visibilitychange', onVis);
      this.cleanup.push(() => document.removeEventListener('visibilitychange', onVis));
    }
    if (typeof window !== 'undefined') {
      const onBlur = (): void => this.autoPause();
      window.addEventListener('blur', onBlur);
      this.cleanup.push(() => window.removeEventListener('blur', onBlur));
    }

    const ge = this.game.events;
    ge.on('request-pause', this.onRequestPause, this);
    ge.on('request-resume', this.onRequestResume, this);
    this.cleanup.push(() => {
      ge.off('request-pause', this.onRequestPause, this);
      ge.off('request-resume', this.onRequestResume, this);
    });

    const esc = this.input.keyboard?.addKey('ESC');
    if (esc) {
      const onEsc = (): void => {
        this.game.events.emit('request-pause');
      };
      esc.on('down', onEsc);
      this.cleanup.push(() => esc.off('down', onEsc));
    }
  }

  /** Idempotent: host pause/sleep, tab hidden or window blur. Only the HUD overlay resumes. */
  private autoPause(): void {
    if (this.autoPaused || this.broken) return;
    const sim = this.session.sim;
    if (sim.state.outcome !== null) return;
    this.autoPaused = true;
    sim.pause('auto');
    try {
      getAudio().setSuspended(true);
    } catch {
      // Audio is optional.
    }
    this.game.events.emit('pause-changed', true, 'auto');
  }

  private onRequestPause(): void {
    const sim = this.session.sim;
    if (this.broken || sim.state.outcome !== null || sim.state.paused !== false) return;
    sim.pause('user');
    this.game.events.emit('pause-changed', true, 'user');
  }

  private onRequestResume(): void {
    const sim = this.session.sim;
    sim.resume();
    this.autoPaused = false;
    try {
      getAudio().setSuspended(false);
    } catch {
      // Audio is optional.
    }
    this.game.events.emit('pause-changed', false);
  }

  // ---------------------------------------------------------------------------
  // Error boundary
  // ---------------------------------------------------------------------------

  private fail(err: unknown): void {
    this.broken = true;
    const session = this.session;
    try {
      session.sim.pause('user');
      session.platform.log('[GameScene] frame error', err instanceof Error ? (err.stack ?? err.message) : err);
    } catch {
      console.error('[GameScene] frame error', err);
    }
    const sw = this.scale.width;
    const sh = this.scale.height;
    const cx = sw / 2;
    const cy = sh / 2;
    const top = DEPTH.overlay + 20;
    // Oversized so it still covers the screen if the window grows afterwards.
    this.add.rectangle(cx, cy, sw * 4, sh * 4, 0x000000, 0.6).setScrollFactor(0).setDepth(top);
    this.add
      .text(cx, cy - 60, 'Something broke — restart run', {
        fontFamily: FONT,
        fontSize: '40px',
        color: PALETTE.text,
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 80 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(top + 1);
    const btn = this.add
      .text(cx, cy + 60, 'Restart', {
        fontFamily: FONT,
        fontSize: '44px',
        color: '#140f2e',
        backgroundColor: '#fff6a8',
        padding: { x: 36, y: 18 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(top + 1)
      .setInteractive({ useHandCursor: true });
    btn.once('pointerup', () => {
      try {
        session.sim.restart();
      } catch (e) {
        session.platform.log('[GameScene] restart failed', e);
      }
      this.scene.restart();
    });
  }

  private onShutdown(): void {
    for (const fn of this.cleanup) {
      try {
        fn();
      } catch {
        // Ignore cleanup errors.
      }
    }
    this.cleanup = [];
    this.adapter?.destroy();
    this.juice?.destroy();
    this.entities?.destroy();
    this.telegraphs?.destroy();
    this.abilities?.destroy();
    this.player?.destroy();
    this.sky?.destroy();
    this.joystick?.destroy();
  }
}
