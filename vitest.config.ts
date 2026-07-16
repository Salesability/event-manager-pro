import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
      'eslint-plugins/**/*.test.ts',
      'scripts/seeds/**/*.test.ts',
    ],
    // tests/integration/ runs against the remote sandbox pooler (per-query
    // wire round trips, not local Postgres) — the 5s default flakes whenever
    // latency drifts. Suite-wide ceiling: unit tests finish in ms so the
    // looser bound is inert for them; a genuinely hung test still fails at 15s.
    testTimeout: 15_000,
  },
});
