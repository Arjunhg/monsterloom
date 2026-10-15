/**
 * Adaptive particle quality (Req 16.7–16.8). Pure, no Phaser dependency.
 *
 * Tracks an exponential moving average of frame time. When the EMA fps stays
 * below `lowFps` for `downAfterMs` continuously, `particleScale` drops one step
 * (1.0 → 0.75 → 0.5 → 0.35). When it stays above `highFps` for `upAfterMs`
 * continuously, it recovers one step. Both timers reset after every step.
 * Only `particleScale` is exposed: nothing else is degraded (Req 16.8).
 */
export interface QualityScalerOptions {
  lowFps?: number;
  highFps?: number;
  downAfterMs?: number;
  upAfterMs?: number;
  /** EMA smoothing factor in (0, 1]; higher reacts faster. */
  alpha?: number;
  /** Frame times are clamped to this, so one huge hitch (tab switch, GC) counts as a short slow frame. */
  maxFrameMs?: number;
  steps?: readonly number[];
}

export const DEFAULT_QUALITY_STEPS: readonly number[] = [1.0, 0.75, 0.5, 0.35];

export class QualityScaler {
  private readonly lowFps: number;
  private readonly highFps: number;
  private readonly downAfterMs: number;
  private readonly upAfterMs: number;
  private readonly alpha: number;
  private readonly maxFrameMs: number;
  private readonly steps: readonly number[];

  private stepIndex = 0;
  private emaMs = 1000 / 60;
  private lowMs = 0;
  private highMs = 0;

  constructor(opts: QualityScalerOptions = {}) {
    this.lowFps = opts.lowFps ?? 45;
    this.highFps = opts.highFps ?? 55;
    this.downAfterMs = opts.downAfterMs ?? 5000;
    this.upAfterMs = opts.upAfterMs ?? 10000;
    this.alpha = opts.alpha ?? 0.1;
    this.maxFrameMs = opts.maxFrameMs ?? 250;
    this.steps = opts.steps && opts.steps.length > 0 ? opts.steps : DEFAULT_QUALITY_STEPS;
  }

  /** Multiplier applied to every particle burst count. */
  get particleScale(): number {
    return this.steps[this.stepIndex];
  }

  /** Feed one frame's duration in milliseconds. Non-finite / non-positive values are ignored. */
  update(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return;
    const dt = Math.min(frameMs, this.maxFrameMs);
    this.emaMs += (dt - this.emaMs) * this.alpha;
    const fps = 1000 / this.emaMs;

    if (fps < this.lowFps) {
      this.highMs = 0;
      this.lowMs += dt;
      if (this.lowMs >= this.downAfterMs) {
        if (this.stepIndex < this.steps.length - 1) this.stepIndex++;
        this.resetTimers();
      }
    } else if (fps > this.highFps) {
      this.lowMs = 0;
      this.highMs += dt;
      if (this.highMs >= this.upAfterMs) {
        if (this.stepIndex > 0) this.stepIndex--;
        this.resetTimers();
      }
    } else {
      this.resetTimers();
    }
  }

  reset(): void {
    this.stepIndex = 0;
    this.emaMs = 1000 / 60;
    this.resetTimers();
  }

  private resetTimers(): void {
    this.lowMs = 0;
    this.highMs = 0;
  }
}
