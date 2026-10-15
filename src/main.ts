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
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    };

    const game = new Phaser.Game(config);
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
