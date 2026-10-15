/**
 * Floating joystick view (Req 2.4–2.6): base at the touch origin, knob at the
 * clamped offset. Screen-space (scrollFactor 0); mirrors InputManager.joystick.
 */
import Phaser from 'phaser';
import { DEPTH, TEX } from '../game/keys';
import type { JoystickState } from '../sim/input/InputManager';

export class JoystickView {
  private readonly base: Phaser.GameObjects.Image;
  private readonly knob: Phaser.GameObjects.Image;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly radius: number,
  ) {
    this.base = scene.add.image(0, 0, '__WHITE').setScrollFactor(0).setDepth(DEPTH.overlay + 1).setAlpha(0.45);
    this.knob = scene.add.image(0, 0, '__WHITE').setScrollFactor(0).setDepth(DEPTH.overlay + 2).setAlpha(0.8);
    this.base.setVisible(false);
    this.knob.setVisible(false);
  }

  render(js: JoystickState): void {
    if (!js.visible) {
      if (this.base.visible) {
        this.base.setVisible(false);
        this.knob.setVisible(false);
      }
      return;
    }
    this.ensureTextures();
    this.base.setPosition(js.x, js.y).setVisible(true);
    this.knob.setPosition(js.knobX, js.knobY).setVisible(true);
  }

  destroy(): void {
    this.base.destroy();
    this.knob.destroy();
  }

  private ensureTextures(): void {
    const tex = this.scene.textures;
    if (this.base.texture.key === '__WHITE' && tex.exists(TEX.joystickBase)) this.base.setTexture(TEX.joystickBase);
    if (this.knob.texture.key === '__WHITE' && tex.exists(TEX.joystickKnob)) this.knob.setTexture(TEX.joystickKnob);
    // Size the base to the joystick radius so the knob's travel matches the visual ring.
    const bw = Math.max(1, this.base.frame.width);
    this.base.setScale((this.radius * 2) / bw);
    const kw = Math.max(1, this.knob.frame.width);
    this.knob.setScale((this.radius * 0.8) / kw);
  }
}
