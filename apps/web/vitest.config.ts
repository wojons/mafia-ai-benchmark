import { defineConfig } from 'vitest/config';

/**
 * Web app vitest config (DF-MAFIA-AI-BENCHMARK-11).
 *
 * `environment: 'happy-dom'` gives component-mount tests a browser-like DOM.
 * Component sources are type-checked and bundled by vite.config.ts already;
 * this file only configures the TEST runner and keeps `src` included so the
 * existing 33 baseline tests keep running.
 */
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'happy-dom',
    include: ['src/__tests__/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': '/src',
      '@mafia/shared': new URL('../../packages/shared/src', import.meta.url).pathname,
    },
  },
});