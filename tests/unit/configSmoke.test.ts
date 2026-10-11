import { describe, expect, it } from 'vitest';
import { GAME_CONFIG, thresholdFor, validateConfig } from '../../src/data';

describe('config smoke', () => {
  it('default GAME_CONFIG is valid', () => {
    expect(validateConfig(GAME_CONFIG)).toEqual([]);
  });

  it('thresholdFor is strictly increasing for n in 0..50', () => {
    for (let n = 0; n < 50; n++) {
      expect(thresholdFor(n + 1, GAME_CONFIG.balance)).toBeGreaterThan(
        thresholdFor(n, GAME_CONFIG.balance),
      );
    }
  });
});
