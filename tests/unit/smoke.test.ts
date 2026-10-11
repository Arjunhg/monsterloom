import { describe, expect, it } from 'vitest';

describe('test setup smoke', () => {
  it('runs unit tests in the Node environment', () => {
    expect(typeof process.versions.node).toBe('string');
    expect(1 + 1).toBe(2);
  });
});
