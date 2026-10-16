/**
 * TelegraphRenderer (task 14.8, design "Rendering", Req 22.3, 24.3).
 *
 * Read-only view of the sim that draws attack telegraphs with a small set of
 * Graphics objects created once and cleared/redrawn every frame (no per-frame
 * allocation):
 *   - bat charge lines: enemies with the 'bat' behaviour in aiState 1 get a red
 *     dashed line along their locked aiDir, brightening as aiTimer → 0;
 *   - circle telegraphs: `drawCircleTelegraph` for boss slams / ring attacks.
 *
 * Call order per frame: `render()` (clears + draws bat lines) first, then any
 * `drawCircleTelegraph()` calls for that frame.
 */
import Phaser from 'phaser';
import { DEPTH } from '../game/keys';
import type { RunState } from '../sim/RunState';

/** Bat aiState values (sim contract): 0 approach, 1 telegraph, 2 charging. */
const BAT_TELEGRAPH = 1;
const LINE_LENGTH = 600;
const DASH = 26;
const GAP = 14;
const LINE_COLOR = 0xff3b3b;
const CIRCLE_COLOR = 0xff3b3b;
const DEFAULT_TELEGRAPH_SEC = 0.75;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class TelegraphRenderer {
  /** Ground-level layer (circle telegraphs), below orbs and enemies. */
  private readonly ground: Phaser.GameObjects.Graphics;
  /** Line layer, just below enemies so the bat sits on top of its own line. */
  private readonly lines: Phaser.GameObjects.Graphics;
  /** Per enemy type: telegraph duration in seconds when the type is a bat, else 0. */
  private readonly batTelegraphSec: number[];
  private readonly view = new Phaser.Geom.Rectangle();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: RunState,
  ) {
    this.ground = scene.add.graphics().setDepth(DEPTH.decal + 1);
    this.lines = scene.add.graphics().setDepth(DEPTH.enemy - 1);
    this.batTelegraphSec = state.config.enemies.map((e) =>
      e.behaviour === 'bat' ? Math.max(0.05, e.behaviourParams?.telegraphSec ?? DEFAULT_TELEGRAPH_SEC) : 0,
    );
  }

  /** Clears last frame's telegraphs and draws the bat charge lines (`alpha` = interpolation factor). */
  render(alpha: number, timeMs: number): void {
    this.ground.clear();
    this.lines.clear();
    const wv = this.scene.cameras.main.worldView;
    const v = this.view;
    v.setTo(wv.x - LINE_LENGTH, wv.y - LINE_LENGTH, wv.width + LINE_LENGTH * 2, wv.height + LINE_LENGTH * 2);

    const e = this.state.enemies;
    const ids = e.pool.activeIds;
    for (let k = 0; k < e.count; k++) {
      const id = ids[k];
      if (e.aiState[id] !== BAT_TELEGRAPH) continue;
      const dur = this.batTelegraphSec[e.typeId[id]] ?? 0;
      if (dur <= 0) continue;
      const x = e.prevX[id] + (e.x[id] - e.prevX[id]) * alpha;
      const y = e.prevY[id] + (e.y[id] - e.prevY[id]) * alpha;
      if (x < v.x || x > v.right || y < v.y || y > v.bottom) continue;
      const dx = e.aiDirX[id];
      const dy = e.aiDirY[id];
      if (dx === 0 && dy === 0) continue;
      const t01 = clamp01(1 - e.aiTimer[id] / dur);
      this.drawBatLine(x, y, dx, dy, t01, timeMs);
    }
  }

  /**
   * Generic circular telegraph (boss slam, ring attacks). `t01` is the charge
   * progress: 0 = just started, 1 = about to hit. Draws for the current frame only.
   */
  drawCircleTelegraph(x: number, y: number, r: number, t01: number): void {
    const t = clamp01(t01);
    const g = this.ground;
    g.fillStyle(CIRCLE_COLOR, 0.1 + 0.15 * t);
    g.fillCircle(x, y, r);
    // Inner fill grows towards the edge as the attack charges.
    g.fillStyle(CIRCLE_COLOR, 0.18 + 0.22 * t);
    g.fillCircle(x, y, r * t);
    g.lineStyle(4 + 2 * t, CIRCLE_COLOR, 0.45 + 0.5 * t);
    g.strokeCircle(x, y, r);
  }

  destroy(): void {
    this.ground.destroy();
    this.lines.destroy();
  }

  private drawBatLine(x: number, y: number, dx: number, dy: number, t01: number, timeMs: number): void {
    const g = this.lines;
    // Normalise defensively; the sim promises a unit vector.
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const base = 0.25 + 0.7 * t01;
    const width = 3 + 3 * t01;
    // Dashes crawl forward so the line reads as "incoming".
    const offset = ((timeMs * 0.12) % (DASH + GAP)) - (DASH + GAP);
    for (let s = offset; s < LINE_LENGTH; s += DASH + GAP) {
      const s0 = Math.max(0, s);
      const s1 = Math.min(LINE_LENGTH, s + DASH);
      if (s1 <= s0) continue;
      // Fade out along the length.
      const a = base * (1 - (s0 / LINE_LENGTH) * 0.8);
      g.lineStyle(width, LINE_COLOR, a);
      g.lineBetween(x + ux * s0, y + uy * s0, x + ux * s1, y + uy * s1);
    }
    // Bright warning dot under the bat, pulsing faster as the charge nears.
    const pulse = 0.5 + 0.5 * Math.sin(timeMs * (0.01 + 0.03 * t01));
    g.fillStyle(LINE_COLOR, base * (0.4 + 0.4 * pulse));
    g.fillCircle(x, y, 10 + 6 * t01);
  }
}
