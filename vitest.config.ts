import { defineConfig } from 'vitest/config';

// Sim, data and meta code is Phaser-free, so tests run in plain Node.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
