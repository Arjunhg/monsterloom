import Phaser from 'phaser';
import './style.css';
import { initSession } from './game/Session';
import { getAudio } from './juice/AudioManager';
import { GAME_HEIGHT, GAME_WIDTH, PALETTE } from './game/keys';
import { installRotateHint } from './game/rotateHint';
import type { PlatformService } from './platform/PlatformService';
import { FakePlatform } from './platform/FakePlatform';
import BootScene from './scenes/BootScene';
import TitleScene from './scenes/TitleScene';
import GameScene from './scenes/GameScene';
import HudScene from './scenes/HudScene';
import UpgradeScene from './scenes/UpgradeScene';
import ResultsScene from './scenes/ResultsScene';

let bootStep1Fired = false;

/**
 * Phaser 3.90 implements Scale.EXPAND (6) at runtime, but its typings don't list it
 * in the ScaleModes enum, hence the cast.
 */
const SCALE_EXPAND = ((Phaser.Scale as unknown as { EXPAND?: number }).EXPAND ?? 6) as Phaser.Scale.ScaleModeType;

/** Lifecycle analytics (template pattern, routed through PlatformService). */
function wireLifecycleAnalytics(platform: PlatformService): void {
  // PlatformService.onPause covers both host pause and sleep.
  platform.onPause(() => platform.track('game_paused'));
  platform.onResume(() => platform.track('game_resumed'));
}

/**
 * RUN SDK platform, falling back to FakePlatform when the SDK is unavailable
 * (e.g. plain `npm run dev` outside the host). The SDK module is imported
 * dynamically so a failing import is also caught.
 */
async function createPlatform(): Promise<PlatformService> {
  try {
    const { RundotPlatform } = await import('./platform/RundotPlatform');
    const platform = new RundotPlatform();
    wireLifecycleAnalytics(platform);
    return platform;
  } catch (err) {
    console.warn('[Main] RUN SDK unavailable, using FakePlatform:', err);
    const platform = new FakePlatform({ echoLogs: true });
    wireLifecycleAnalytics(platform);
    return platform;
  }
}

async function bootstrap(): Promise<void> {
  installRotateHint();
  const platform = await createPlatform();
  initSession(platform);
  // Create the audio manager now so its gesture listeners exist before the first tap/key.
  getAudio();

  try {
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      parent: 'app',
      backgroundColor: PALETTE.night,
      pixelArt: true,
      roundPixels: true,
      input: { activePointers: 2 },
      scene: [BootScene, TitleScene, GameScene, HudScene, UpgradeScene, ResultsScene],
      scale: {
        // EXPAND: 720×1560 is the minimum logical area; the canvas grows along the
        // longer window axis so it always fills the window (no letterbox bars).
        mode: SCALE_EXPAND,
        // NO_CENTER: the EXPAND canvas exactly fills #app (pinned to the
        // viewport in style.css), so centering margins are always 0; Phaser's
        // margin math on a stale measurement would only shift the canvas.
        autoCenter: Phaser.Scale.NO_CENTER,
      },
    };

    const game = new Phaser.Game(config);
    watchHostSize(game);
    // Dev-only handle for local smoke tests and console debugging.
    if (import.meta.env.DEV) (window as unknown as { __mmsGame?: Phaser.Game }).__mmsGame = game;
    platform.track('game_loaded');
    if (!bootStep1Fired) {
      bootStep1Fired = true;
      platform.funnel(1, 'game_loaded', 'boot', 1);
    }
    platform.log('[Main] Phaser game created');
  } catch (error) {
    console.error('[Main] Bootstrap error:', error);
    platform.track('bootstrap_failed', { error: String(error) });
  }
}

void bootstrap();

/**
 * The RUN host resizes the game iframe after load (e.g. adds its top bar, or
 * starts portrait-shaped and then expands). Phaser only measures its parent on
 * window resize, so it can keep a stale size: the game then renders in a narrow
 * strip or is offset. Re-measure whenever #app's size actually changes, and poll
 * as a fallback for hosts where no event fires.
 */
function watchHostSize(game: Phaser.Game): void {
  const app = document.getElementById('app');
  if (!app) return;
  // The RUN embedded-library Phaser build (phaser@3.90.0 from the host CDN)
  // has an EXPAND branch that updates baseSize and the canvas but NOT
  // gameSize, unlike the npm build used locally. Everything in the game read
  // scene.scale.width (= gameSize), so on the deployed build the logical
  // size stayed 720×1560 inside a wide canvas: a portrait strip at the left.
  // Mirror baseSize into gameSize whenever Phaser refreshes the scale.
  const syncLogicalSize = (): void => {
    if (game.scale.scaleMode !== SCALE_EXPAND) return;
    const bs = game.scale.baseSize;
    const gs = game.scale.gameSize;
    if (Math.abs(gs.width - bs.width) > 1 || Math.abs(gs.height - bs.height) > 1) {
      gs.setSize(bs.width, bs.height);
    }
  };
  game.scale.on(Phaser.Scale.Events.RESIZE, syncLogicalSize);
  const check = (): void => {
    syncLogicalSize();
    const cv = game.canvas;
    if (!cv) return;
    // Expected display size: #app is pinned to the viewport (see style.css),
    // so its rect is the truth. If a host still collapses it to zero area,
    // fall back to the window size rather than trusting a degenerate rect.
    const r = app.getBoundingClientRect();
    const w = r.width > 0 ? r.width : window.innerWidth;
    const h = r.height > 0 ? r.height : window.innerHeight;
    if (!(w > 0) || !(h > 0)) return;
    // EXPAND makes the canvas exactly fill #app, with a backing store equal to the
    // logical game size and the same aspect ratio as #app. Any mismatch means the
    // scale is stale or something outside Phaser resized the canvas (seen in the
    // RUN host): the game then draws a 720-wide portrait strip on a wide canvas.
    const c = cv.getBoundingClientRect();
    const sw = game.scale.width;
    const sh = game.scale.height;
    const cssStale = Math.abs(c.width - w) > 1.5 || Math.abs(c.height - h) > 1.5;
    const backingStale = Math.abs(cv.width - Math.floor(sw)) > 1 || Math.abs(cv.height - Math.floor(sh)) > 1;
    const aspectStale = sh > 0 && Math.abs(sw / sh - w / h) > 0.02;
    const parentStale =
      Math.abs(game.scale.parentSize.width - w) > 1 || Math.abs(game.scale.parentSize.height - h) > 1;
    if (!cssStale && !backingStale && !aspectStale && !parentStale) return;
    // Synchronous refit. The previous version deferred to requestAnimationFrame:
    // while the host keeps the frame hidden or 0-sized (pre-reveal) rAF never
    // fires, so its `pending` flag latched and disabled every later check, and
    // the game stayed at whatever size Phaser first measured. setParentSize
    // also overwrites a parent size Phaser cached before the host settled.
    game.scale.setParentSize(Math.round(w), Math.round(h));
    console.info(
      `[mms] refit: expected ${Math.round(w)}x${Math.round(h)}, canvas css ${Math.round(c.width)}x${Math.round(c.height)}, ` +
        `backing ${cv.width}x${cv.height}, scale ${Math.round(sw)}x${Math.round(sh)} -> ${Math.round(game.scale.width)}x${Math.round(game.scale.height)}`,
    );
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(check).observe(app);
  window.addEventListener('resize', check);
  window.addEventListener('orientationchange', check);
  document.addEventListener('fullscreenchange', check);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.visualViewport?.addEventListener('resize', check);
  window.setInterval(check, 500);
  // A few early checks while the host is still settling its layout.
  for (const ms of [50, 250, 1000, 2500]) window.setTimeout(check, ms);
  check();
}
