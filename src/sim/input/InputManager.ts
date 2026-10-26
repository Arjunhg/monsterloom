/**
 * Pure input logic (Req 2, 4.3, 14.3). No Phaser / DOM imports.
 *
 * A Phaser-side adapter collects raw events each frame into a `RawInput` and calls
 * `InputManager.update(raw)`, which returns the movement vector (|v| ∈ [0, 1]).
 *
 * Notes / conventions:
 * - `update()` returns a REUSED object (`this.vector`). Copy it if you need to keep it
 *   past the next `update()` call. This avoids a per-frame allocation.
 * - `lastMoveDir` is a unit vector of the last non-zero movement. It defaults to (1, 0)
 *   (facing right) before the player has ever moved. Used as the Auto_Aim fallback (4.3).
 * - Mode switching (2.7, 2.8): `touchEvent` is applied first, then `keyEvent`. If both
 *   flags are set in the same frame, the frame ends in keyboard mode.
 * - A touch "gesture" starts when `touch.active` goes from false to true, or when the
 *   origin changes while active. The activation-zone / HUD check is done once per gesture
 *   on its origin; a rejected gesture produces no joystick and a zero vector until it ends.
 *   A gesture that was interrupted by a switch to keyboard mode is not resumed; the
 *   player has to lift and touch again.
 * - Keys are ignored in touch mode, and touches are ignored in keyboard mode; switching
 *   happens via the `touchEvent` / `keyEvent` flags only.
 */

export type InputMode = 'keyboard' | 'touch';

export interface RawKeys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface RawTouch {
  /** True while the controlling pointer is down. */
  active: boolean;
  /** Where the touch began (logical canvas coords). */
  originX: number;
  originY: number;
  /** Current pointer position (logical canvas coords). */
  x: number;
  y: number;
}

export interface RawInput {
  /** Movement keys held (arrows + WASD already merged by the adapter). */
  keys: RawKeys;
  /** Current touch state, if any touch is tracked. */
  touch?: RawTouch;
  /** A touch event (down / move / up) occurred this frame. */
  touchEvent: boolean;
  /** A movement key press occurred this frame. */
  keyEvent: boolean;
  /**
   * Mouse (desktop) hold-to-move: while the button is held, the player walks
   * toward the cursor. Mouse input never switches to touch mode or shows the joystick.
   */
  mouse?: { active: boolean; x: number; y: number };
}

/** Cursor distance from the screen centre (px) that maps to full speed. */
export const MOUSE_FULL_SPEED_DIST = 160;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface JoystickState {
  visible: boolean;
  /** Joystick base (touch origin). */
  x: number;
  y: number;
  /** Knob position, clamped to `joystickRadius` from the base. */
  knobX: number;
  knobY: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface InputManagerOptions {
  /** Max joystick offset in px mapping to |v| = 1. Default 90. */
  joystickRadius?: number;
  /** Offsets shorter than this (px) yield a zero vector. Default 8. */
  deadZone?: number;
  /** Fraction of the screen height (from the bottom) where a joystick may start. Default 0.6. */
  zoneFraction?: number;
  /** Logical screen size. Default 720 × 1560. */
  screenWidth?: number;
  screenHeight?: number;
  /** Rects where a touch must NOT start a joystick (HUD controls). Default []. */
  hudRects?: Rect[];
}

export const JOYSTICK_RADIUS = 90;
export const DEAD_ZONE = 8;
export const JOYSTICK_ZONE_FRACTION = 0.6;
export const SCREEN_WIDTH = 720;
export const SCREEN_HEIGHT = 1560;

export class InputManager {
  mode: InputMode;
  readonly joystick: JoystickState = { visible: false, x: 0, y: 0, knobX: 0, knobY: 0 };
  /** Unit vector of the last non-zero movement. Default (1, 0). */
  readonly lastMoveDir: Vec2 = { x: 1, y: 0 };

  readonly joystickRadius: number;
  readonly deadZone: number;
  readonly zoneFraction: number;
  /** Logical screen size; updated via setScreenSize() when the canvas resizes. */
  screenWidth: number;
  screenHeight: number;
  private hudRects: Rect[];

  /** Reused return value of `update()`. */
  private readonly vector: Vec2 = { x: 0, y: 0 };

  // Gesture tracking.
  private touchWasActive = false;
  private gestureOriginX = NaN;
  private gestureOriginY = NaN;
  /** Current gesture started inside the zone and is driving the joystick. */
  private gestureEngaged = false;

  constructor(hasTouch: boolean, opts: InputManagerOptions = {}) {
    this.mode = hasTouch ? 'touch' : 'keyboard'; // 2.9
    this.joystickRadius = opts.joystickRadius ?? JOYSTICK_RADIUS;
    this.deadZone = opts.deadZone ?? DEAD_ZONE;
    this.zoneFraction = opts.zoneFraction ?? JOYSTICK_ZONE_FRACTION;
    this.screenWidth = opts.screenWidth ?? SCREEN_WIDTH;
    this.screenHeight = opts.screenHeight ?? SCREEN_HEIGHT;
    this.hudRects = (opts.hudRects ?? []).map((r) => ({ ...r }));
  }

  /** Updates the logical screen size used by the activation zone (canvas resize). */
  setScreenSize(width: number, height: number): void {
    if (Number.isFinite(width) && width > 0) this.screenWidth = width;
    if (Number.isFinite(height) && height > 0) this.screenHeight = height;
  }

  setHudRects(rects: Rect[]): void {
    this.hudRects = rects.map((r) => ({ ...r }));
  }

  getHudRects(): readonly Rect[] {
    return this.hudRects;
  }

  /** True if a touch starting at (x, y) may spawn the joystick (2.4, 14.3). */
  canActivateAt(x: number, y: number): boolean {
    if (x < 0 || x > this.screenWidth || y > this.screenHeight) return false;
    if (y < this.screenHeight * (1 - this.zoneFraction)) return false;
    for (const r of this.hudRects) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return false;
    }
    return true;
  }

  update(raw: RawInput): Vec2 {
    // Mode switching (2.7, 2.8).
    if (raw.touchEvent && this.mode === 'keyboard') this.mode = 'touch';
    if (raw.keyEvent && this.mode === 'touch') {
      this.mode = 'keyboard';
      this.hideJoystick();
      this.gestureEngaged = false;
    }

    this.trackGesture(raw.touch);

    const v = this.vector;
    const m = raw.mouse;
    if (m && m.active) {
      // Hold-to-move with the mouse. Held movement keys still take priority.
      if (this.mode === 'touch') this.mode = 'keyboard';
      this.hideJoystick();
      this.keyboardVector(raw.keys, v);
      if (v.x === 0 && v.y === 0) this.mouseVector(m.x, m.y, v);
    } else if (this.mode === 'keyboard') {
      this.hideJoystick();
      this.keyboardVector(raw.keys, v);
    } else {
      this.touchVector(raw.touch, v);
    }

    if (v.x !== 0 || v.y !== 0) {
      const len = Math.hypot(v.x, v.y);
      this.lastMoveDir.x = v.x / len;
      this.lastMoveDir.y = v.y / len;
    }
    return v;
  }

  /** Detects gesture start / end, independent of mode. */
  private trackGesture(touch: RawTouch | undefined): void {
    const active = !!touch && touch.active;
    if (!active) {
      this.touchWasActive = false;
      this.gestureEngaged = false;
      this.gestureOriginX = NaN;
      this.gestureOriginY = NaN;
      return;
    }
    const isNew =
      !this.touchWasActive || touch.originX !== this.gestureOriginX || touch.originY !== this.gestureOriginY;
    this.touchWasActive = true;
    if (isNew) {
      this.gestureOriginX = touch.originX;
      this.gestureOriginY = touch.originY;
      // Only a gesture that starts in touch mode can engage the joystick.
      this.gestureEngaged = this.mode === 'touch' && this.canActivateAt(touch.originX, touch.originY);
    }
  }

  private keyboardVector(keys: RawKeys, out: Vec2): void {
    // Opposing keys cancel (2.2).
    let x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let y = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    out.x = x;
    out.y = y;
  }

  private touchVector(touch: RawTouch | undefined, out: Vec2): void {
    out.x = 0;
    out.y = 0;
    if (!touch || !touch.active || !this.gestureEngaged) {
      this.hideJoystick(); // 2.6
      return;
    }
    const dx = touch.x - touch.originX;
    const dy = touch.y - touch.originY;
    const dist = Math.hypot(dx, dy);
    const r = this.joystickRadius;
    const k = dist > r ? r / dist : 1; // clamp knob / vector to radius (2.5)

    const js = this.joystick;
    js.visible = true;
    js.x = touch.originX;
    js.y = touch.originY;
    js.knobX = touch.originX + dx * k;
    js.knobY = touch.originY + dy * k;

    if (dist < this.deadZone) return;
    if (dist > r) {
      out.x = dx / dist;
      out.y = dy / dist;
    } else {
      out.x = dx / r;
      out.y = dy / r;
    }
  }

  /** Vector from the screen centre (where the camera keeps the player) toward the cursor. */
  private mouseVector(x: number, y: number, out: Vec2): void {
    const dx = x - this.screenWidth / 2;
    const dy = y - this.screenHeight / 2;
    const dist = Math.hypot(dx, dy);
    if (dist < this.deadZone * 3) {
      out.x = 0;
      out.y = 0;
      return;
    }
    const k = Math.min(1, dist / MOUSE_FULL_SPEED_DIST) / dist;
    out.x = dx * k;
    out.y = dy * k;
  }

  private hideJoystick(): void {
    this.joystick.visible = false;
  }
}
