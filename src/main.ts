import Phaser from 'phaser';
import HelloWorldScene from './scenes/HelloWorldScene';
import './style.css';
import RundotGameAPI from "@series-inc/rundot-game-sdk/api";

let bootStep1Fired = false;

RundotGameAPI.lifecycles.onPause(() => {
  RundotGameAPI.analytics.recordCustomEvent('game_paused');
});
RundotGameAPI.lifecycles.onResume(() => {
  RundotGameAPI.analytics.recordCustomEvent('game_resumed');
});
RundotGameAPI.lifecycles.onSleep(() => {
  RundotGameAPI.analytics.recordCustomEvent('game_sleep');
});
RundotGameAPI.lifecycles.onQuit(() => {
  RundotGameAPI.analytics.recordCustomEvent('game_quit');
});

async function bootstrap(): Promise<void> {
  try {
    // Create Phaser game
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: 720,
      height: 1560,
      parent: "app",
      backgroundColor: "#2c3e50",
      scene: HelloWorldScene,
      physics: {
        default: "arcade",
        arcade: {
          gravity: { x: 0, y: 0 },
          debug: false,
        },
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    };

    new Phaser.Game(config);
    RundotGameAPI.analytics.recordCustomEvent('game_loaded');
    if (!bootStep1Fired) {
      bootStep1Fired = true;
      RundotGameAPI.analytics.trackFunnelStep(1, 'game_loaded', 'boot', 1);
    }
    RundotGameAPI.log("[Main] Phaser game created");
  } catch (error) {
    console.error("[Main] Bootstrap error:", error);
  }
}

// Start the app
bootstrap();
