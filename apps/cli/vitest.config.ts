import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Pins FORCE_COLOR=0 before any CLI module (and so chalk) is imported, so
    // output assertions do not depend on the caller's colour env.
    setupFiles: ['src/__tests__/setup.ts'],
  },
});
