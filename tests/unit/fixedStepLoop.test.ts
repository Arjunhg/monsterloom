import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../../src/sim/FixedStepLoop';

const STEP = 1 / 60;

describe('FixedStepLoop', () => {
  it('runs whole steps and carries the remainder', () => {
    const loop = new FixedStepLoop(STEP, 5);
    let steps = 0;
    const a1 = loop.advance(STEP * 2.5, () => steps++);
    expect(steps).toBe(2);
    expect(a1).toBeCloseTo(0.5, 5);
    loop.advance(STEP * 0.6, () => steps++);
    expect(steps).toBe(3);
  });

  it('caps steps per frame and discards leftover whole steps', () => {
    const loop = new FixedStepLoop(STEP, 5);
    let steps = 0;
    loop.advance(STEP * 10.25, () => steps++);
    expect(steps).toBe(5);
    steps = 0;
    loop.advance(0, () => steps++);
    expect(steps).toBe(0); // leftover was discarded, not replayed
  });

  it('clamps real delta to 0.25 s', () => {
    const loop = new FixedStepLoop(STEP, 1000);
    let steps = 0;
    loop.advance(10, () => steps++);
    // 0.25 / (1/60) = 15; allow 14 for float rounding on the last step.
    expect(steps).toBeGreaterThanOrEqual(14);
    expect(steps).toBeLessThanOrEqual(15);
  });

  it('returns alpha in [0, 1)', () => {
    const loop = new FixedStepLoop(STEP, 5);
    for (const d of [0, STEP * 0.3, STEP * 0.999, STEP, 0.1, 5]) {
      const a = loop.advance(d, () => {});
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('does not step or accumulate while paused', () => {
    const loop = new FixedStepLoop(STEP, 5);
    let paused = true;
    let steps = 0;
    loop.advance(STEP * 3, () => steps++, () => paused);
    expect(steps).toBe(0);
    paused = false;
    loop.advance(0, () => steps++, () => paused);
    expect(steps).toBe(0);
  });

  it('stops remaining steps when a step pauses the sim', () => {
    const loop = new FixedStepLoop(STEP, 5);
    let paused = false;
    let steps = 0;
    loop.advance(STEP * 4, () => {
      steps++;
      paused = true;
    }, () => paused);
    expect(steps).toBe(1);
  });
});
