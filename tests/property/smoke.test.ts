import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

describe('fast-check setup smoke', () => {
  it('integer addition is commutative', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a);
      }),
      { numRuns: 100 },
    );
  });
});
