/**
 * Degenerate-game exclusion from win stats (DF-MAFIA-AI-BENCHMARK-18).
 *
 * A degenerate game is one where the LLM never actually played: every
 * player SAYS is an empty string (the legacy engine's canned-mock fallback
 * + say-quality gate suppresses all broadcasts) and the whole game ran in
 * seconds. Those games previously flowed into mafiaWins/townWins and model
 * win-rate rows unmarked, corrupting the benchmark stats.
 *
 * Contract under test:
 *  - The legacy adapter FLAGS degenerate games at completion (games.config
 *    $.degenerate = 1) — no rows are deleted.
 *  - getGameStats() EXCLUDES degenerate games from mafiaWins/townWins and
 *    exposes degenerateGames (count of excluded games).
 *  - Model win-rate aggregation (getModelComparison) excludes degenerate
 *    games from gamesPlayed/wins/winRate.
 *  - GET /api/v1/stats returns data.degenerateGames (number >= 0).
 *  - A healthy game in the same fixture set is unaffected.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { StatsCollector } from '../../services/stats-collector.js';
import { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';
import { createStatsRouter } from '../../routes/stats.js';
import { createFakeEventBus, createSqliteBackedRepository } from './mocks.js';

type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

/** Event list for a degenerate game: >=3 broadcasts, ZERO non-empty SAYS. */
const DEGENERATE_EVENTS = [
  { type: 'GAME_STARTED', data: {}, phase: 'SETUP' },
  { type: 'AGENT_SAYS_BROADCASTED', data: { says: '', statement: '' }, phase: 'DAY_DISCUSSION' },
  { type: 'AGENT_SAYS_BROADCASTED', data: { says: '', statement: '' }, phase: 'DAY_DISCUSSION' },
  { type: 'AGENT_SAYS_BROADCASTED', data: { says: '', statement: '' }, phase: 'DAY_DISCUSSION' },
  { type: 'PHASE_CHANGED', data: {}, phase: 'NIGHT_ACTIONS' },
  { type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' },
];

/** Event list for a healthy game: real non-empty SAYS statements. */
const HEALTHY_EVENTS = [
  { type: 'GAME_STARTED', data: {}, phase: 'SETUP' },
  {
    type: 'AGENT_SAYS_BROADCASTED',
    data: { says: 'I suspect Alice — she voted against Bob yesterday.', statement: 'I suspect Alice — she voted against Bob yesterday.' },
    phase: 'DAY_DISCUSSION',
  },
  { type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' },
];

function readDegenerateFlag(repo: FakeRepo, gameId: string): unknown {
  const row = repo.db.prepare(
    `SELECT json_extract(config, '$.degenerate') AS flag FROM games WHERE id = ?`,
  ).get(gameId) as { flag: number | null } | undefined;
  return row?.flag ?? null;
}

describe('degenerate-game exclusion from win stats (DF-MAFIA-AI-BENCHMARK-18)', () => {
  let repo: FakeRepo;
  let stats: StatsCollector;

  beforeEach(() => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    stats = new StatsCollector(repo as any);
  });

  // ==========================================================================
  // getGameStats() — summary win exclusion + degenerateGames count
  // ==========================================================================

  describe('getGameStats()', () => {
    it('excludes a degenerate game (all-empty SAYS, short) from mafiaWins and counts it in degenerateGames', () => {
      // Degenerate: canned-mock game, every SAYS empty, 81s (like the
      // live-verified evidence game), winner MAFIA recorded in the column.
      repo.seedGame({
        id: 'dg1', status: 'ENDED', winner: 'MAFIA', duration: 81_000,
        events: DEGENERATE_EVENTS,
      });
      // Healthy game in the same fixture set: real SAYS, 4 minutes, TOWN win.
      repo.seedGame({
        id: 'h1', status: 'ENDED', winner: 'TOWN', duration: 240_000,
        events: HEALTHY_EVENTS,
      });

      const s = stats.getGameStats();
      // The degenerate MAFIA "win" must NOT be counted.
      expect(s.mafiaWins).toBe(0);
      expect(s.townWins).toBe(1);
      // The excluded game must be surfaced, not silently dropped.
      expect(s.degenerateGames).toBe(1);
      // Data preservation: the game row itself still exists and is ENDED.
      expect(s.completedGames).toBe(2);
    });

    it('excludes degenerate games on the event-derived winner path too (MAF-GAP-060 mixing rule intact)', () => {
      // Legacy shape: winner column incomplete (NULL for both games), so
      // counts come from GAME_OVER events. The degenerate game's MAFIA
      // event-win must be excluded; the healthy TOWN event-win stays.
      repo.seedGame({
        id: 'dg2', status: 'ENDED', winner: null, duration: 60_000,
        events: [
          { type: 'GAME_STARTED', data: {}, phase: 'SETUP' },
          { type: 'AGENT_SAYS_BROADCASTED', data: { says: '' }, phase: 'DAY_DISCUSSION' },
          { type: 'AGENT_SAYS_BROADCASTED', data: { says: '' }, phase: 'DAY_DISCUSSION' },
          { type: 'AGENT_SAYS_BROADCASTED', data: { says: '' }, phase: 'DAY_DISCUSSION' },
          { type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' },
        ],
      });
      repo.seedGame({
        id: 'h2', status: 'ENDED', winner: null, duration: 300_000,
        events: [
          { type: 'AGENT_SAYS_BROADCASTED', data: { says: 'Let us vote Charlie today.' }, phase: 'DAY_DISCUSSION' },
          { type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' },
        ],
      });

      const s = stats.getGameStats();
      expect(s.mafiaWins).toBe(0);
      expect(s.townWins).toBe(1);
      expect(s.degenerateGames).toBe(1);
    });

    it('does not classify a long all-empty-SAYS game as degenerate (duration gate)', () => {
      // Same all-empty SAYS signature but the game ran 6 minutes — outside
      // the degenerate threshold window; its win must still count.
      repo.seedGame({
        id: 'long1', status: 'ENDED', winner: 'MAFIA', duration: 360_000,
        events: DEGENERATE_EVENTS,
      });

      const s = stats.getGameStats();
      expect(s.mafiaWins).toBe(1);
      expect(s.degenerateGames).toBe(0);
    });

    it('does not classify a short game with a real non-empty SAYS as degenerate (SAYS gate)', () => {
      repo.seedGame({
        id: 'fast1', status: 'ENDED', winner: 'TOWN', duration: 30_000,
        events: HEALTHY_EVENTS,
      });

      const s = stats.getGameStats();
      expect(s.townWins).toBe(1);
      expect(s.degenerateGames).toBe(0);
    });

    it('reports degenerateGames 0 and untouched wins when no degenerate games exist', () => {
      repo.seedGame({
        id: 'ok1', status: 'ENDED', winner: 'MAFIA', duration: 200_000,
        events: HEALTHY_EVENTS,
      });

      const s = stats.getGameStats();
      expect(s.mafiaWins).toBe(1);
      expect(s.townWins).toBe(0);
      expect(s.degenerateGames).toBe(0);
    });

    it('returns zeroes (incl. degenerateGames) when no games exist', () => {
      const s = stats.getGameStats();
      expect(s).toEqual({
        totalGames: 0,
        activeGames: 0,
        completedGames: 0,
        failedGames: 0,
        avgDuration: 0,
        mafiaWins: 0,
        townWins: 0,
        degenerateGames: 0,
      });
    });
  });

  // ==========================================================================
  // getModelComparison() — model win-rate exclusion
  // ==========================================================================

  describe('getModelComparison()', () => {
    it('excludes degenerate games from model gamesPlayed/wins/winRate; healthy game unaffected', () => {
      // Degenerate game the model "won" via the canned-mock path
      // (players.won=1 written by the legacy adapter's setPlayersWon).
      repo.seedGame({
        id: 'mdg', status: 'ENDED', winner: 'MAFIA', duration: 81_000,
        players: [
          { id: 'p1', name: 'P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 0 },
        ],
        events: DEGENERATE_EVENTS,
      });
      // Healthy game, same model, real play, won.
      repo.seedGame({
        id: 'mh1', status: 'ENDED', winner: 'MAFIA', duration: 300_000,
        players: [
          { id: 'p2', name: 'P2', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 0 },
        ],
        events: HEALTHY_EVENTS,
      });

      const cmp = stats.getModelComparison();
      const row = cmp.find(m => m.provider === 'openai' && m.model === 'gpt-4o-mini');
      expect(row).toBeDefined();
      // The degenerate game must not inflate gamesPlayed or wins.
      expect(row!.gamesPlayed).toBe(1);
      expect(row!.wins).toBe(1);
      expect(row!.winRate).toBe(1);
    });
  });

  // ==========================================================================
  // LegacyGameAdapter — flag at completion (write-time marker)
  // ==========================================================================

  describe('LegacyGameAdapter degenerate flag at completion', () => {
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

    it('writes the degenerate marker into games.config when a canned-mock game completes', () => {
      const { adapter, repo: r } = makeAdapterWithGame('flag-dg', 81_000, DEGENERATE_EVENTS);
      (adapter as any).handleBridgeMessage('flag-dg', {
        type: 'done', winner: 'MAFIA', totalEvents: 5, dayCount: 1, usage: [],
      });
      expect(readDegenerateFlag(r, 'flag-dg')).toBe(1);
    });

    it('does NOT flag a healthy game (real SAYS, long duration)', () => {
      const { adapter, repo: r } = makeAdapterWithGame('flag-ok', 300_000, HEALTHY_EVENTS);
      (adapter as any).handleBridgeMessage('flag-ok', {
        type: 'done', winner: 'TOWN', totalEvents: 3, dayCount: 2, usage: [],
      });
      expect(readDegenerateFlag(r, 'flag-ok')).toBeNull();
    });
  });

  // ==========================================================================
  // GET /api/v1/stats — degenerateGames surfaced
  // ==========================================================================

  describe('GET /api/v1/stats', () => {
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
      repo.seedGame({
        id: 'api-dg', status: 'ENDED', winner: 'MAFIA', duration: 81_000,
        events: DEGENERATE_EVENTS,
      });
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
      baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterEach(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    });

    it('exposes data.degenerateGames as a number >= 0 in the existing envelope', async () => {
      const response = await fetch(`${baseUrl}/api/v1/stats`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(typeof body.data.degenerateGames).toBe('number');
      expect(body.data.degenerateGames).toBe(1);
      // Existing envelope fields preserved.
      expect(body.data.mafiaWins).toBe(0);
      expect(body.data.townWins).toBe(0);
      expect(body.data.completedGames).toBe(1);
    });
  });
});