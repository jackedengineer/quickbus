import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Includes real network round trips and Neon scale-to-zero wake-up.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
