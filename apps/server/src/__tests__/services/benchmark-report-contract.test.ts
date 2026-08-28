/**
 * Benchmark report data-integrity contract tests (MAF-GAP-064).
 *
 * Exercises GET /api/v1/benchmark/report over a REAL StatsCollector backed
 * by an in-memory SQLite repository, mounted on an ephemeral Express app
 * (listen(0)) and driven with Node's built-in fetch — no live server, no
 * TEST_BASE_URL, no LLM calls.
 *
 * Every fixture reproduces an INPUT SHAPE that the historical MAF-GAP bug
 * states actually recorded (MAF-GAP-036/039/043/045/048/057/060):
 *   - prefixed model strings (provider='openai', model='openai/gpt-4o-mini')
 *   - CUSTOM provider rows (provider='CUSTOM', model='openai/gpt-4o-mini')
 *   - usage-only games (token_usage with player_id='ALL', no players rows)
 *   - games where players.won was never persisted (NULL)
 *   - two same-model players in ONE game (distinct-game counting)
 *   - token_usage recorded in a game that never reached ENDED
 *
 * Contract clauses asserted (each maps to a clause the old code violated):
 *   1. <= 1 row per normalized provider/model key (MAF-GAP-045)
 *   2. usage-only games report wins 0 / winRate 0, no phantom row (036/043)
 *   3. wins come from real per-player rows + side attribution (036/039/043)
 *   4. winRate in [0,1] and wins <= gamesPlayed on EVERY row
 *   5. avgTokens/avgCost average ONLY over games the model played (036/043)
 *   6. gamesPlayed/wins count DISTINCT games (MAF-GAP-048)
 *   7. report.game.players is a non-null array when ?gameId is passed
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createBenchmarkRouter } from '../../routes/benchmark.js';
import { StatsCollector } from '../../services/stats-collector.js';
import { createSqliteBackedRepository } from './mocks.js';

// Type alias matching the return shape of createSqliteBackedRepository().
type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

/**
 * Seed the fixture database with the historical MAF-GAP input shapes.
 * Every row is annotated with the gap id that produced that shape.
 */
function seedFixtures(repo: FakeRepo): void {
  // ---------------------------------------------------------------------
  // MAF-GAP-045 fragmentation: the SAME real model stored under two
  // spellings — plain (openai/gpt-4o-mini) and CUSTOM-provider-prefixed
  // (CUSTOM + openai/gpt-4o-mini). Pre-045 these produced TWO report rows.
  // ---------------------------------------------------------------------
  repo.seedGame({
    id: 'g8',
    status: 'ENDED',
    winner: 'TOWN',
    players: [
      {
        id: 'pF1',
        name: 'town-1',
        role: 'VILLAGER',
        isMafia: false,
        won: 1,
        joinOrder: 0,
        provider: 'openai',
        model: 'gpt-4o-mini',
      },
    ],
  });
  repo.seedGame({
    id: 'g9',
    status: 'ENDED',
    winner: 'TOWN',
    players: [
      {
        id: 'pF2',
        name: 'town-2',
        role: 'VILLAGER',
        isMafia: false,
        won: 1,
        joinOrder: 0,
        provider: 'CUSTOM',
        model: 'openai/gpt-4o-mini',
      },
    ],
  });
  // Usage rows carry the same dual spelling (045 usage path).
  repo.insertTokenUsage({
    gameId: 'g8', playerId: 'pF1', turnNumber: 1,
    provider: 'openai', model: 'gpt-4o-mini',
    promptTokens: 300, completionTokens: 300, totalTokens: 600, cost: 0.06,
  });
  repo.insertTokenUsage({
    gameId: 'g9', playerId: 'pF2', turnNumber: 1,
    provider: 'CUSTOM', model: 'openai/gpt-4o-mini',
    promptTokens: 200, completionTokens: 200, totalTokens: 400, cost: 0.04,
  });

  // ---------------------------------------------------------------------
  // MAF-GAP-048: TWO players of the SAME model in ONE ended game, both
  // won=1. Distinct-game counting must yield gamesPlayed 1 / wins 1 for
  // this game (pre-048 player-row counting inflated it to 2/2).
  // ---------------------------------------------------------------------
  repo.seedGame({
    id: 'g7',
    status: 'ENDED',
    winner: 'TOWN',
    players: [
      {
        id: 'pE1', name: 'town-3', role: 'VILLAGER', isMafia: false,
        won: 1, joinOrder: 0, provider: 'openai', model: 'gpt-4o-mini',
      },
      {
        id: 'pE2', name: 'town-4', role: 'VILLAGER', isMafia: false,
        won: 1, joinOrder: 1, provider: 'openai', model: 'gpt-4o-mini',
      },
    ],
  });

  // ---------------------------------------------------------------------
  // MAF-GAP-036/043 usage-only game: ENDED game with NO players rows,
  // only token_usage (player_id='ALL' — the legacy signature). Wins must
  // stay 0 / winRate 0 and NO phantom provider row may be fabricated.
  // ---------------------------------------------------------------------
  repo.seedGame({ id: 'g6', status: 'ENDED', winner: 'TOWN' });
  repo.insertTokenUsage({
    gameId: 'g6', playerId: 'ALL', turnNumber: 1,
    provider: 'openai', model: 'deepseek-v4-flash',
    promptTokens: 1500, completionTokens: 1500, totalTokens: 3000, cost: 0.30,
  });

  // ---------------------------------------------------------------------
  // MAF-GAP-039/043: players.won was NOT persisted (NULL — the pre-043
  // legacy state). The win must still be attributed via REAL side
  // attribution (players.is_mafia vs the game winner), never dropped.
  // ---------------------------------------------------------------------
  repo.seedGame({
    id: 'g5',
    status: 'ENDED',
    winner: 'TOWN',
    players: [
      {
        id: 'pC1', name: 'town-5', role: 'VILLAGER', isMafia: false,
        joinOrder: 0, provider: 'openai', model: 'gpt-4o-turbo',
        // won deliberately omitted -> NULL in the players table
      },
    ],
  });

  // ---------------------------------------------------------------------
  // Usage attribution (036/043): model A plays g1 (win) and g2 (loss).
  // A token_usage row exists in g3 — a CANCELLED game A did NOT play
  // (usage recorded, game never reached ENDED). avgTokens/avgCost must
  // average ONLY over g1+g2 (the games A played), never g3.
  // ---------------------------------------------------------------------
  repo.seedGame({
    id: 'g1',
    status: 'ENDED',
    winner: 'TOWN',
    players: [
      {
        id: 'pA1', name: 'town-6', role: 'VILLAGER', isMafia: false,
        won: 1, joinOrder: 0, provider: 'openai', model: 'gpt-4o',
      },
    ],
  });
  repo.seedGame({
    id: 'g2',
    status: 'ENDED',
    winner: 'MAFIA',
    players: [
      {
        id: 'pA2', name: 'town-7', role: 'VILLAGER', isMafia: false,
        won: 0, joinOrder: 0, provider: 'openai', model: 'gpt-4o',
      },
    ],
  });
  repo.seedGame({ id: 'g3', status: 'CANCELLED' });
  repo.insertTokenUsage({
    gameId: 'g1', playerId: 'pA1', turnNumber: 1,
    provider: 'openai', model: 'gpt-4o',
    promptTokens: 500, completionTokens: 500, totalTokens: 1000, cost: 0.10,
  });
  repo.insertTokenUsage({
    gameId: 'g2', playerId: 'pA2', turnNumber: 1,
    provider: 'openai', model: 'gpt-4o',
    promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, cost: 0.20,
  });
  // The leak row: usage for A in a game A never played (CANCELLED).
  repo.insertTokenUsage({
    gameId: 'g3', playerId: 'ALL', turnNumber: 1,
    provider: 'openai', model: 'gpt-4o',
    promptTokens: 250, completionTokens: 250, totalTokens: 500, cost: 0.05,
  });
  // Real api_calls for latency attribution (MAF-GAP-018 shape).
  repo.insertApiCall({
    gameId: 'g1', playerId: 'pA1', provider: 'openai', model: 'gpt-4o',
    endpoint: '/chat', latency: 100,
  });
  repo.insertApiCall({
    gameId: 'g2', playerId: 'pA2', provider: 'openai', model: 'gpt-4o',
    endpoint: '/chat', latency: 200,
  });
  // Assignments for A's games (legacy benchmark path — the played-games
  // usage filter lives in getModelComparisonFromAssignments). Inserted
  // directly (established pattern in stats-collector.test.ts) with the
  // legacy player_id='ALL' signature recorded in MAF-GAP-036/043 history.
  const pma = repo.db.prepare(
    `INSERT INTO player_model_assignments
       (id, game_id, player_id, role, provider, model, temperature, max_tokens, priority, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  pma.run('a1', 'g1', 'ALL', 'VILLAGER', 'openai', 'gpt-4o', 0.7, 500, 0, Date.now());
  pma.run('a2', 'g2', 'ALL', 'VILLAGER', 'openai', 'gpt-4o', 0.7, 500, 0, Date.now());

  // ---------------------------------------------------------------------
  // Cross-model isolation: model B plays g4 only. Its usage must never
  // leak into A's row (and vice versa).
  // ---------------------------------------------------------------------
  repo.seedGame({
    id: 'g4',
    status: 'ENDED',
    winner: 'TOWN',
    players: [
      {
        id: 'pB1', name: 'town-8', role: 'VILLAGER', isMafia: false,
        won: 1, joinOrder: 0, provider: 'anthropic', model: 'claude-3-5-sonnet',
      },
    ],
  });
  repo.insertTokenUsage({
    gameId: 'g4', playerId: 'pB1', turnNumber: 1,
    provider: 'anthropic', model: 'claude-3-5-sonnet',
    promptTokens: 250, completionTokens: 250, totalTokens: 500, cost: 0.05,
  });
}

describe('GET /api/v1/benchmark/report — data-integrity contract (MAF-GAP-064)', () => {
  let repo: FakeRepo;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    seedFixtures(repo);

    // REAL router + REAL StatsCollector over the in-memory SQLite repo.
    const statsCollector = new StatsCollector(repo as any);
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createBenchmarkRouter({
        benchmarkRunner: {} as any, // report route never touches the runner
        statsCollector,
      } as any),
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function fetchReport(gameId?: string): Promise<any> {
    const url = gameId
      ? `${baseUrl}/api/v1/benchmark/report?gameId=${gameId}`
      : `${baseUrl}/api/v1/benchmark/report`;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    return response.json();
  }

  // ======================================================================
  // Clause 1 — row uniqueness after normalization (MAF-GAP-045)
  // ======================================================================

  it('returns <= 1 row per normalized provider/model key (no fragmentation)', async () => {
    const report = await fetchReport();
    const rows = report.modelPerformance as Array<{
      provider: string;
      model: string;
    }>;

    // openai/gpt-4o-mini was seeded under TWO spellings (plain + CUSTOM-
    // prefixed). Both must collapse to exactly ONE normalized row.
    const gpt4Mini = rows.filter((r) => r.model === 'gpt-4o-mini');
    expect(gpt4Mini).toHaveLength(1);
    expect(gpt4Mini[0].provider).toBe('openai');

    // No prefixed phantom model strings may surface (045 phantom row).
    expect(rows.every((r) => !r.model.includes('/'))).toBe(true);
    // No CUSTOM provider row may be fabricated for a normalized model.
    expect(rows.every((r) => r.provider !== 'CUSTOM')).toBe(true);
    // No duplicate normalized keys anywhere.
    const keys = rows.map((r) => `${r.provider}/${r.model}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // ======================================================================
  // Clause 2 — usage-only games stay honest (MAF-GAP-036/043)
  // ======================================================================

  it('reports wins 0 / winRate 0 for usage-only games with no phantom row', async () => {
    const report = await fetchReport();
    const rows = report.modelPerformance as any[];

    const deepseek = rows.find((r) => r.model === 'deepseek-v4-flash');
    expect(deepseek).toBeDefined();
    expect(deepseek.provider).toBe('openai');
    expect(deepseek.gamesPlayed).toBe(1);
    expect(deepseek.wins).toBe(0);
    expect(deepseek.winRate).toBe(0);
    // Real usage IS still reported (MAF-GAP-018): 3000 tokens / $0.30.
    expect(deepseek.avgTokens).toBe(3000);
    expect(deepseek.avgCost).toBeCloseTo(0.3, 5);
  });

  // ======================================================================
  // Clause 3 — wins from real participation + side attribution (036/039/043)
  // ======================================================================

  it('attributes the win via side attribution when players.won was never persisted', async () => {
    const report = await fetchReport();
    const rows = report.modelPerformance as any[];

    // gpt-4o-turbo played one ENDED game its side won, but players.won is
    // NULL (pre-043 legacy state). The win must come from real side
    // attribution (is_mafia vs game winner) — never dropped to 0.
    const turbo = rows.find((r) => r.model === 'gpt-4o-turbo');
    expect(turbo).toBeDefined();
    expect(turbo.gamesPlayed).toBe(1);
    expect(turbo.wins).toBe(1);
    expect(turbo.winRate).toBe(1);
  });

  // ======================================================================
  // Clause 4 — winRate bounds + wins <= gamesPlayed on EVERY row
  // ======================================================================

  it('keeps winRate in [0,1] and wins <= gamesPlayed on every row (mixed aggregates)', async () => {
    const report = await fetchReport();
    const rows = report.modelPerformance as any[];

    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(row.winRate).toBeGreaterThanOrEqual(0);
      expect(row.winRate).toBeLessThanOrEqual(1);
      expect(row.wins).toBeLessThanOrEqual(row.gamesPlayed);
    }

    // Mixed aggregate: gpt-4o won 1 of 2 games -> strictly interior rate.
    const gpt4o = rows.find((r) => r.model === 'gpt-4o');
    expect(gpt4o).toBeDefined();
    expect(gpt4o.gamesPlayed).toBe(2);
    expect(gpt4o.wins).toBe(1);
    expect(gpt4o.winRate).toBeGreaterThan(0);
    expect(gpt4o.winRate).toBeLessThan(1);
  });

  // ======================================================================
  // Clause 5 — usage attributed only to games the model played (036/043)
  // ======================================================================

  it('averages avgTokens/avgCost only over games the model played (no leakage)', async () => {
    const report = await fetchReport();
    const rows = report.modelPerformance as any[];

    const gpt4o = rows.find((r) => r.model === 'gpt-4o');
    expect(gpt4o).toBeDefined();
    // A played g1 (1000 tok / $0.10) and g2 (2000 tok / $0.20). The g3
    // CANCELLED-game usage (500 tok / $0.05) must NOT be included.
    expect(gpt4o.gamesPlayed).toBe(2);
    expect(gpt4o.avgTokens).toBe(1500);
    expect(gpt4o.avgCost).toBeCloseTo(0.15, 5);
    // Latency from real api_calls only (100ms + 200ms).
    expect(gpt4o.avgLatency).toBeCloseTo(150, 5);

    // Cross-model isolation: B's row averages only B's own usage.
    const claude = rows.find((r) => r.model === 'claude-3-5-sonnet');
    expect(claude).toBeDefined();
    expect(claude.gamesPlayed).toBe(1);
    expect(claude.avgTokens).toBe(500);
    expect(claude.avgCost).toBeCloseTo(0.05, 5);
  });

  // ======================================================================
  // Clause 6 — distinct-game counting (MAF-GAP-048)
  // ======================================================================

  it('counts gamesPlayed/wins as DISTINCT games, not player rows', async () => {
    const report = await fetchReport();
    const rows = report.modelPerformance as any[];

    // gpt-4o-mini: g7 (TWO same-model players, both won) + g8 + g9.
    // Distinct-game semantics: 3 games, 3 wins (one per game), never 4/4
    // from counting the two g7 player rows twice.
    const merged = rows.find((r) => r.model === 'gpt-4o-mini');
    expect(merged).toBeDefined();
    expect(merged.gamesPlayed).toBe(3);
    expect(merged.wins).toBe(3);
    expect(merged.winRate).toBe(1);
  });

  // ======================================================================
  // Clause 7 — report.game.players non-null with ?gameId
  // ======================================================================

  it('returns a non-null players array in report.game when gameId is passed', async () => {
    const report = await fetchReport('g1');
    expect(report.game).toBeDefined();
    expect(Array.isArray(report.game.players)).toBe(true);
    expect(report.game.players.length).toBe(1);
    for (const entry of report.game.players) {
      expect(entry).not.toBeNull();
      expect(entry.name).not.toBeNull();
      expect(entry.role).not.toBeNull();
    }
    expect(report.game.winner).toBe('TOWN');

    // Without gameId the game section must be absent entirely.
    const bare = await fetchReport();
    expect(bare.game).toBeUndefined();
  });

  // ======================================================================
  // Sanity — summary reconciles with the seeded store
  // ======================================================================

  it('reconciles the summary buckets with the seeded games', async () => {
    const report = await fetchReport();
    expect(report.summary.totalGames).toBe(9); // g1..g9
    expect(report.summary.completedGames).toBe(8); // all except CANCELLED g3
    expect(report.summary.failedGames).toBe(1); // g3
    expect(report.summary.activeGames).toBe(0);
  });
});
