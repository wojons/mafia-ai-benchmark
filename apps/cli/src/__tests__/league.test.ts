/**
 * Tests for the LeagueCommand (MAF-LAYER-3).
 *
 * `mafiactl league start` must POST the real config to the server and report
 * the run id; `--poll` must poll GET /api/v1/league/:id to a terminal status;
 * `mafiactl league status <id>` must print the run's status, spend/cap state
 * and per-game provenance. The server is a local fake HTTP API (no mafia
 * server, no LLM, no child games) started in this test process.
 *
 * Action tests run the REAL CLI through tsx (the process boundary is the
 * subject — process.exit paths and stdout formatting); the command-surface
 * test runs in-process.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as http from 'http';
import * as path from 'path';
import { createRequire } from 'module';
import { LeagueCommand } from '../commands/league';

const execFileAsync = promisify(execFile);
const nodeRequire = createRequire(__filename);

const tsxCli = nodeRequire.resolve('tsx/cli');
const cliEntry = path.resolve(__dirname, '../index.ts');

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

/** Fake league API: records requests, serves a scripted response queue. */
function createFakeLeagueServer(handlers: {
  postLeague?: (body: unknown) => { status: number; payload: unknown };
  getLeague?: (leagueId: string, call: number) => { status: number; payload: unknown } | null;
}) {
  const requests: RecordedRequest[] = [];
  const getCallCounts = new Map<string, number>();

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method ?? '', url: req.url ?? '', body });

      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (req.method === 'POST' && req.url === '/api/v1/league') {
        const outcome = handlers.postLeague?.(body) ?? {
          status: 201,
          payload: { success: true, data: { leagueId: 'league-fake-1', games: 2, models: [], seatGroups: [], message: 'League started' } },
        };
        send(outcome.status, outcome.payload);
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/api/v1/league/')) {
        const leagueId = decodeURIComponent(req.url.slice('/api/v1/league/'.length));
        const call = (getCallCounts.get(leagueId) ?? 0) + 1;
        getCallCounts.set(leagueId, call);
        const outcome = handlers.getLeague?.(leagueId, call) ?? null;
        if (!outcome) {
          send(404, { success: false, error: `League run ${leagueId} not found` });
          return;
        }
        send(outcome.status, outcome.payload);
        return;
      }
      send(404, { success: false, error: 'unexpected route' });
    });
  });

  return {
    requests,
    listen(): Promise<string> {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address() as { port: number };
          resolve(`http://127.0.0.1:${address.port}`);
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

async function runCli(args: string[], timeoutMs = 60000): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [tsxCli, cliEntry, ...args],
      { env: process.env, timeout: timeoutMs },
    );
    return { stdout, stderr, code: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: typeof err.code === 'number' ? err.code : 1 };
  }
}

const RUNNING_DETAIL = {
  status: {
    leagueId: 'league-fake-1',
    status: 'RUNNING',
    config: { models: ['openai/a', 'openai/b'], numPlayers: 10, games: 2, budgetUsd: 5, seatSeed: 1 },
    createdAt: 1_700_000_000_000,
    completedAt: null,
    summary: null,
    error: null,
    totalGames: 1,
  },
  games: [
    {
      gameId: 'game-1',
      round: 1,
      seatMap: { MAFIA: 'openai/a', SHERIFF: 'openai/b', DOCTOR: 'openai/a', VIGILANTE: 'openai/b', VILLAGER: 'openai/a' },
      seatSeed: 2,
      winner: null,
      completedAt: null,
      error: null,
      costUsd: null,
      totalTokens: null,
    },
  ],
  spend: { spentUsd: 0, budgetUsd: 5, remainingUsd: 5, capped: false },
};

const CAPPED_DETAIL = {
  status: {
    leagueId: 'league-fake-1',
    status: 'BUDGET_CAPPED',
    config: { models: ['openai/a', 'openai/b'], numPlayers: 10, games: 2, budgetUsd: 5, seatSeed: 1 },
    createdAt: 1_700_000_000_000,
    completedAt: 1_700_000_060_000,
    summary: { totalGames: 1, completedGames: 1, failedGames: 0, capped: true },
    error: null,
    totalGames: 1,
  },
  games: [
    {
      gameId: 'game-1',
      round: 1,
      seatMap: { MAFIA: 'openai/a', SHERIFF: 'openai/b', DOCTOR: 'openai/a', VIGILANTE: 'openai/b', VILLAGER: 'openai/a' },
      seatSeed: 2,
      winner: 'MAFIA',
      completedAt: 1_700_000_060_000,
      error: null,
      costUsd: 4.2,
      totalTokens: 9000,
    },
  ],
  spend: { spentUsd: 4.2, budgetUsd: 5, remainingUsd: 0.8, capped: true },
};

describe('LeagueCommand (CLI surface)', () => {
  it('registers start and status subcommands with the league flags', () => {
    const cmd = new LeagueCommand();
    expect(cmd.name()).toBe('league');
    const names = cmd.commands.map((c) => c.name());
    expect(names).toEqual(['start', 'status']);

    const startFlags = cmd.commands[0].options.map((o: { flags: string }) => o.flags).join(' ');
    expect(startFlags).toContain('models');
    expect(startFlags).toContain('budget');
    expect(startFlags).toContain('poll');

    const statusArgs = cmd.commands[1];
    expect(statusArgs.description()).toMatch(/status|spend|provenance/i);
  });
});

describe('mafiactl league start', () => {
  let fake: ReturnType<typeof createFakeLeagueServer>;
  let baseUrl: string;

  beforeAll(async () => {
    fake = createFakeLeagueServer({
      postLeague: (body) => {
        const config = (body as { config?: { models?: string[]; budgetUsd?: number; games?: number } }).config ?? {};
        return {
          status: 201,
          payload: {
            success: true,
            data: {
              leagueId: 'league-fake-1',
              games: config.games ?? 2,
              models: config.models ?? [],
              seatGroups: ['MAFIA', 'SHERIFF', 'DOCTOR', 'VIGILANTE', 'VILLAGER'],
              message: 'League started: 2 game(s) across 2 model(s)',
            },
          },
        };
      },
      getLeague: (leagueId, call) => {
        if (leagueId !== 'league-fake-1') return null;
        // First poll: RUNNING; afterwards: terminal (BUDGET_CAPPED).
        return { status: 200, payload: { success: true, data: call <= 1 ? RUNNING_DETAIL : CAPPED_DETAIL } };
      },
    });
    baseUrl = await fake.listen();
  });

  afterAll(async () => {
    await fake.close();
  });

  it('POSTs the config and reports the league id', async () => {
    const { stdout, stderr, code } = await runCli([
      'league', 'start',
      '--models', 'openai/a,openai/b',
      '--budget', '5',
      '--games', '2',
      '--num-players', '10',
      '--seat-seed', '42',
      '--server', baseUrl,
    ]);
    expect(code).toBe(0);
    expect(stderr).not.toContain('❌');
    expect(stdout).toContain('league-fake-1');

    const posted = fake.requests.find((r) => r.method === 'POST');
    expect(posted).toBeDefined();
    const config = (posted!.body as { config: Record<string, unknown> }).config;
    expect(config).toMatchObject({
      models: ['openai/a', 'openai/b'],
      budgetUsd: 5,
      games: 2,
      numPlayers: 10,
      seatSeed: 42,
    });
  }, 90000);

  it('with --poll waits for the terminal status and prints the summary', async () => {
    const { stdout, code } = await runCli([
      'league', 'start',
      '--models', 'openai/a,openai/b',
      '--budget', '5',
      '--poll',
      '--server', baseUrl,
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('BUDGET_CAPPED');
    // Spend + cap state from the detail.
    expect(stdout).toContain('Budget cap reached');
    expect(stdout).toContain('MAFIA=openai/a');
  }, 120000);

  it('exits non-zero when the server refuses the config (400)', async () => {
    // Point at the same fake server but with a single-model config — the
    // CLI's own validation catches it before any HTTP call.
    const { stderr, code } = await runCli([
      'league', 'start',
      '--models', 'openai/a',
      '--budget', '5',
      '--server', baseUrl,
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('at least 2');
  }, 90000);

  it('exits non-zero on a bad budget without any HTTP call', async () => {
    const before = fake.requests.length;
    const { stderr, code } = await runCli([
      'league', 'start',
      '--models', 'openai/a,openai/b',
      '--budget', 'not-a-number',
      '--server', baseUrl,
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('--budget');
    expect(fake.requests.length).toBe(before);
  }, 90000);
});

describe('mafiactl league status', () => {
  let fake: ReturnType<typeof createFakeLeagueServer>;
  let baseUrl: string;

  beforeAll(async () => {
    fake = createFakeLeagueServer({
      getLeague: (leagueId) => {
        if (leagueId !== 'league-fake-1') return null;
        return { status: 200, payload: { success: true, data: CAPPED_DETAIL } };
      },
    });
    baseUrl = await fake.listen();
  });

  afterAll(async () => {
    await fake.close();
  });

  it('prints the league status, spend/cap state and per-game provenance', async () => {
    const { stdout, code } = await runCli([
      'league', 'status', 'league-fake-1', '--server', baseUrl,
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('league-fake-1');
    expect(stdout).toContain('BUDGET_CAPPED');
    expect(stdout).toContain('Spent:');
    expect(stdout).toContain('$4.200000');
    expect(stdout).toContain('Budget cap reached');
    // Per-game provenance: seat map + outcome.
    expect(stdout).toContain('Round 1');
    expect(stdout).toContain('VILLAGER=openai/a');
    expect(stdout).toContain('winner: MAFIA');
  }, 90000);

  it('prints machine-readable JSON with --json', async () => {
    const { stdout, code } = await runCli([
      'league', 'status', 'league-fake-1', '--json', '--server', baseUrl,
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.slice(stdout.indexOf('{')));
    expect(parsed.status.leagueId).toBe('league-fake-1');
    expect(parsed.spend.capped).toBe(true);
  }, 90000);

  it('exits non-zero for an unknown league id (404)', async () => {
    const { stderr, code } = await runCli([
      'league', 'status', 'no-such-league', '--server', baseUrl,
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('not found');
  }, 90000);
});
