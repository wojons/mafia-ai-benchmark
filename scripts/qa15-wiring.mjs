/**
 * Wired-module assertions for QA-MAFIA-AI-BENCHMARK-15.
 *
 * These cells RUN at module load (top level) — with a --test-name-pattern
 * filter that matches nothing, Node's test runner still loads every file
 * under scripts/, so the assertions fire there (a throw = suite failure);
 * `node --test --test-name-pattern=NO_SUCH_PATTERN scripts/qa15-wiring.mjs`
 * is the invocation. Plain `node scripts/qa15-wiring.mjs` runs them once too.
 *
 * Locks the MODULE WIRING the defect ran through (the vitest suite covers
 * behavior; the CI act leg died on the WIRING — the module shape):
 *   - response-parser.js keeps a dual ESM + CommonJS shape (both export
 *     forms; game-engine.js:698's plain require() consumes the CJS shape
 *     via the ESM-CJS interop, and without it Node throws ERR_REQUIRE_ESM
 *     on runners where that interop is unavailable).
 *   - game-engine.js still requires the parser (engine wiring intact).
 *   - the two ESM consumers keep their NAMED imports (no createRequire
 *     shim needed under the dual shape).
 *   - a fresh subprocess exercises the parser + gate THROUGH a plain
 *     require() — the exact module shape game-engine.js uses — so the
 *     assertions observe the wired surface, not a pre-existing ESM alias.
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 1. The file keeps BOTH export forms (dual shape).
const src = readFileSync(
  path.join(root, 'packages', 'shared', 'src', 'agents', 'response-parser.js'),
  'utf8'
);
assert.ok(
  /module\.exports\s*=\s*__module_shape;/.test(src) &&
    /const __module_shape\s*=\s*\{\s*clean,\s*parseAgentResponse,\s*createSayQualityGate\s*\};/.test(src),
  'CRITICAL: response-parser.js lost its module.exports dual-CJS shape - game-engine.js:698 require() would throw ERR_REQUIRE_ESM on require(esm)-less runners again'
);
assert.ok(
  /export function parseAgentResponse/.test(src) &&
    /export function createSayQualityGate/.test(src) &&
    /export function clean/.test(src),
  'CRITICAL: response-parser.js lost its ESM named exports (ESM consumers import them by name)'
);

// 2. The legacy engine still requires the parser (its CJS shape).
const engine = readFileSync(path.join(root, 'game-engine.js'), 'utf8');
assert.ok(
  engine.includes('require("./packages/shared/src/agents/response-parser")'),
  'CRITICAL: game-engine.js no longer requires the shared response-parser - legacy engine wiring severed'
);

// 3. ESM consumers keep NAMED imports (a createRequire shim would be dead
//    code under the dual shape).
for (const consumer of ['run-real-game.ts', 'packages/shared/src/__tests__/agents/response-parser.test.ts']) {
  const text = readFileSync(path.join(root, consumer), 'utf8');
  assert.match(text, /from\s+'[^']*response-parser\.js'/, `${consumer}: ESM named import missing`);
  assert.ok(!text.includes('createRequire'), `${consumer} carries a createRequire shim (dead code under the dual shape)`);
}

// 4. FRESH-subprocess behavior cells through a plain require() — the exact
//    shape game-engine.js:698 uses. On the UNFIXED file this subprocess dies
//    with ERR_REQUIRE_ESM from game-engine's requireStack (RED); on the
//    FIXED dual shape it prints "wire-check function" (GREEN).
execFileSync(
  process.execPath,
  [
    '-e',
    [
      "const m = require('./packages/shared/src/agents/response-parser');",
      "console.log('wire-check', typeof m.parseAgentResponse, typeof m.clean, typeof m.createSayQualityGate);",
      "if (typeof m.parseAgentResponse !== 'function' || typeof m.clean !== 'function' || typeof m.createSayQualityGate !== 'function') process.exit(1);",
    ].join('\n'),
  ],
  { cwd: root, stdio: 'inherit' }
);

// 5. Parser behavior through the ESM-CJS interop view (this file is ESM; the
//    require() here resolves the dual-shape file the same way the engine's
//    require chain does under interop).
const req = createRequire(path.join(root, 'game-engine.js'));
const m = req('./packages/shared/src/agents/response-parser.js');
assert.strictEqual(typeof m.parseAgentResponse, 'function');
assert.strictEqual(typeof m.clean, 'function');
assert.strictEqual(typeof m.createSayQualityGate, 'function');
assert.deepStrictEqual(m.parseAgentResponse('THINK: t\nSAYS: hello world'), {
  think: 't',
  says: 'hello world',
  action: null,
  format: 'markers',
});
assert.deepStrictEqual(m.parseAgentResponse('{"think":"a","says":"b"}'), {
  think: 'a',
  says: 'b',
  action: null,
  format: 'json',
});
const gate = m.createSayQualityGate();
assert.strictEqual(gate.check('p1', 'hello'), 'hello');
assert.strictEqual(gate.check('p1', 'hello'), null); // consecutive duplicate dropped
gate.reset();
assert.deepStrictEqual(m.parseAgentResponse('just a plain sentence'), {
  think: '',
  says: 'just a plain sentence',
  action: null,
  format: 'plain',
});

console.log('qa15-wiring assertions passed (CJS shape + ESM exports + behavior through require())');