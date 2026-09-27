#!/usr/bin/env node
/**
 * Copy the plain-CommonJS bridge services into dist/ after tsc.
 *
 * apps/server carries three hand-written CommonJS modules under
 * src/services/ (legacy-bridge.js, legacy-usage-collector.js,
 * server-game-engine.js) that tsc never emits: the tsconfig has no
 * allowJs and the build is bare `tsc`. The shipped production start
 * (`pnpm --filter @mafia/server start` -> `node dist/index.js`) spawns
 * dist/services/legacy-bridge.js (LegacyGameAdapter.bridgeScriptPath),
 * which did not exist — every game died with
 * `Cannot find module .../dist/services/legacy-bridge.js`.
 *
 * The dev/tsx path and the Docker path run from src/ and were never
 * affected. This step makes dist/ self-contained so both worlds work.
 * Run automatically as part of this package's `build` script.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(pkgRoot, 'src', 'services');
const outDir = path.join(pkgRoot, 'dist', 'services');

const FILES = ['legacy-bridge.js', 'legacy-usage-collector.js', 'server-game-engine.js'];

mkdirSync(outDir, { recursive: true });
for (const file of FILES) {
  copyFileSync(path.join(srcDir, file), path.join(outDir, file));
  console.log(`[copy-legacy-services] dist/services/${file}`);
}
