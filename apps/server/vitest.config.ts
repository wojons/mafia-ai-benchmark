import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      // RELEASE-007: the @mafia/shared subpath exports map only to dist/
      // (gitignored), so test runs in a fresh environment without a prior
      // `pnpm build` (e.g. the gitreins guard) fail with
      // "Failed to load url @mafia/shared/agents | @mafia/shared/fsm".
      // Resolve to source instead — same pattern as apps/web/vitest.config.ts
      // (DF-MAFIA-AI-BENCHMARK-11) — so tests pass with or without a build.
      '@mafia/shared': new URL('../../packages/shared/src', import.meta.url).pathname,
    },
  },
});
