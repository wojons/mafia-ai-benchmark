/**
 * Tests for BenchmarkCommand (MAF-GAP-010).
 *
 * The command must display the REAL accumulated benchmark report fetched from
 * the server — never fabricated Math.random numbers. These tests spawn the
 * actual CLI (`node tsx-cli src/index.ts ...`) with process.argv-like
 * arguments, matching parse.test.ts (MAF-GAP-009).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { createRequire } from 'module';

const execFileAsync = promisify(execFile);
const nodeRequire = createRequire(__filename);

// Resolve the tsx CLI entry (devDependency of @mafia/cli) and the CLI entry point.
const tsxCli = nodeRequire.resolve('tsx/cli');
const cliEntry = path.resolve(__dirname, '../index.ts');

const TEST_BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3004';

const tmpDirs: string[] = [];

function makeTempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mafiactl-benchmark-'));
  tmpDirs.push(dir);
  return dir;
}

async function runCli(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [tsxCli, cliEntry, ...args],
      { cwd, env: process.env, timeout: 60000 }
    );
    return { stdout, stderr, code: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      code: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

/**
 * Extract the pretty-printed JSON payload from stdout (the CLI prints a
 * banner and a "Fetching..." line before the JSON body).
 */
function extractJson(stdout: string): Record<string, any> {
  const start = stdout.indexOf('{');
  if (start === -1) {
    throw new Error(`No JSON found in stdout:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(start));
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Pre-test probe: the live-report tests require a reachable mafia server.
 * Skipped with a clear message otherwise (same pattern as apps/server
 * api.test.ts's skipIf probe).
 *
 * This package compiles as CommonJS, so the probe must be synchronous —
 * it spawns a throwaway node process that fetches the report endpoint.
 */
function probeReportEndpoint(baseUrl: string): boolean {
  const script = [
    `const url = ${JSON.stringify(`${baseUrl}/api/v1/benchmark/report`)};`,
    "fetch(url, { signal: AbortSignal.timeout(3000) })",
    ".then((r) => (r.ok ? process.exit(0) : process.exit(2)))",
    ".catch(() => process.exit(1));",
  ].join(' ');
  try {
    execFileSync(process.execPath, ['-e', script], { timeout: 10000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const SERVER_AVAILABLE = probeReportEndpoint(TEST_BASE_URL);

if (!SERVER_AVAILABLE) {
  console.warn(`\n⚠️  Skipping live-server benchmark tests: no server reachable at ${TEST_BASE_URL}\n`);
}

describe('benchmark --help (parse level)', () => {
  it(
    'lists --server/--json/--export/--quick and NOT the removed pretend-run options',
    async () => {
      const cwd = makeTempCwd();
      const { stdout, stderr, code } = await runCli(cwd, ['benchmark', '--help']);

      expect(stderr).toBe('');
      expect(code).toBe(0);
      expect(stdout).toContain('--server');
      expect(stdout).toContain('--json');
      expect(stdout).toContain('--export');
      expect(stdout).toContain('--quick');
      // Pretend-run options must no longer be advertised.
      expect(stdout).not.toContain('--games');
      expect(stdout).not.toContain('--models');
      expect(stdout).not.toContain('--parallel');
    },
    90000
  );
});

describe.skipIf(!SERVER_AVAILABLE)('benchmark report (live server)', () => {
  it(
    '--quick --json prints the REAL report fields, matching a direct fetch',
    async () => {
      const cwd = makeTempCwd();
      const { stdout, stderr, code } = await runCli(cwd, ['benchmark', '--quick', '--json', '--server', TEST_BASE_URL]);

      expect(stderr).toBe('');
      expect(code).toBe(0);

      const printed = extractJson(stdout);
      expect(typeof printed.summary?.totalGames).toBe('number');
      expect(Array.isArray(printed.modelPerformance)).toBe(true);

      // The printed values must equal the server's real report — not
      // Math.random fabrications (e.g. avgCost in the old invented 1-3 range).
      const response = await fetch(`${TEST_BASE_URL}/api/v1/benchmark/report`, { signal: AbortSignal.timeout(30000) });
      expect(response.ok).toBe(true);
      const serverReport = await response.json() as Record<string, any>;

      expect(printed.summary.totalGames).toBe(serverReport.summary.totalGames);
      expect(printed.modelPerformance).toEqual(serverReport.modelPerformance);
      expect(printed.recommendations).toEqual(serverReport.recommendations);
    },
    90000
  );

  it(
    'legacy --games/--models/--parallel are accepted with a yellow note and still show the report',
    async () => {
      const cwd = makeTempCwd();
      const { stdout, stderr, code } = await runCli(cwd, [
        'benchmark', '--quick', '--games', '10', '--models', 'a,b', '--parallel',
        '--json', '--server', TEST_BASE_URL,
      ]);

      expect(stderr).toBe('');
      expect(code).toBe(0);
      expect(stdout).toContain('Fresh benchmark runs are not yet available');

      // It must still print the real report (no fabricated benchmark run).
      const printed = extractJson(stdout);
      expect(typeof printed.summary?.totalGames).toBe('number');
      expect(Array.isArray(printed.modelPerformance)).toBe(true);
    },
    90000
  );

  it(
    '--export writes the fetched report to the file',
    async () => {
      const cwd = makeTempCwd();
      const outPath = path.join(cwd, 'report.json');
      const { stdout, stderr, code } = await runCli(cwd, ['benchmark', '--quick', '--export', outPath, '--server', TEST_BASE_URL]);

      expect(stderr).toBe('');
      expect(code).toBe(0);
      expect(stdout).toContain('Results exported to');

      expect(existsSync(outPath)).toBe(true);
      const written = JSON.parse(readFileSync(outPath, 'utf-8'));
      expect(typeof written.summary?.totalGames).toBe('number');
      expect(Array.isArray(written.modelPerformance)).toBe(true);
    },
    90000
  );
});

describe('benchmark (unreachable server)', () => {
  it(
    'exits 1 with a clear connection error',
    async () => {
      const cwd = makeTempCwd();
      const { stdout, stderr, code } = await runCli(cwd, ['benchmark', '--quick', '--server', 'http://localhost:59999']);

      expect(code).toBe(1);
      expect(stderr).toContain('❌ Cannot connect to server');
      expect(stderr).toContain('http://localhost:59999');
      // The legacy pretend-run note is printed before the fetch attempt.
      expect(stdout).not.toContain('Testing model');
    },
    90000
  );
});
