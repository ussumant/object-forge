import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
});
