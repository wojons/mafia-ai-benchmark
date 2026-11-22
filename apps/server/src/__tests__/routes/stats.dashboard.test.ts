/**
 * GET /api/v1/dashboard — win totals and status census from ONE population
 * (DF-MAFIA-AI-BENCHMARK-41).
 *
 * The row: the endpoint served `88 mafia + 916 town = 1004 wins` beside its
 * own `totals.completed` of 4402 (town under-reported by 3398) and a
 * `statusBreakdown` that summed to 4403 against `totals.total` 5092, with
 * `statusBreakdown.CANCELLED` hardcoded to `0` while the store held 206
 * CANCELLED rows.
 *
 * Contract under test (the row's required regression coverage):
 *  (a) on a seeded fixture, `wins.mafia + wins.town === totals.completed`;
 *  (b) `statusBreakdown` is a real census — `.CANCELLED` equals the number
 *      of CANCELLED rows, and exactly three buckets sum to `totals.total`;
 *  (c) both win sides derive from ONE population: a game excluded from the
 *      benchmark population (mock / degenerate) contributes to NEITHER side
 *      even when its column and its GAME_OVER event disagree, and a
 *      non-ENDED row that carries a winner is never counted as a win;
 *  plus the two shape guards the old implementation relied on: no row cap
 *  (the removed `listGames({ limit: 1000 })` walk) and no `|| gameStats.*`
 *  fallback on the win fields.
 *
 * Hermetic: the real stats router (routes/stats.ts) boots on an ephemeral
 * port over the in-memory SQLite repository the other stats suites use.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import fs from 'fs';
import path from 'path';
import { StatsCollector } from '../../services/stats-collector.js';
import { createStatsRouter } from '../../routes/stats.js';
import { createSqliteBackedRepository } from '../services/mocks.js';
import type { ServerContext } from '../../index.js';

type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

/** Event list for a degenerate game: >=3 broadcasts, ZERO non-empty SAYS. */
const DEGENERATE_EVENTS = [
  { type: 'GAME_STARTED', data: {}, phase: 'SETUP' },
  { type: 'AGENT_SAYS_BROADCASTED', data: { says: '', statement: '' }, phase: 'DAY_DISCUSSION' },
  { type: 'AGENT_SAYS_BROADCASTED', data: { says: '', statement: '' }, phase: 'DAY_DISCUSSION' },
  { type: 'AGENT_SAYS_BROADCASTED', data: { says: '', statement: '' }, phase: 'DAY_DISCUSSION' },
  { type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' },
];

/** Wire shape the dashboard has always served (unchanged by DF-41). */
interface DashboardBody {
  success: boolean;
  data: {
    totals: { total: number; active: number; completed: number };
    statusBreakdown: {
      ENDED: number;
      IN_PROGRESS: number;
      CANCELLED: number;
    };
    wins: { mafia: number; town: number };
    avgDuration: number;
    recentGames: Array<{ id: string; status: string; createdAt: number; endedAt: number | null }>;
  };
}

describe('GET /api/v1/dashboard — one population for wins + real status census (DF-MAFIA-AI-BENCHMARK-41)', () => {
  let repo: FakeRepo;
  let stats: StatsCollector;
  let server: Server;
  let baseUrl: string;

  async function boot(): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createStatsRouter({
        statsCollector: stats,
        gameRepository: repo,
      } as unknown as ServerContext),
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async function getDashboard(): Promise<DashboardBody> {
    const response = await fetch(`${baseUrl}/api/v1/dashboard`);
    expect(response.status).toBe(200);
    return (await response.json()) as DashboardBody;
  }

  beforeEach(async () => {
    repo = createSqliteBackedRepository();
    stats = new StatsCollector(repo);
    await boot();
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    repo.db.close();
  });

  /**
   * The fixture the row describes, in miniature: healthy completed games on
   * both sides, one mock-flagged completed game, one degenerate completed
   * game, two CANCELLED rows (one of them CARRYING a winner — the old
   * per-side aggregate counted it because its SQL had no status filter), and
   * one fresh in-progress game.
   */
  function seedMixedPopulation(): void {
    for (let i = 0; i < 3; i += 1) {
      repo.seedGame({ id: `town-${i}`, status: 'ENDED', winner: 'TOWN', duration: 240_000, endedAt: Date.now() });
    }
    for (let i = 0; i < 2; i += 1) {
      repo.seedGame({ id: `mafia-${i}`, status: 'ENDED', winner: 'MAFIA', duration: 240_000, endedAt: Date.now() });
    }

    // Mock-flagged completed game (zero real tokens) — outside the population.
    repo.seedGame({ id: 'mock-1', status: 'ENDED', winner: 'MAFIA', duration: 9_000, endedAt: Date.now() });
    repo.db
      .prepare(`UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?`)
      .run('mock-1');

    // Degenerate completed game (no real SAYS, finished in 81 s) — outside it too.
    repo.seedGame({
      id: 'degen-1',
      status: 'ENDED',
      winner: 'TOWN',
      duration: 81_000,
      endedAt: Date.now(),
      events: DEGENERATE_EVENTS,
    });

    // CANCELLED rows: real statuses, one with a winner column set.
    repo.seedGame({ id: 'cancelled-1', status: 'CANCELLED', endedAt: Date.now() });
    repo.seedGame({ id: 'cancelled-2', status: 'CANCELLED', winner: 'MAFIA', endedAt: Date.now() });

    // Fresh active game (counts as IN_PROGRESS, never as a win).
    repo.seedGame({ id: 'active-1', status: 'IN_PROGRESS' });
  }

  // --------------------------------------------------------------------------
  // (a) wins reconcile with the response's own completed count
  // --------------------------------------------------------------------------

  it('serves wins.mafia + wins.town === totals.completed (5 + 0 gap)', async () => {
    seedMixedPopulation();

    const body = await getDashboard();
    const { wins, totals } = body.data;

    expect(totals.completed).toBe(5); // 3 town + 2 mafia; mock + degenerate excluded
    expect(wins).toEqual({ mafia: 2, town: 3 });
    expect(wins.mafia + wins.town - totals.completed).toBe(0);
  });

  it('never attributes a non-ENDED row to either win side, even when it carries a winner', async () => {
    seedMixedPopulation();

    const body = await getDashboard();

    // The CANCELLED row with winner='MAFIA' is inside statusBreakdown.CANCELLED
    // only — the old aggregate (no status filter) counted it as a mafia win.
    expect(body.data.statusBreakdown.CANCELLED).toBe(2);
    expect(body.data.wins.mafia).toBe(2);
    expect(body.data.wins.mafia + body.data.wins.town).toBe(body.data.totals.completed);
  });

  // --------------------------------------------------------------------------
  // (b) statusBreakdown is a census, not a literal
  // --------------------------------------------------------------------------

  it('reports the real CANCELLED count without a lowercase mirror', async () => {
    seedMixedPopulation();

    const body = await getDashboard();
    const breakdown = body.data.statusBreakdown;

    // Two CANCELLED rows really exist: a 0 literal (the pre-DF-41 value)
    // cannot pass this assertion.
    expect(body.data.totals.total).toBe(10);
    expect(breakdown.CANCELLED).toBe(2);
    expect(Object.keys(breakdown)).toHaveLength(3);
    expect(Object.prototype.hasOwnProperty.call(breakdown, 'cancelled')).toBe(false);
  });

  it('reconciles statusBreakdown with totals.total on the same response', async () => {
    seedMixedPopulation();

    const body = await getDashboard();
    const { ENDED, IN_PROGRESS, CANCELLED } = body.data.statusBreakdown;

    // Literal statuses: 5 healthy + mock-1 + degen-1 ended, 1 in progress, 2 cancelled.
    expect(ENDED).toBe(7);
    expect(IN_PROGRESS).toBe(1);
    expect(CANCELLED).toBe(2);
    expect(ENDED + IN_PROGRESS + CANCELLED).toBe(body.data.totals.total);
  });

  // --------------------------------------------------------------------------
  // (c) ONE population for both sides
  // --------------------------------------------------------------------------

  it('excludes a mock game from BOTH sides even when its column and event disagree', async () => {
    // Column says MAFIA, the GAME_OVER event says TOWN, and the game is mock:
    // a per-side implementation (column for one side, events for the other)
    // would attribute it to a side; one population attributes it to neither.
    repo.seedGame({
      id: 'conflicting-mock',
      status: 'ENDED',
      winner: 'MAFIA',
      duration: 9_000,
      endedAt: Date.now(),
      events: [
        { type: 'AGENT_SAYS_BROADCASTED', data: { says: 'I suspect Alice.' }, phase: 'DAY_DISCUSSION' },
        { type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' },
      ],
    });
    repo.db
      .prepare(`UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?`)
      .run('conflicting-mock');

    const body = await getDashboard();

    expect(body.data.totals.completed).toBe(0);
    expect(body.data.wins).toEqual({ mafia: 0, town: 0 });
    expect(body.data.wins.mafia + body.data.wins.town).toBe(body.data.totals.completed);
    // Still visible in the census — excluded from wins, never hidden.
    expect(body.data.statusBreakdown.ENDED).toBe(1);
  });

  it('resolves a legacy game with no winner column from its GAME_OVER event', async () => {
    // Legacy rows store the winner only in the event stream. Both sides must
    // still come from the same per-game resolution, so they reconcile.
    repo.seedGame({
      id: 'legacy-mafia',
      status: 'ENDED',
      winner: null,
      duration: 240_000,
      endedAt: Date.now(),
      events: [{ type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' }],
    });
    repo.seedGame({
      id: 'legacy-town-1',
      status: 'ENDED',
      winner: null,
      duration: 240_000,
      endedAt: Date.now(),
      events: [{ type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' }],
    });
    repo.seedGame({ id: 'column-town', status: 'ENDED', winner: 'TOWN', duration: 240_000, endedAt: Date.now() });

    const body = await getDashboard();

    expect(body.data.wins).toEqual({ mafia: 1, town: 2 });
    expect(body.data.wins.mafia + body.data.wins.town - body.data.totals.completed).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Shape guards: no row cap, no per-side fallback
  // --------------------------------------------------------------------------

  it('counts the whole store, not the newest 1000 games', async () => {
    const total = 1005;
    for (let i = 0; i < total; i += 1) {
      repo.seedGame({
        id: `bulk-${i}`,
        status: 'ENDED',
        winner: 'MAFIA',
        duration: 240_000,
        endedAt: Date.now(),
        events: [{ type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' }],
      });
    }

    const body = await getDashboard();

    expect(body.data.totals.completed).toBe(total);
    expect(body.data.wins.mafia).toBe(total); // the removed walk capped at 1000
    expect(body.data.wins.mafia + body.data.wins.town - body.data.totals.completed).toBe(0);
  });

  it('keeps the dashboard JSON shape and leaves no || gameStats.* fallback on the win fields', async () => {
    seedMixedPopulation();

    const body = await getDashboard();

    expect(Object.keys(body.data).sort()).toEqual(
      ['avgDuration', 'recentGames', 'statusBreakdown', 'totals', 'wins'],
    );
    expect(Object.keys(body.data.totals).sort()).toEqual(['active', 'completed', 'total']);
    expect(Object.keys(body.data.wins).sort()).toEqual(['mafia', 'town']);
    expect(body.data.recentGames.length).toBeLessThanOrEqual(10);
    for (const game of body.data.recentGames) {
      expect(typeof game.createdAt).toBe('number');
    }

    // Source invariant (the row's fourth acceptance clause): the per-side
    // fallback is gone from the route.
    const here = new URL('.', import.meta.url).pathname;
    const routeSource = fs.readFileSync(path.resolve(here, '../../routes/stats.ts'), 'utf-8');
    expect(routeSource).not.toMatch(/\|\|\s*gameStats/);
    expect(routeSource).not.toMatch(/aggregatedWins\.(mafiaWins|townWins)\s*\|\|/);
    expect(routeSource).toContain('const aggregatedWins = getAggregatedWins(gameRepository);');
  });
});
