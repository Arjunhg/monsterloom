import Phaser from 'phaser';
import { getSession } from '../game/Session';
import { SCENE } from '../game/keys';
import { generatePlaceholders, generateTextures } from '../render/textures';

let bootFunnelFired = false;

/** Generates every texture procedurally, then hands over to the title screen. */
export default class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE.boot);
  }

  create(): void {
    const { platform } = getSession();
    try {
      const keys = generateTextures(this);
      platform.log(`[BootScene] generated ${keys.length} textures`);
    } catch (err) {
      // Req 1.9: never block the game on art; fall back to coloured circles.
      platform.log('[BootScene] texture generation failed, using placeholders', String(err));
      platform.track('asset_load_failed', { stage: 'boot_textures', error: String(err) });
      generatePlaceholders(this);
    }

    if (!bootFunnelFired) {
      bootFunnelFired = true;
      platform.track('boot_complete');
      platform.funnel(2, 'boot_complete', 'boot', 1);
    }
    this.scene.start(SCENE.title);
  }
}
