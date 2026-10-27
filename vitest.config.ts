import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration faults, role grants and queue-health audits share one DB.
    // Concurrency is exercised deliberately inside the two-instance scenarios.
    fileParallelism: false,
    // Includes real network round trips and Neon scale-to-zero wake-up.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
