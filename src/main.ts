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
        autoCenter: Phaser.Scale.CENTER_BOTH,
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
  let pending = false;
  const check = (): void => {
    if (pending) return;
    const r = app.getBoundingClientRect();
    const c = game.canvas?.getBoundingClientRect();
    if (!c || !(r.width > 0) || !(r.height > 0)) return;
    // EXPAND makes the canvas exactly fill #app, with a backing store equal to the
    // logical game size and the same aspect ratio as #app. Any mismatch means the
    // scale is stale or something outside Phaser resized the canvas (seen in the
    // RUN host): the game then draws a 720-wide portrait strip on a wide canvas.
    const cv = game.canvas;
    const sw = game.scale.width;
    const sh = game.scale.height;
    const cssStale = Math.abs(c.width - r.width) > 1.5 || Math.abs(c.height - r.height) > 1.5;
    const backingStale = Math.abs(cv.width - Math.floor(sw)) > 1 || Math.abs(cv.height - Math.floor(sh)) > 1;
    const aspectStale = sh > 0 && Math.abs(sw / sh - r.width / r.height) > 0.02;
    if (!cssStale && !backingStale && !aspectStale) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      game.scale.getParentBounds();
      game.scale.refresh();
      console.info(
        `[mms] refit: app ${Math.round(r.width)}x${Math.round(r.height)}, canvas css ${Math.round(c.width)}x${Math.round(c.height)}, ` +
          `backing ${cv.width}x${cv.height}, scale ${Math.round(sw)}x${Math.round(sh)} -> ${Math.round(game.scale.width)}x${Math.round(game.scale.height)}`,
      );
    });
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(check).observe(app);
  window.addEventListener('resize', check);
  window.setInterval(check, 500);
  // A few early checks while the host is still settling its layout.
  for (const ms of [50, 250, 1000, 2500]) window.setTimeout(check, ms);
}
