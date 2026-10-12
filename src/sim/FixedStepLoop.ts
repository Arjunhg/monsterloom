/**
 * Fixed-timestep driver (design "FixedStepLoop").
 *
 * - Real frame delta is clamped to MAX_FRAME_DELTA (0.25 s).
 * - At most `maxSteps` steps run per advance(); leftover time beyond that is
 *   discarded so a long frame never makes the sim run in fast-forward.
 * - While paused, no steps run and no time accumulates (Req 9.7).
 */
export const MAX_FRAME_DELTA = 0.25;

export class FixedStepLoop {
  readonly step: number;
  readonly maxSteps: number;
  private accumulator = 0;

  constructor(step = 1 / 60, maxSteps = 5) {
    if (!(step > 0) || !(maxSteps >= 1)) throw new RangeError('FixedStepLoop: invalid step/maxSteps');
    this.step = step;
    this.maxSteps = Math.floor(maxSteps);
  }

  /**
   * Advances by real elapsed seconds, calling `onStep(step)` for each fixed step.
   * `isPaused` is checked before every step, so a step that pauses the sim
   * (e.g. opening the upgrade menu) stops the remaining steps this frame.
   * Returns the interpolation factor α ∈ [0, 1) for rendering.
   */
  advance(realDeltaSec: number, onStep: (dt: number) => void, isPaused?: () => boolean): number {
    if (isPaused?.()) return this.alpha();
    const d = Number.isFinite(realDeltaSec) ? Math.min(Math.max(realDeltaSec, 0), MAX_FRAME_DELTA) : 0;
    this.accumulator += d;

    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      if (isPaused?.()) {
        // Paused mid-frame: drop the remaining time rather than replaying it on resume.
        this.accumulator = 0;
        return 0;
      }
      onStep(this.step);
      this.accumulator -= this.step;
      steps++;
    }
    // Hit the step cap: discard leftover whole steps, keep only the fractional part.
    if (this.accumulator >= this.step) this.accumulator %= this.step;
    return this.alpha();
  }

  reset(): void {
    this.accumulator = 0;
  }

  private alpha(): number {
    const a = this.accumulator / this.step;
    return a < 0 ? 0 : a >= 1 ? 0 : a;
  }
}
