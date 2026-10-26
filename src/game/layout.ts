/**
 * Layout helpers for Scale.EXPAND. The canvas is at least GAME_WIDTH × GAME_HEIGHT
 * logical px and grows along the window's longer axis, so full-screen things use
 * scene.scale.width/height while UI content stays a GAME_WIDTH-wide column centred
 * horizontally (and vertically when the canvas is taller than GAME_HEIGHT).
 */
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './keys';

export interface ColumnLayout {
  /** Full canvas size (logical px). */
  width: number;
  height: number;
  /** Top-left of the GAME_WIDTH × GAME_HEIGHT UI column. */
  ox: number;
  oy: number;
}

/**
 * Makes the scene's main camera cover the whole canvas. Phaser only resizes a
 * camera on RESIZE events when it still had the previous size, and a camera
 * created on scene (re)start can pick up a stale size inside the RUN host
 * iframe (seen as "Another night" rendering in a portrait strip). Cheap to call
 * every frame. Returns true if it had to resize.
 */
export function fitCameraToCanvas(scene: Phaser.Scene): boolean {
  const cam = scene.cameras.main;
  if (!cam) return false;
  const w = scene.scale.width;
  const h = scene.scale.height;
  if (cam.x === 0 && cam.y === 0 && cam.width === w && cam.height === h) return false;
  cam.setViewport(0, 0, w, h);
  return true;
}

/**
 * Keeps the camera fitted every frame and calls `onSizeChange` whenever the
 * canvas size differs from the last laid-out size, even if no RESIZE event fired.
 */
export function keepFitted(scene: Phaser.Scene, onSizeChange?: () => void): void {
  let lastW = scene.scale.width;
  let lastH = scene.scale.height;
  const tick = (): void => {
    fitCameraToCanvas(scene);
    const w = scene.scale.width;
    const h = scene.scale.height;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    onSizeChange?.();
  };
  fitCameraToCanvas(scene);
  scene.events.on(Phaser.Scenes.Events.PRE_UPDATE, tick);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, tick));
}

export function columnLayout(scene: Phaser.Scene): ColumnLayout {
  const width = scene.scale.width;
  const height = scene.scale.height;
  return {
    width,
    height,
    ox: Math.max(0, Math.round((width - GAME_WIDTH) / 2)),
    oy: Math.max(0, Math.round((height - GAME_HEIGHT) / 2)),
  };
}

/**
 * Calls `fn` once the canvas size has settled (`ms` after the last RESIZE event
 * that actually changed the size). The listener is removed on scene shutdown.
 */
export function onResizeSettled(scene: Phaser.Scene, fn: () => void, ms = 150): void {
  let lastW = scene.scale.width;
  let lastH = scene.scale.height;
  let timer: Phaser.Time.TimerEvent | null = null;
  const handler = (): void => {
    const w = scene.scale.width;
    const h = scene.scale.height;
    if (Math.abs(w - lastW) < 0.5 && Math.abs(h - lastH) < 0.5) return;
    lastW = w;
    lastH = h;
    timer?.remove(false);
    timer = scene.time.delayedCall(ms, () => {
      timer = null;
      fn();
    });
  };
  scene.scale.on(Phaser.Scale.Events.RESIZE, handler);
  // Also poll each frame: inside the RUN host iframe a size change can be missed.
  scene.events.on(Phaser.Scenes.Events.PRE_UPDATE, handler);
  fitCameraToCanvas(scene);
  const fit = (): void => void fitCameraToCanvas(scene);
  scene.events.on(Phaser.Scenes.Events.PRE_UPDATE, fit);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.scale.off(Phaser.Scale.Events.RESIZE, handler);
    scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, handler);
    scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, fit);
    timer?.remove(false);
    timer = null;
  });
}
