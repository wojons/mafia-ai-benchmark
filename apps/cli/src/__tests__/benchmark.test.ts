/**
 * Tests for BenchmarkCommand (MAF-GAP-010 / MAF-GAP-015).
 *
 * The command must display the REAL accumulated benchmark report fetched from
 * the server — never fabricated Math.random numbers. With --games/--models it
 * now POSTs a fresh run and polls it to completion (MAF-GAP-015). These tests
 * spawn the actual CLI (`node tsx-cli src/index.ts ...`) with process.argv-like
 * arguments, matching parse.test.ts (MAF-GAP-009).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { BenchmarkCommand } from '../commands/benchmark';

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

async function runCli(cwd: string, args: string[], timeoutMs = 60000): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [tsxCli, cliEntry, ...args],
      { cwd, env: process.env, timeout: timeoutMs }
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
    'lists --server/--json/--export/--games/--models now that runs are wired',
    async () => {
      const cwd = makeTempCwd();
      const { stdout, stderr, code } = await runCli(cwd, ['benchmark', '--help']);

      expect(stderr).toBe('');
      expect(code).toBe(0);
      expect(stdout).toContain('--server');
      expect(stdout).toContain('--json');
      expect(stdout).toContain('--export');
      expect(stdout).toContain('--quick');
      // Fresh-run options are now real and advertised (MAF-GAP-015).
      expect(stdout).toContain('--games');
      expect(stdout).toContain('--models');
      // --parallel stays accepted (backward compat) and visible.
      expect(stdout).toContain('--parallel');
    },
    90000
  );

  it(
    'does NOT advertise the stale "not yet available" warning in --help',
    async () => {
      const cwd = makeTempCwd();
      const { stdout } = await runCli(cwd, ['benchmark', '--help']);
      expect(stdout).not.toContain('Fresh benchmark runs are not yet available');
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

// --- MAF-GAP-062: fresh-game runs cost REAL money and are explicit opt-in ---
//
// The test below POSTs a fresh run and polls it until real LLMs finish playing
// a REAL game against the server (6-10 minutes, real OpenRouter credits). An
// ordinary test-suite run must never trigger it: it only executes when BOTH
// the server is reachable AND the operator explicitly opts in via
// MAFIA_LIVE_BENCHMARK=1.
describe.skipIf(
  !SERVER_AVAILABLE || process.env.MAFIA_LIVE_BENCHMARK !== '1'
)('benchmark fresh game run (live server, opt-in via MAFIA_LIVE_BENCHMARK=1)', () => {
  it(
    '--games 1 --models <pair> POSTs a run, polls progress, and prints the report',
    async () => {
      const cwd = makeTempCwd();
      // A real LLM-driven mafia game can take 2-6 minutes end-to-end; allow 12.
      const { stdout, stderr, code } = await runCli(cwd, [
        'benchmark', '--games', '1',
        '--models', 'openai/gpt-4o-mini,openai/gpt-4o',
        '--json', '--server', TEST_BASE_URL,
      ], 12 * 60 * 1000);

      expect(stderr).toBe('');
      expect(code).toBe(0);
      // The stale warning is gone.
      expect(stdout).not.toContain('Fresh benchmark runs are not yet available');
      // A runId was returned by the POST and printed.
      expect(stdout).toMatch(/runId[: ]/);
      // A terminal completion line was printed.
      expect(stdout).toMatch(/completed/i);

      // It must still print the real report JSON.
      const printed = extractJson(stdout);
      expect(typeof printed.summary?.totalGames).toBe('number');
      expect(Array.isArray(printed.modelPerformance)).toBe(true);
    },
    12 * 60 * 1000
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
      // No fabricated run output.
      expect(stdout).not.toContain('Testing model');
    },
    90000
  );
});

// --- MAF-GAP-047: pairwise error message + progress heartbeat (mocked fetch, no live server) ---

/** Minimal fetch Response stand-in for mocked endpoints. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

type RunBenchmarkOpts = { games?: string; models?: string; json?: boolean };
type RunBenchmarkFn = (serverUrl: string, opts: RunBenchmarkOpts) => Promise<unknown>;

/** Access the private runBenchmark method (unit-test seam; it throws/rejects
 *  instead of catching + process.exit like the public run()). */
function runBenchmarkOf(cmd: BenchmarkCommand): RunBenchmarkFn {
  return (cmd as unknown as { runBenchmark: RunBenchmarkFn }).runBenchmark.bind(cmd);
}

/** A status-poll body: RUNNING (or any status) with the given completedGames. */
function statusBody(status: string, completedGames: number): Record<string, unknown> {
  return {
    success: true,
    data: {
      status,
      progress: {
        runId: 'run-heartbeat-1',
        status,
        totalGames: 2,
        completedGames,
        validGames: completedGames,
        failedGames: 0,
        pairings: [],
      },
    },
  };
}

const START_BODY = {
  success: true,
  data: {
    runId: 'run-heartbeat-1',
    totalGames: 2,
    pairings: [{ id: 'p1', modelA: 'openai/gpt-4o-mini', modelB: 'openai/gpt-4o', games: 1 }],
  },
};

const REPORT_BODY = {
  summary: { totalGames: 2, completedGames: 2 },
  modelPerformance: [],
  recommendations: [],
};

describe('benchmark single-model guard (MAF-GAP-047)', () => {
  it(
    'rejects with a pairwise (head-to-head) explanation when only 1 model is given',
    async () => {
      const cmd = new BenchmarkCommand();
      await expect(
        runBenchmarkOf(cmd)('http://localhost:3004', { games: '1', models: 'openai/gpt-4o-mini' })
      ).rejects.toThrow(/pairwise/);
    },
    10000
  );
});

describe('benchmark progress heartbeat (MAF-GAP-047)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it(
    'prints a heartbeat line while completedGames is stuck at 0, without per-poll spam',
    async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // 1 POST + 9 RUNNING polls (completedGames stuck at 0) + 1 COMPLETED poll + 1 report fetch.
      // Heartbeat interval is 15s; with 2s polls the heartbeat fires on poll 9 (elapsed 18s),
      // BEFORE any completedGames advance.
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(START_BODY))
        .mockResolvedValueOnce(jsonResponse(statusBody('RUNNING', 0)))
        .mockResolvedValueOnce(jsonResponse(statusBody('RUNNING', 0)))
        .mockResolvedValueOnce(jsonResponse(statusBody('RUNNING', 0)))
        .mockResolvedValueOnce(jsonResponse(statusBody('RUNNING', 0)))
        .mockResolvedValueOnce(jsonResponse(statusBody('RUNNING', 0)))
        .mockResolvedValueOnce(jsonResponse(statusBody('RUNNING', 0)))
        .mockResolvedValueOnce(jsonResponse(statusBody('RUNNING', 0)))
        .mockResolvedValueOnce(jsonResponse(statusBody('RUNNING', 0)))
        .mockResolvedValueOnce(jsonResponse(statusBody('RUNNING', 0)))
        .mockResolvedValueOnce(jsonResponse(statusBody('COMPLETED', 2)))
        .mockResolvedValueOnce(jsonResponse(REPORT_BODY));
      vi.stubGlobal('fetch', fetchMock);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

      const cmd = new BenchmarkCommand();
      const runPromise = runBenchmarkOf(cmd)('http://localhost:3004', {
        games: '1',
        models: 'openai/gpt-4o-mini,openai/gpt-4o',
      });

      // Advance fake time in 2s poll steps: 10 polls ≈ 20s, plus slack for the report fetch.
      for (let i = 0; i < 12; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }
      await runPromise;

      const printed = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');

      // The heartbeat line appears while completedGames never advanced past 0:
      // poll 9 at elapsed 18s is still RUNNING 0/2.
      expect(printed).toContain('⏳ [RUNNING] 0/2 games completed (elapsed 18s)');
      // Elapsed seconds are included on progress lines.
      expect(printed).toContain('(elapsed ');
      // Exactly 3 progress lines across 10 polls (advance @ poll 1, heartbeat @ poll 9,
      // advance @ poll 10) — NOT one line per poll.
      expect(printed.match(/games completed/g)).toHaveLength(3);
    },
    10000
  );
});

// --- MAF-GAP-059: report presentation (mocked report, no live server) ---

type DisplayResultsFn = (report: unknown) => void;

/** Access the private displayResults method (unit-test seam, same as runBenchmarkOf). */
function displayResultsOf(cmd: BenchmarkCommand): DisplayResultsFn {
  return (cmd as unknown as { displayResults: DisplayResultsFn }).displayResults.bind(cmd);
}

/** Report body mirroring the live server's row shapes (2026-08-25). */
const GAP059_REPORT = {
  summary: { totalGames: 1467 },
  modelPerformance: [
    { provider: 'openai', model: 'gpt-4o-mini', gamesPlayed: 1198, wins: 543, winRate: 0.4533, avgTokens: 60116, avgCost: 0.0118 },
    // The unattributable legacy floor: provider CUSTOM, slash-less bare model,
    // wins 0 because usage-only rows carry no side data (MAF-GAP-036/039).
    { provider: 'CUSTOM', model: 'openai', gamesPlayed: 208, wins: 0, winRate: 0, avgTokens: 810196, avgCost: 0.1584 },
    { provider: 'openai', model: 'gpt-4o', gamesPlayed: 54, wins: 33, winRate: 0.6111, avgTokens: 110572, avgCost: 0.0059 },
  ],
  recommendations: [],
};

describe('benchmark report presentation (MAF-GAP-059)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the unattributable 0-win row with n/a losses, not a defeat count', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    displayResultsOf(new BenchmarkCommand())(GAP059_REPORT);

    const printed = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');

    // The legacy floor row shows n/a in the Losses position…
    expect(printed).toMatch(/CUSTOM\/openai\s+\d+\s+0\s+n\/a/);
    // …and never presents its games as losses.
    expect(printed).not.toContain('206');
    expect(printed).not.toContain('LOSSES');
  });

  it('keeps the real losses count for rows that DO have wins', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    displayResultsOf(new BenchmarkCommand())(GAP059_REPORT);

    const printed = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');

    // gpt-4o-mini: 1198 games - 543 wins = 655 real losses.
    expect(printed).toMatch(/gpt-4o-mini\s+1198\s+543\s+655\b/);
    // gpt-4o: 54 - 33 = 21.
    expect(printed).toMatch(/gpt-4o\s+54\s+33\s+21\b/);
  });

  it('includes the sample size in the winner banner', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    displayResultsOf(new BenchmarkCommand())(GAP059_REPORT);

    const printed = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');

    expect(printed).toContain('🏆 Winner: openai/gpt-4o (61.1% win rate, 54 games)');
  });

  it('renders row names exactly as the API reports provider/model', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    displayResultsOf(new BenchmarkCommand())(GAP059_REPORT);

    const printed = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');

    // The API row is {provider:'openai', model:'gpt-4o-mini'} → openai/gpt-4o-mini.
    expect(printed).toContain('openai/gpt-4o-mini');
    expect(printed).not.toMatch(/CUSTOM\/gpt-4o-mini/);
    // No CLI-invented drift for any row.
    expect(printed).not.toMatch(/CUSTOM\/CUSTOM\//);
  });
});

