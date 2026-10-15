/**
 * Phaser → RawInput adapter (Req 2). Collects keyboard (arrows + WASD) and
 * pointer state each frame; InputManager (pure) turns it into a vector.
 *
 * - touchEvent: any pointer down / move-while-down / up happened since the last read().
 * - keyEvent: a movement key went from up to down since the last read().
 * - The first pointer that goes down while none is tracked becomes the joystick
 *   touch; its down position is the origin. Pointer coords are logical canvas
 *   coords (Phaser's pointer.x/y are already in game space).
 */
import Phaser from 'phaser';
import type { RawInput } from '../sim/input/InputManager';

type KeyName = 'up' | 'down' | 'left' | 'right';

export class InputAdapter {
  private readonly raw: RawInput = {
    keys: { up: false, down: false, left: false, right: false },
    touch: undefined,
    touchEvent: false,
    keyEvent: false,
  };
  private readonly touch = { active: false, originX: 0, originY: 0, x: 0, y: 0 };
  private trackedId = -1;
  private touchEventPending = false;
  private readonly keys: Array<{ key: Phaser.Input.Keyboard.Key; dir: KeyName }> = [];
  private readonly prevDown: boolean[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (kb) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      const map: Array<[number, KeyName]> = [
        [K.UP, 'up'],
        [K.W, 'up'],
        [K.DOWN, 'down'],
        [K.S, 'down'],
        [K.LEFT, 'left'],
        [K.A, 'left'],
        [K.RIGHT, 'right'],
        [K.D, 'right'],
      ];
      for (const [code, dir] of map) {
        this.keys.push({ key: kb.addKey(code, true, false), dir });
        this.prevDown.push(false);
      }
    }
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
  }

  /** Builds this frame's RawInput (reused object) and clears per-frame flags. */
  read(): RawInput {
    const raw = this.raw;
    const k = raw.keys;
    k.up = k.down = k.left = k.right = false;
    let keyEvent = false;
    for (let i = 0; i < this.keys.length; i++) {
      const { key, dir } = this.keys[i];
      const down = key.isDown;
      if (down) k[dir] = true;
      if (down && !this.prevDown[i]) keyEvent = true;
      this.prevDown[i] = down;
    }
    raw.keyEvent = keyEvent;
    raw.touchEvent = this.touchEventPending;
    this.touchEventPending = false;
    raw.touch = this.touch.active ? this.touch : undefined;
    return raw;
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
  }

  private onDown(p: Phaser.Input.Pointer): void {
    this.touchEventPending = true;
    if (this.trackedId !== -1) return;
    this.trackedId = p.id;
    const t = this.touch;
    t.active = true;
    t.originX = t.x = p.x;
    t.originY = t.y = p.y;
  }

  private onMove(p: Phaser.Input.Pointer): void {
    // A hovering mouse is not a touch interaction.
    if (!p.isDown && p.id !== this.trackedId) return;
    this.touchEventPending = true;
    if (p.id !== this.trackedId) return;
    this.touch.x = p.x;
    this.touch.y = p.y;
  }

  private onUp(p: Phaser.Input.Pointer): void {
    this.touchEventPending = true;
    if (p.id !== this.trackedId) return;
    this.trackedId = -1;
    this.touch.active = false;
    this.touch.x = p.x;
    this.touch.y = p.y;
  }
}
