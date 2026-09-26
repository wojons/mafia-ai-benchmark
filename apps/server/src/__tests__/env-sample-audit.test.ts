/**
 * MAF-GAP-072 — .env.sample audit guard.
 *
 * Acceptance criteria (from the board row):
 *  1. Every uncommented variable in .env.sample has >= 1 non-test source
 *     reader (server process OR legacy game-engine child process).
 *  2. The dead-variable list documented in CONFIG_GUIDE.md contains only
 *     names that truly have no non-test reader.
 *
 * Reader discovery is source-only and mirrors the manual audit: a line is a
 * reader candidate when it mentions the variable name and either
 *   a) touches the process environment (process.env.NAME, process.env["NAME"],
 *      or a line naming the var inside a file that resolves env keys
 *      dynamically via `process.env?.[...]`), or
 *   b) declares the name (const/let/var NAME =) inside a file that reads the
 *      environment somewhere (engine constants live near their env readers).
 * Test files, dist output and docs are excluded — only non-test source counts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ -> src -> apps/server -> apps -> repo root
const repoRoot = resolve(here, '..', '..', '..', '..');

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'coverage', '__tests__', '.git', 'data', 'games',
  'saved-games', 'archive', '.gitreins', '.coding-hermes', '.opencode',
]);
const CODE_EXTS = new Set(['.ts', '.js', '.mjs', '.cjs', '.tsx', '.sh']);
const TEST_FILE = /(__tests__|\.test\.|\.spec\.)/;

function walk(dir, out = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out);
    } else if (
      CODE_EXTS.has(extname(entry)) &&
      !TEST_FILE.test(full) &&
      !full.includes('/dist/') &&
      !full.includes('/node_modules/')
    ) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles: { file: string; text: string }[] = [
  ...walk(resolve(repoRoot, 'apps')),
  ...walk(resolve(repoRoot, 'packages')),
  ...walk(resolve(repoRoot, 'game-engine')),
  ...walk(resolve(repoRoot, 'scripts')),
  resolve(repoRoot, 'game-engine.js'),
  resolve(repoRoot, 'run-real-game.ts'),
  resolve(repoRoot, 'mafia.sh'),
  resolve(repoRoot, 'mafia-players.sh'),
]
  .filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  })
  .map((file) => {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      text = '';
    }
    return { file, text };
  });

/** Reader-candidate lines for env var `name` (see header comment). */
function readerLines(name: string): { file: string; line: number; text: string }[] {
  const hits: { file: string; line: number; text: string }[] = [];
  const bare = name.replace(/[^A-Za-z0-9_]/g, '');
  const nameRe = new RegExp(`\\b${bare}\\b`);
  const declRe = new RegExp(`\\b(?:const|let|var)\\s+${bare}\\b\\s*=`);
  for (const { file, text } of sourceFiles) {
    const dynamicEnvMap = text.includes('process.env?.[');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!nameRe.test(line)) continue;
      const touchesEnv = /process\.env|\benv\b\s*[?.]?[[.]/.test(line);
      const isDecl = declRe.test(line) && text.includes('process.env');
      const inDynamicMap = dynamicEnvMap && line.includes(name);
      if (touchesEnv || isDecl || inDynamicMap) {
        hits.push({ file, line: i + 1, text: line.trim().slice(0, 140) });
      }
    }
  }
  return hits;
}

function parseUncommentedSampleVars(): string[] {
  const vars: string[] = [];
  for (const raw of readFileSync(resolve(repoRoot, '.env.sample'), 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (m) vars.push(m[1]);
  }
  return vars;
}

/**
 * Names documented as dead in CONFIG_GUIDE.md: ALL_CAPS backticked tokens
 * from the FIRST cell of each table row in the given section (multi-name
 * rows yield every name they list). Reason cells are ignored — they may
 * cite live names for contrast.
 */
function parseGuideDeadNames(): string[] {
  const md = readFileSync(resolve(repoRoot, 'CONFIG_GUIDE.md'), 'utf8');
  const sectionStart = md.indexOf('### Removed (dead) variables');
  expect(sectionStart, 'CONFIG_GUIDE dead-variable section missing').toBeGreaterThanOrEqual(0);
  const names: string[] = [];
  for (const line of md.slice(sectionStart).split('\n')) {
    if (!line.startsWith('| ')) {
      if (names.length > 0) break; // table ended
      continue;
    }
    const firstCell = line.split('|')[1] ?? '';
    for (const m of firstCell.matchAll(/`([A-Z][A-Z0-9_]+)`/g)) {
      if (!names.includes(m[1])) names.push(m[1]);
    }
  }
  return names;
}

const DOCUMENTED_DEAD_VARS = parseGuideDeadNames();

describe('.env.sample audit (MAF-GAP-072)', () => {
  it('has uncommented entries', () => {
    expect(parseUncommentedSampleVars().length).toBeGreaterThan(0);
  });

  it('every uncommented variable has >= 1 non-test source reader', () => {
    const failures: string[] = [];
    for (const name of parseUncommentedSampleVars()) {
      const readers = readerLines(name);
      if (readers.length === 0) failures.push(name);
      expect(
        readers.length,
        `${name}: expected a non-test reader, found none`,
      ).toBeGreaterThan(0);
    }
    expect(failures, `no non-test reader for: ${failures.join(', ')}`).toEqual([]);
  });

  it('documents a non-empty dead-variable list', () => {
    expect(DOCUMENTED_DEAD_VARS.length).toBeGreaterThan(10);
  });

  it('every documented dead variable truly has no non-test reader', () => {
    for (const name of DOCUMENTED_DEAD_VARS) {
      const readers = readerLines(name);
      expect(
        readers,
        `${name} is documented dead but has readers: ` +
          readers.map((r) => `${r.file}:${r.line}`).join('; '),
      ).toEqual([]);
    }
  });

  it('pins the primary reader of every live variable (drift alarm)', () => {
    // Substring pinned per variable — the doc matrix cites these sites.
    const pinned: Record<string, string> = {
      OPENAI_API_KEY: 'process.env.OPENAI_API_KEY',
      OPENAI_BASE_URL: 'process.env.OPENAI_BASE_URL',
      DEFAULT_MODEL: 'process.env.DEFAULT_MODEL',
      MAFIA_MODEL: 'process.env.MAFIA_MODEL',
      DOCTOR_MODEL: 'process.env.DOCTOR_MODEL',
      SHERIFF_MODEL: 'process.env.SHERIFF_MODEL',
      VIGILANTE_MODEL: 'process.env.VIGILANTE_MODEL',
      VILLAGER_MODEL: 'process.env.VILLAGER_MODEL',
      PERSONA_TEMPERATURE: 'process.env.PERSONA_TEMPERATURE',
      MAX_CONTEXT_CHARS: 'process.env.MAX_CONTEXT_CHARS',
      MAX_RETRIES: 'process.env.MAX_RETRIES',
      RETRY_DELAY_MS: 'process.env.RETRY_DELAY_MS',
      ALLOW_MULTI_ROLE: 'process.env.ALLOW_MULTI_ROLE',
      LOG_LEVEL: 'process.env.LOG_LEVEL',
      PORT: 'process.env.PORT',
      DB_PATH: 'process.env.DB_PATH',
      NODE_ENV: 'process.env.NODE_ENV',
    };
    for (const [name, needle] of Object.entries(pinned)) {
      const found = sourceFiles.some((f) => f.text.includes(needle));
      expect(
        found,
        `${name}: pinned reader "${needle}" vanished from the source tree`,
      ).toBe(true);
    }
  });
});
