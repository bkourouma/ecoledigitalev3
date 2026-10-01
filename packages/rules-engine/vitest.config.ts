import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['spike/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 88,
      },
    },
  },
});
