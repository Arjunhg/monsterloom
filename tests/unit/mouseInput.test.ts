import { describe, expect, it } from 'vitest';
import { InputManager, MOUSE_FULL_SPEED_DIST, type RawInput } from '../../src/sim/input/InputManager';

function raw(over: Partial<RawInput> = {}): RawInput {
  return { keys: { up: false, down: false, left: false, right: false }, touchEvent: false, keyEvent: false, ...over };
}

describe('mouse hold-to-move', () => {
  it('moves toward the cursor from the screen centre, full speed far away', () => {
    const im = new InputManager(false);
    im.setScreenSize(2773, 1560);
    const cx = 2773 / 2;
    const cy = 780;
    const far = im.update(raw({ mouse: { active: true, x: cx + 1000, y: cy } }));
    expect(far.x).toBeCloseTo(1);
    expect(far.y).toBeCloseTo(0);
    const near = im.update(raw({ mouse: { active: true, x: cx, y: cy + MOUSE_FULL_SPEED_DIST / 2 } }));
    expect(near.y).toBeCloseTo(0.5);
    expect(im.joystick.visible).toBe(false);
  });

  it('stops when the button is released and on the centre dead zone', () => {
    const im = new InputManager(false);
    expect(im.update(raw()).x).toBe(0);
    const v = im.update(raw({ mouse: { active: true, x: 360 + 5, y: 780 } }));
    expect(v.x).toBe(0);
  });

  it('keys take priority while held, and mouse never switches to touch mode', () => {
    const im = new InputManager(false);
    const v = im.update(raw({ keys: { up: true, down: false, left: false, right: false }, mouse: { active: true, x: 1000, y: 780 } }));
    expect(v.y).toBeCloseTo(-1);
    expect(v.x).toBe(0);
    expect(im.mode).toBe('keyboard');
  });

  it('works on touch-capable laptops too (leaves touch mode)', () => {
    const im = new InputManager(true);
    im.update(raw({ mouse: { active: true, x: 1000, y: 780 } }));
    expect(im.mode).toBe('keyboard');
  });
});
