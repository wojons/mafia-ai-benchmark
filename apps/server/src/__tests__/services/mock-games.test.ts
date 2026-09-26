/**
 * Mock-game detection and exclusion from benchmark stats
 * (DF-MAFIA-AI-BENCHMARK-12).
 *
 * A canned-mock game is one where every LLM call failed (invalid/placeholder
 * key) and the engine's mock fallback (game-engine.js getMockResponse)
 * produced every response. These games complete in seconds with real
 * VOTE/NIGHT_ACTION events, so the DF-18 event-signature alone (zero
 * non-empty SAYS + short duration) does NOT catch the common case where the
 * mock statements are real-looking strings that pass the say-quality gate.
 *
 * Detection signal (server-side, from the bridge's done message):
 *   mockUsed := the bridge reports usage where EVERY model row has
 *   totalTokens === 0 (no real API response ever recorded) — while the
 *   bridge also reports zero per-player usage rows with tokens. A real game
 *   records real token counts from actual provider responses; a mock game
 *   has none. This is a *server adapter* signal — game-engine.js stays
 *   untouched (per the row's constraint).
 *
 * Contract under test:
 *  - The legacy adapter FLAGS mock games at completion
 *    (games.config.$.mock = 1) — additive marker, rows never deleted.
 *  - getGameStats() EXCLUDES mock games from mafiaWins/townWins and
 *    surfaces mockGames (count of flagged games) alongside degenerateGames.
 *  - Model win-rate aggregation (getModelComparison + getCompareReport)
 *    excludes mock games from gamesPlayed/wins/winRate and the rows/objects
 *    CARRY the marker (mockGames count / mockGamesByModel map) so mock
 *    data can never silently blend into real win rates.
 *  - GET /api/v1/stats and GET /api/v1/benchmark/compare surface the
 *    marker honestly (flagged, not silently hidden).
 *  - Real-model games with recorded usage are unaffected.
 *  - Tokens: the done path ALSO backfills players.tokens_used from
 *    per-player usage rows so avgTokensPerGame is not stuck at 0 for
 *    real-model games where the config could not name the model.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { StatsCollector } from '../../services/stats-collector.js';
import { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';
import { createStatsRouter } from '../../routes/stats.js';
import { createBenchmarkRouter } from '../../routes/benchmark.js';
import { createFakeEventBus, createSqliteBackedRepository } from './mocks.js';

type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

/**
 * Mock-game event fixture: canned-mock phrases ARE real strings (the
 * fallback is not always empty), so the game has non-empty SAYS events —
 * it must NOT be classified degenerate by the DF-18 signature, only by the
 * zero-usage mock marker.
 */
const MOCK_GAME_EVENTS = [
  { type: 'GAME_STARTED', data: {}, phase: 'SETUP' },
  {
    type: 'AGENT_SAYS_BROADCASTED',
    data: { says: 'I think we should discuss who to vote for.', statement: 'I think we should discuss who to vote for.' },
    phase: 'DAY_DISCUSSION',
  },
  { type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' },
];

const REAL_GAME_EVENTS = [
  { type: 'GAME_STARTED', data: {}, phase: 'SETUP' },
  {
    type: 'AGENT_SAYS_BROADCASTED',
    data: { says: 'Alice voted against Bob yesterday — suspicious.', statement: 'Alice voted against Bob yesterday — suspicious.' },
    phase: 'DAY_DISCUSSION',
  },
  { type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' },
];

function readGameConfigFlag(repo: FakeRepo, gameId: string, flag: string): unknown {
  const row = repo.db.prepare(
    `SELECT json_extract(config, '$.${flag}') AS flag FROM games WHERE id = ?`,
  ).get(gameId) as { flag: number | null } | undefined;
  return row?.flag ?? null;
}

/** Usage rows as the bridge reports them for a REAL game (real tokens). */
const REAL_USAGE = [
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    promptTokens: 3000,
    completionTokens: 1500,
    totalTokens: 4500,
    cost: 0.0036,
    apiCalls: 12,
    latencyMs: 1840,
  },
];

/**
 * Usage rows as the bridge reports them for a MOCK game: the tracker
 * fallback emits config-derived rows with ZERO usage (honest zeros —
 * never invented), so every model row carries totalTokens 0 / cost 0.
 */
const MOCK_USAGE = [
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
    apiCalls: 0,
    latencyMs: 0,
  },
];

describe('mock-game detection and exclusion from stats (DF-MAFIA-AI-BENCHMARK-12)', () => {
  let repo: FakeRepo;
  let stats: StatsCollector;

  beforeEach(() => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    stats = new StatsCollector(repo as any);
  });

  // ==========================================================================
  // LegacyGameAdapter — mock flag at completion (write-time marker)
  // ==========================================================================

  describe('LegacyGameAdapter mock flag at completion', () => {
    let eventBus: ReturnType<typeof createFakeEventBus>;

    beforeEach(() => {
      eventBus = createFakeEventBus();
    });

    function makeAdapterWithGame(gameId: string, durationMs: number, events: Array<{ type: string; data: unknown; phase?: string }>): {
      adapter: LegacyGameAdapter;
      repo: FakeRepo;
    } {
      const r = createSqliteBackedRepository() as unknown as FakeRepo;
      r.seedGame({ id: gameId, status: 'IN_PROGRESS' });
      // Replay the event stream through the real translation path so the
      // events table holds the same shape production writes.
      const adapter = new LegacyGameAdapter(eventBus, r as any);
      (adapter as any).activeGames.set(gameId, {
        gameId,
        process: null,
        eventCount: events.length,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - durationMs),
      });
      for (const e of events) {
        (adapter as any).translateAndPublishEvent(gameId, {
          eventType: e.type,
          phase: e.phase,
          content: e.data as Record<string, unknown>,
          visibility: 'PUBLIC',
        }, 1);
      }
      return { adapter, repo: r };
    }

    it('flags a game mock when every model usage row has zero tokens (canned-mock fallback)', () => {
      // Real-looking SAYS (the mock phrases pass the say gate) + short
      // duration — NOT degenerate by the DF-18 signature, but the usage
      // proves no real API call ever succeeded: all-zero tokens.
      const { adapter, repo: r } = makeAdapterWithGame('mock-1', 9_000, MOCK_GAME_EVENTS);
      (adapter as any).handleBridgeMessage('mock-1', {
        type: 'done', winner: 'MAFIA', totalEvents: 3, dayCount: 1,
        usage: MOCK_USAGE,
      });
      expect(readGameConfigFlag(r, 'mock-1', 'mock')).toBe(1);
      // Data preservation: the row stays ENDED.
      const row = r.db.prepare('SELECT status FROM games WHERE id = ?').get('mock-1') as { status: string };
      expect(row.status).toBe('ENDED');
    });

    it('does NOT flag on an ABSENT usage payload (missing data is not a mock signal)', () => {
      // The bridge's collectUsage always returns at least the
      // config-derived rows in production; a done message with no usage
      // payload at all carries no signal, so the game stays unflagged
      // (conservative — never flag on missing data).
      const { adapter, repo: r } = makeAdapterWithGame('mock-3', 9_000, MOCK_GAME_EVENTS);
      (adapter as any).handleBridgeMessage('mock-3', {
        type: 'done', winner: 'TOWN', totalEvents: 3, dayCount: 1,
      });
      expect(readGameConfigFlag(r, 'mock-3', 'mock')).toBeNull();
    });

    it('does NOT flag a real game whose usage records real tokens', () => {
      const { adapter, repo: r } = makeAdapterWithGame('real-1', 300_000, REAL_GAME_EVENTS);
      (adapter as any).handleBridgeMessage('real-1', {
        type: 'done', winner: 'TOWN', totalEvents: 3, dayCount: 2,
        usage: REAL_USAGE,
      });
      expect(readGameConfigFlag(r, 'real-1', 'mock')).toBeNull();
      expect(readGameConfigFlag(r, 'real-1', 'degenerate')).toBeNull();
    });

    it('does NOT flag a real game that carries per-player usage with real tokens (usageByPlayer path)', () => {
      // The per-player rows are the strongest real-play signal: the engine
      // recorded actual per-player token counts from live API responses.
      const { adapter, repo: r } = makeAdapterWithGame('real-2', 200_000, REAL_GAME_EVENTS);
      (adapter as any).handleBridgeMessage('real-2', {
        type: 'done', winner: 'MAFIA', totalEvents: 3, dayCount: 1,
        usage: MOCK_USAGE, // zero-token per-model rows...
        usageByPlayer: [   // ...but real per-player usage exists.
          { playerId: 'p1', provider: 'openai', model: 'gpt-4o-mini', promptTokens: 2000, completionTokens: 1000, totalTokens: 3000, cost: 0.0024, apiCalls: 12, latencyMs: 800 },
        ],
      });
      expect(readGameConfigFlag(r, 'real-2', 'mock')).toBeNull();
    });

    it('does NOT double-flag or overwrite a real marker later (idempotent json_set)', () => {
      const { adapter, repo: r } = makeAdapterWithGame('real-3', 300_000, REAL_GAME_EVENTS);
      (adapter as any).handleBridgeMessage('real-3', {
        type: 'done', winner: 'TOWN', totalEvents: 3, dayCount: 2,
        usage: REAL_USAGE,
      });
      // A second done (defensive — the bridge never re-emits, but the
      // handler must stay idempotent) must not corrupt the config.
      (adapter as any).activeGames.set('real-3', {
        gameId: 'real-3',
        process: null,
        eventCount: 3,
        status: 'COMPLETED',
        startedAt: new Date(Date.now() - 400_000),
      });
      (adapter as any).handleBridgeMessage('real-3', {
        type: 'done', winner: 'TOWN', totalEvents: 3, dayCount: 2,
        usage: REAL_USAGE,
      });
      expect(readGameConfigFlag(r, 'real-3', 'mock')).toBeNull();
    });
  });

  // ==========================================================================
  // getGameStats() — mock wins excluded + mockGames surfaced
  // ==========================================================================

  describe('getGameStats()', () => {
    it('excludes mock-flagged games from mafiaWins/townWins and counts them in mockGames', () => {
      // Mock-flagged MAFIA "win" via json_set (the write-time marker).
      repo.seedGame({ id: 'mg1', status: 'ENDED', winner: 'MAFIA', duration: 9_000 });
      repo.db.prepare(`UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?`).run('mg1');
      // Healthy game unaffected.
      repo.seedGame({ id: 'hg1', status: 'ENDED', winner: 'TOWN', duration: 240_000 });

      const s = stats.getGameStats();
      expect(s.mafiaWins).toBe(0);
      expect(s.townWins).toBe(1);
      // Surfaced, not silently dropped (same style as degenerateGames).
      expect(s.mockGames).toBe(1);
      expect(s.completedGames).toBe(2);
    });

    it('reports mockGames 0 and untouched wins when no mock games exist', () => {
      repo.seedGame({ id: 'ok1', status: 'ENDED', winner: 'MAFIA', duration: 200_000 });

      const s = stats.getGameStats();
      expect(s.mafiaWins).toBe(1);
      expect(s.mockGames).toBe(0);
    });

    it('keeps the degenerateGames contract intact alongside mockGames', () => {
      repo.seedGame({ id: 'dg1', status: 'ENDED', winner: 'MAFIA', duration: 81_000 });
      repo.db.prepare(`UPDATE games SET config = json_set(config, '$.degenerate', 1) WHERE id = ?`).run('dg1');
      repo.seedGame({ id: 'mg2', status: 'ENDED', winner: 'TOWN', duration: 9_000 });
      repo.db.prepare(`UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?`).run('mg2');

      const s = stats.getGameStats();
      expect(s.degenerateGames).toBe(1);
      expect(s.mockGames).toBe(1);
      expect(s.mafiaWins).toBe(0);
      expect(s.townWins).toBe(0);
    });
  });

  // ==========================================================================
  // Model win-rate aggregation — mock games excluded + marker surfaced
  // ==========================================================================

  describe('getModelComparison() / getCompareReport() mock exclusion', () => {
    it('excludes mock games from model gamesPlayed/wins/winRate; healthy game unaffected', () => {
      // Mock game the model "won" via the canned-mock path (players.won=1
      // written by setPlayersWon at done) — zero real usage.
      repo.seedGame({
        id: 'mmdg', status: 'ENDED', winner: 'MAFIA', duration: 9_000,
        players: [
          { id: 'mp1', name: 'MP1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 0 },
        ],
        events: MOCK_GAME_EVENTS,
      });
      repo.db.prepare(`UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?`).run('mmdg');
      // Healthy game, same model, real play, won.
      repo.seedGame({
        id: 'mmh1', status: 'ENDED', winner: 'MAFIA', duration: 300_000,
        players: [
          { id: 'mp2', name: 'MP2', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 0 },
        ],
        events: REAL_GAME_EVENTS,
      });

      const cmp = stats.getModelComparison();
      const row = cmp.find(m => m.provider === 'openai' && m.model === 'gpt-4o-mini');
      expect(row).toBeDefined();
      // The mock game must not inflate gamesPlayed or wins.
      expect(row!.gamesPlayed).toBe(1);
      expect(row!.wins).toBe(1);
      expect(row!.winRate).toBe(1);
    });

    it('exposes the marker at the report level: mockGames count, mock-only model absent from rows', () => {
      repo.seedGame({
        id: 'mrow1', status: 'ENDED', winner: 'MAFIA', duration: 9_000,
        players: [
          { id: 'mrp1', name: 'MRP1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 0 },
        ],
        events: MOCK_GAME_EVENTS,
      });
      repo.db.prepare(`UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?`).run('mrow1');
      repo.seedGame({
        id: 'mrow2', status: 'ENDED', winner: 'TOWN', duration: 300_000,
        players: [
          { id: 'mrp2', name: 'MRP2', role: 'VILLAGER', joinOrder: 0, isMafia: false,
            provider: 'anthropic', model: 'claude-3', won: 1, tokens_used: 0 },
        ],
        events: REAL_GAME_EVENTS,
      });

      const report = stats.getCompareReport();
      // The mock game is flagged at the REPORT level (marker, not silence).
      expect(typeof report.mockGames).toBe('number');
      expect(report.mockGames).toBe(1);
      // The mock-only model never fabricates a row (a model with zero
      // counted games has no honest stats row).
      const mini = report.models.find(m => m.provider === 'openai' && m.model === 'gpt-4o-mini');
      expect(mini).toBeUndefined();
      const claude = report.models.find(m => m.provider === 'anthropic' && m.model === 'claude-3');
      expect(claude).toBeDefined();
      expect(claude!.gamesPlayed).toBe(1);
    });

    it('excludes usage-only mock games from the token_usage aggregation path (POST /games default)', () => {
      // Legacy default path with zero-token usage rows (the mock fallback
      // writes config-derived rows with honest zeros). The game is flagged
      // mock; its zero-token usage must not surface as real stats rows.
      repo.seedGame({
        id: 'mu1', status: 'ENDED', winner: 'MAFIA', duration: 9_000,
        events: MOCK_GAME_EVENTS,
      });
      repo.db.prepare(`UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?`).run('mu1');
      repo.insertTokenUsage({
        gameId: 'mu1', playerId: 'ALL', turnNumber: 0,
        provider: 'openai', model: 'gpt-4o-mini',
        promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0,
      });

      const cmp = stats.getModelComparison();
      // The mock game's zero-usage row must not fabricate a model row.
      expect(cmp).toHaveLength(0);
    });

    it('getCompareReport() excludes mock games from the models table', () => {
      repo.seedGame({
        id: 'cr1', status: 'ENDED', winner: 'MAFIA', duration: 9_000,
        players: [
          { id: 'crp1', name: 'CRP1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 0 },
        ],
        events: MOCK_GAME_EVENTS,
      });
      repo.db.prepare(`UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?`).run('cr1');

      const report = stats.getCompareReport();
      // The mock-only model must not appear in the leaderboard.
      expect(report.models).toHaveLength(0);
    });

    it('keeps a healthy model row untouched when a sibling model is flagged mock', () => {
      repo.seedGame({
        id: 'mix1', status: 'ENDED', winner: 'MAFIA', duration: 9_000,
        players: [
          { id: 'mixp1', name: 'MIXP1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'mock-model', won: 1, tokens_used: 0 },
        ],
        events: MOCK_GAME_EVENTS,
      });
      repo.db.prepare(`UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?`).run('mix1');
      repo.seedGame({
        id: 'mix2', status: 'ENDED', winner: 'TOWN', duration: 300_000,
        players: [
          { id: 'mixp2', name: 'MIXP2', role: 'VILLAGER', joinOrder: 0, isMafia: false,
            provider: 'anthropic', model: 'claude-3', won: 1, tokens_used: 0 },
        ],
        events: REAL_GAME_EVENTS,
      });

      const report = stats.getCompareReport();
      const claude = report.models.find(m => m.model === 'claude-3');
      expect(claude).toBeDefined();
      expect(claude!.gamesPlayed).toBe(1);
      expect(claude!.wins).toBe(1);
    });
  });

  // ==========================================================================
  // GET /api/v1/stats + GET /api/v1/benchmark/compare — marker surfaced
  // ==========================================================================

  describe('HTTP surfaces', () => {
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
      // One mock-flagged game + one healthy game.
      repo.seedGame({ id: 'api-mg', status: 'ENDED', winner: 'MAFIA', duration: 9_000 });
      repo.db.prepare(`UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?`).run('api-mg');
      repo.seedGame({
        id: 'api-hg', status: 'ENDED', winner: 'TOWN', duration: 240_000,
        players: [
          { id: 'ahp1', name: 'AHP1', role: 'VILLAGER', joinOrder: 0, isMafia: false,
            provider: 'anthropic', model: 'claude-3', won: 1, tokens_used: 0 },
        ],
        events: REAL_GAME_EVENTS,
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    });

    it('GET /api/v1/stats exposes data.mockGames as a number in the existing envelope', async () => {
      const app = express();
      app.use(express.json());
      app.use('/', createStatsRouter({
        statsCollector: stats,
        gameRepository: repo,
      } as any));
      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => resolve());
      });
      const address = server.address() as { port: number };

      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/stats`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(typeof body.data.mockGames).toBe('number');
      expect(body.data.mockGames).toBe(1);
      // Mock win excluded from the win counts.
      expect(body.data.mafiaWins).toBe(0);
      expect(body.data.townWins).toBe(1);
      // The DF-18 contract stays intact.
      expect(typeof body.data.degenerateGames).toBe('number');
      expect(body.data.degenerateGames).toBe(0);
    });

    it('GET /api/v1/benchmark/compare flags mock games in the response', async () => {
      const statsCollector = stats;
      const app = express();
      app.use(express.json());
      app.use('/', createBenchmarkRouter({
        benchmarkRunner: {} as any,
        statsCollector,
      } as any));
      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => resolve());
      });
      const address = server.address() as { port: number };

      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/benchmark/compare`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      // The response marks mock content honestly (flagged, not hidden).
      expect(typeof body.data.mockGames).toBe('number');
      expect(body.data.mockGames).toBe(1);
    });
  });

  // ==========================================================================
  // Tokens backfill — avgTokensPerGame not stuck at 0 for real-model games
  // ==========================================================================

  describe('players.tokens_used backfill from per-player usage (avgTokensPerGame fix)', () => {
    let eventBus: ReturnType<typeof createFakeEventBus>;

    beforeEach(() => {
      eventBus = createFakeEventBus();
    });

    it('backfills players.tokens_used from usageByPlayer rows at done (real-model games)', () => {
      const r = createSqliteBackedRepository() as unknown as FakeRepo;
      r.seedGame({
        id: 'tb1', status: 'IN_PROGRESS',
        players: [
          { id: 'tbp1', name: 'TBP1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'gpt-4o-mini' },
          { id: 'tbp2', name: 'TBP2', role: 'VILLAGER', joinOrder: 1, isMafia: false,
            provider: 'anthropic', model: 'claude-3' },
        ],
      });
      const adapter = new LegacyGameAdapter(eventBus, r as any);
      (adapter as any).activeGames.set('tb1', {
        gameId: 'tb1',
        process: null,
        eventCount: 2,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 300_000),
      });

      (adapter as any).handleBridgeMessage('tb1', {
        type: 'done', winner: 'TOWN', totalEvents: 2, dayCount: 1,
        usage: [
          { provider: 'openai', model: 'gpt-4o-mini', promptTokens: 3000, completionTokens: 1500, totalTokens: 4500, cost: 0.0036, apiCalls: 12, latencyMs: 1840 },
          { provider: 'anthropic', model: 'claude-3', promptTokens: 2000, completionTokens: 1000, totalTokens: 3000, cost: 0.002, apiCalls: 8, latencyMs: 1200 },
        ],
        usageByPlayer: [
          { playerId: 'tbp1', provider: 'openai', model: 'gpt-4o-mini', promptTokens: 3000, completionTokens: 1500, totalTokens: 4500, cost: 0.0036, apiCalls: 12, latencyMs: 1840 },
          { playerId: 'tbp2', provider: 'anthropic', model: 'claude-3', promptTokens: 2000, completionTokens: 1000, totalTokens: 3000, cost: 0.002, apiCalls: 8, latencyMs: 1200 },
        ],
      });

      const rows = r.db.prepare(
        'SELECT id, tokens_used FROM players WHERE game_id = ? ORDER BY join_order'
      ).all('tb1') as Array<{ id: string; tokens_used: number }>;
      expect(rows[0]).toEqual({ id: 'tbp1', tokens_used: 4500 });
      expect(rows[1]).toEqual({ id: 'tbp2', tokens_used: 3000 });
    });

    it('keeps tokens_used untouched when the done message carries no per-player usage', () => {
      const r = createSqliteBackedRepository() as unknown as FakeRepo;
      r.seedGame({
        id: 'tb2', status: 'IN_PROGRESS',
        players: [
          { id: 't2p1', name: 'T2P1', role: 'MAFIA', joinOrder: 0, isMafia: true, tokens_used: 0 },
        ],
      });
      const adapter = new LegacyGameAdapter(eventBus, r as any);
      (adapter as any).activeGames.set('tb2', {
        gameId: 'tb2',
        process: null,
        eventCount: 1,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5_000),
      });
      (adapter as any).handleBridgeMessage('tb2', {
        type: 'done', winner: 'TOWN', totalEvents: 1, dayCount: 1, usage: [],
      });

      const row = r.db.prepare(
        'SELECT tokens_used FROM players WHERE game_id = ?'
      ).get('tb2') as { tokens_used: number };
      expect(row.tokens_used).toBe(0);
    });

    it('does not clobber a real tokens_used value (COALESCE semantics)', () => {
      const r = createSqliteBackedRepository() as unknown as FakeRepo;
      r.seedGame({
        id: 'tb3', status: 'IN_PROGRESS',
        players: [
          { id: 't3p1', name: 'T3P1', role: 'MAFIA', joinOrder: 0, isMafia: true, tokens_used: 999 },
        ],
      });
      const adapter = new LegacyGameAdapter(eventBus, r as any);
      (adapter as any).activeGames.set('tb3', {
        gameId: 'tb3',
        process: null,
        eventCount: 1,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5_000),
      });
      (adapter as any).handleBridgeMessage('tb3', {
        type: 'done', winner: 'MAFIA', totalEvents: 1, dayCount: 1,
        usage: [],
        usageByPlayer: [
          { playerId: 't3p1', provider: 'openai', model: 'gpt-4o-mini', promptTokens: 1, completionTokens: 1, totalTokens: 50, cost: 0, apiCalls: 1, latencyMs: 100 },
        ],
      });

      const row = r.db.prepare(
        'SELECT tokens_used FROM players WHERE game_id = ?'
      ).get('tb3') as { tokens_used: number };
      expect(row.tokens_used).toBe(999);
    });

    it('raises the per-model avgTokens above 0 for a real-model game with recorded usage', () => {
      // End-to-end: usage rows persisted at done -> the report's
      // avgTokensPerGame for the model reflects REAL tokens.
      repo.seedGame({
        id: 'e2e-tu', status: 'ENDED', winner: 'TOWN', duration: 240_000,
        players: [
          { id: 'e2ep1', name: 'E2EP1', role: 'VILLAGER', joinOrder: 0, isMafia: false,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 0 },
        ],
        events: REAL_GAME_EVENTS,
      });
      repo.insertTokenUsage({
        gameId: 'e2e-tu', playerId: 'e2ep1', turnNumber: 0,
        provider: 'openai', model: 'gpt-4o-mini',
        promptTokens: 3000, completionTokens: 1500, totalTokens: 4500, cost: 0.0036,
      });

      const cmp = stats.getModelComparison();
      const row = cmp.find(m => m.provider === 'openai' && m.model === 'gpt-4o-mini');
      expect(row).toBeDefined();
      expect(row!.avgTokens).toBe(4500);
      expect(row!.avgCost).toBeCloseTo(0.0036, 6);
    });
  });
});