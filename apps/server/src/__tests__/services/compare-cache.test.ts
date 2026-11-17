/**
 * PERF-MAFIA-3 — benchmark compare memoization tests.
 *
 * getCompareReport() is memoized inside the StatsCollector on the same
 * data-watermark mechanism the full-fleet report uses (PERF-MAFIA-2),
 * keyed per GameRepository (WeakMap) AND per normalized `?models=` filter.
 * These tests pin BOTH halves of that contract over a REAL StatsCollector
 * backed by an in-memory SQLite repository (same conventions as
 * report-cache.test.ts / stats-collector.test.ts):
 *
 *   1. A second getCompareReport() call on unchanged data returns a payload
 *      IDENTICAL to the first (same object identity — the cache serves the
 *      cached reference).
 *   2. Mutating a compare source — INSERTing a game, a token_usage row, a
 *      benchmark_games row (head-to-head derivation), changing a players
 *      role in place (rolePerformance cells), and flipping a model in a
 *      player_model_assignments row (legacy trend fallback) — each busts
 *      the cache: the next compare reflects the new data.
 *   3. The `?models=` filter is part of the cache key: a filtered call
 *      never re-serves the unfiltered report (and vice versa).
 *   4. An error fallback is never memoized: after a failure the next call
 *      retries and recovers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCollector } from '../../services/stats-collector.js';
import {
  getCompareReport,
  getModelComparison,
} from '../../services/stats-collector/models.js';
import { createSqliteBackedRepository } from './mocks.js';

// Type alias matching the return shape of createSqliteBackedRepository().
type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

describe('StatsCollector compare memoization (PERF-MAFIA-3)', () => {
  let repo: FakeRepo;
  let stats: StatsCollector;

  beforeEach(() => {
    // Every test gets a FRESH in-memory repository — the compare cache is
    // keyed per-repository (WeakMap), so no cross-test contamination and
    // no manual reset needed.
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    stats = new StatsCollector(repo as any);
  });

  describe('cached path — identical payload on the second call', () => {
    it('returns the SAME object reference on the second call', () => {
      repo.seedGame({
        id: 'g1', status: 'ENDED', winner: 'MAFIA', duration: 60_000,
        players: [{
          id: 'p1', name: 'P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
          provider: 'OPENAI', model: 'gpt-4', won: 1,
        }],
      });
      repo.insertTokenUsage({ gameId: 'g1', playerId: 'p1', turnNumber: 1,
        provider: 'OPENAI', model: 'gpt-4', promptTokens: 100,
        completionTokens: 50, totalTokens: 150, cost: 0.01, timestamp: Date.now() });

      const first = stats.getCompareReport();
      // The second call must serve the CACHED reference — object identity
      // is the direct cache-reuse proof (no recomputation happened).
      const second = stats.getCompareReport();
      expect(second).toBe(first);
      // Spot-check the shape survived the cache round-trip.
      expect(second.models).toHaveLength(1);
      expect(second.models[0].model).toBe('gpt-4');
      expect(second.models[0].gamesPlayed).toBe(1);
    });
  });

  describe('watermark mutation busts the cache', () => {
    it('ignores events appended to an in-progress game', () => {
      // Live games append events on every turn. Those rows are not part of
      // completed benchmark aggregates, so they must not evict the completed
      // compare report while the game is still running.
      repo.seedGame({
        id: 'live-game',
        status: 'IN_PROGRESS',
        players: [{
          id: 'live-player', name: 'Live Player', role: 'VILLAGER',
          joinOrder: 0, provider: 'openai', model: 'gpt-4o-mini',
        }],
      });
      repo.seedGame({
        id: 'ended-game',
        status: 'ENDED',
        winner: 'TOWN',
        players: [{
          id: 'ended-player', name: 'Ended Player', role: 'VILLAGER',
          joinOrder: 0, provider: 'openai', model: 'gpt-4o-mini', won: 1,
        }],
      });

      const first = stats.getCompareReport();
      repo.db.prepare(`
        INSERT INTO events
          (id, game_id, type, timestamp, visibility, actor_id, target_id,
           data, turn_number, day_number, phase, sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'live-event-1', 'live-game', 'AGENT_SAYS_BROADCASTED', Date.now(),
        'PUBLIC', 'live-player', null, JSON.stringify({ says: 'still playing' }),
        1, 1, 'DAY_DISCUSSION', 1,
      );

      expect(stats.getCompareReport()).toBe(first);
    });

    it('still invalidates when a terminal event changes completed statistics', () => {
      repo.seedGame({
        id: 'terminal-game',
        status: 'ENDED',
        players: [{
          id: 'terminal-player', name: 'Terminal Player', role: 'MAFIA',
          joinOrder: 0, isMafia: true, provider: 'openai', model: 'gpt-4o-mini',
        }],
      });

      const first = stats.getCompareReport();
      expect(first.models[0].wins).toBe(0);

      repo.db.prepare(`
        INSERT INTO events
          (id, game_id, type, timestamp, visibility, actor_id, target_id,
           data, turn_number, day_number, phase, sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'terminal-event-1', 'terminal-game', 'GAME_ENDED', Date.now(),
        'PUBLIC', null, null, JSON.stringify({ winner: 'MAFIA' }),
        1, 1, 'GAME_OVER', 1,
      );

      const second = stats.getCompareReport();
      expect(second).not.toBe(first);
      expect(second.models[0].wins).toBe(1);
    });

    it('INSERTing a new game changes gamesPlayed on the next call', () => {
      repo.seedGame({
        id: 'g1', status: 'ENDED',
        players: [{
          id: 'g1p1', name: 'G1P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
          provider: 'openai', model: 'gpt-4o-mini', won: 1,
        }],
      });

      const first = stats.getCompareReport();
      expect(first.models[0].gamesPlayed).toBe(1);

      // A benchmark run mid-fleet INSERTs a new game + player row.
      repo.seedGame({
        id: 'g2', status: 'ENDED',
        players: [{
          id: 'g2p1', name: 'G2P1', role: 'TOWN', joinOrder: 0,
          provider: 'openai', model: 'gpt-4o-mini', won: 0,
        }],
      });

      const second = stats.getCompareReport();
      expect(second).not.toBe(first);
      expect(second.models[0].gamesPlayed).toBe(2);
      expect(second.models[0].wins).toBe(1);
    });

    it('INSERTing a token_usage row changes avgTokensPerGame on the next call', () => {
      repo.seedGame({
        id: 'g1', status: 'ENDED',
        players: [{
          id: 'p1', name: 'P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
          provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 0,
        }],
      });

      const first = stats.getCompareReport();
      expect(first.models[0].avgTokensPerGame).toBe(0);

      repo.insertTokenUsage({ gameId: 'g1', playerId: 'p1', turnNumber: 1,
        provider: 'openai', model: 'gpt-4o-mini', promptTokens: 100,
        completionTokens: 50, totalTokens: 150, cost: 0.001, timestamp: Date.now() });

      const second = stats.getCompareReport();
      expect(second.models[0].avgTokensPerGame).toBe(150);
    });

    it('INSERTing a benchmark_games row changes headToHead on the next call', () => {
      // The compare-only source: head-to-head is derived from
      // benchmark_games (DF-40) — a table the base report watermark does
      // not cover. The cache MUST bust on its writes.
      repo.seedGame({
        id: 'g1', status: 'ENDED', winner: 'MAFIA',
        players: [
          { id: 'g1mA', name: 'MA', role: 'MAFIA', joinOrder: 0, isMafia: true,
            won: 1, provider: 'google', model: 'gemini-2.5-flash' },
          { id: 'g1tB', name: 'TB', role: 'VILLAGER', joinOrder: 1,
            won: 0, provider: 'openai', model: 'gpt-4o-mini' },
        ],
      });

      const first = stats.getCompareReport();
      expect(first.headToHead).toHaveLength(0);

      repo.insertBenchmarkRun({
        id: 'run-mut', config: {}, status: 'COMPLETED',
      });
      repo.insertBenchmarkGame({
        game_id: 'g1', run_id: 'run-mut', pairing_id: 'p-gemini-vs-mini',
        model_a: 'google/gemini-2.5-flash', model_b: 'openai/gpt-4o-mini',
        seed: 1, model_a_role: 'VILLAGER', model_b_role: 'VILLAGER',
        winner: 'MAFIA', completed_at: Date.now(), valid: 1,
      });

      const second = stats.getCompareReport();
      expect(second).not.toBe(first);
      expect(second.headToHead.length).toBeGreaterThan(0);
      const pairing = second.headToHead[0];
      expect(pairing.modelA).toBe('google/gemini-2.5-flash');
      expect(pairing.modelB).toBe('openai/gpt-4o-mini');
      expect(pairing.modelAWins).toBe(1);
    });

    it('an in-place players role UPDATE changes rolePerformance on the next call', () => {
      // rolePerformance cells GROUP BY p.role — a role flip on an EXISTING
      // players row (same count, same provider/model sums) must bust the
      // cache via the role-length fingerprint.
      repo.seedGame({
        id: 'g1', status: 'ENDED',
        players: [{
          id: 'p1', name: 'P1', role: 'VILLAGER', joinOrder: 0,
          provider: 'openai', model: 'gpt-4o-mini', won: 1,
        }],
      });

      const first = stats.getCompareReport();
      expect(first.models[0].rolePerformance['VILLAGER']).toBeDefined();
      expect(first.models[0].rolePerformance['MAFIA']).toBeUndefined();

      repo.db.prepare(
        `UPDATE players SET role = 'MAFIA', is_mafia = 1 WHERE id = ?`,
      ).run('p1');

      const second = stats.getCompareReport();
      expect(second.models[0].rolePerformance['MAFIA']).toBeDefined();
      expect(second.models[0].rolePerformance['VILLAGER']).toBeUndefined();
    });

    it('an in-place player_model_assignments model UPDATE changes the fallback trends', () => {
      // The legacy fallback-trend path derives entries from
      // player_model_assignments — the base report watermark covers only
      // that table's ROW COUNT, so an in-place model UPDATE (same count)
      // must be caught by the extra fingerprint.
      repo.seedGame({ id: 'g1', status: 'ENDED', winner: 'TOWN', duration: 60_000 });
      repo.db.prepare(
        `INSERT INTO player_model_assignments
           (id, game_id, player_id, player_name, provider, model, role, created_at)
         VALUES ('pma-mut', 'g1', 'pma-mut-p', 'PMA P', 'openai', 'gpt-4o-mini',
                 'VILLAGER', 1)`,
      ).run();

      const first = stats.getCompareReport();
      const trend = first.trends.find(
        (t) => t.model === 'openai/gpt-4o-mini',
      );
      expect(trend).toBeDefined();

      repo.db.prepare(
        `UPDATE player_model_assignments SET model = 'gpt-4o' WHERE id = ?`,
      ).run('pma-mut');

      const second = stats.getCompareReport();
      const trendAfter = second.trends.find(
        (t) => t.model === 'openai/gpt-4o',
      );
      expect(trendAfter).toBeDefined();
      expect(second.trends.find((t) => t.model === 'openai/gpt-4o-mini'))
        .toBeUndefined();
    });
  });

  describe('the ?models= filter is part of the cache key', () => {
    it('a filtered call never re-serves the unfiltered report (and vice versa)', () => {
      repo.seedGame({
        id: 'g1', status: 'ENDED',
        players: [
          { id: 'p1', name: 'P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'gpt-4o-mini', won: 1 },
        ],
      });
      repo.seedGame({
        id: 'g2', status: 'ENDED',
        players: [
          { id: 'p2', name: 'P2', role: 'TOWN', joinOrder: 0,
            provider: 'anthropic', model: 'claude-3', won: 1 },
        ],
      });

      const unfiltered = stats.getCompareReport();
      expect(unfiltered.models).toHaveLength(2);

      const filtered = stats.getCompareReport(['gpt-4o-mini']);
      expect(filtered).not.toBe(unfiltered);
      expect(filtered.models).toHaveLength(1);
      expect(filtered.models[0].model).toBe('gpt-4o-mini');

      // Identical repeats of each key still ride their own cache entry.
      expect(stats.getCompareReport()).toBe(unfiltered);
      expect(stats.getCompareReport(['gpt-4o-mini'])).toBe(filtered);

      // ...and a SECOND filter variant is cached separately too.
      const both = stats.getCompareReport(['gpt-4o-mini', 'claude-3']);
      expect(both).not.toBe(unfiltered);
      expect(both.models).toHaveLength(2);
      expect(stats.getCompareReport(['gpt-4o-mini', 'claude-3'])).toBe(both);
    });
  });

  describe('error fallback is never memoized', () => {
    it('a failed comparison does not poison the next call', () => {
      repo.seedGame({
        id: 'g1', status: 'ENDED', winner: 'TOWN', duration: 60_000,
        players: [{
          id: 'p1', name: 'P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
          provider: 'openai', model: 'gpt-4o-mini', won: 1,
        }],
      });

      // Drop the players table to break the watermark (and the report);
      // the failure must propagate (route 500 contract) and must NOT be
      // cached.
      repo.db.exec('DROP TABLE players');
      try {
        stats.getCompareReport();
        // The contract says the error REACHES the caller (the route maps
        // it to a 500) — reaching here means the failure was swallowed.
        expect.unreachable('getCompareReport must propagate the failure');
      } catch {
        // Expected: the error propagated, nothing was memoized.
      }

      // Restore the table: the next call must regenerate for real.
      repo.db.exec(`CREATE TABLE players (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        is_alive INTEGER,
        is_mafia INTEGER,
        join_order INTEGER,
        agent_id TEXT,
        provider TEXT,
        model TEXT,
        survived INTEGER,
        won INTEGER,
        tokens_used INTEGER DEFAULT 0,
        role_performance REAL DEFAULT 0,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      )`);
      repo.seedGame({
        id: 'g2', status: 'ENDED',
        players: [{
          id: 'p2', name: 'P2', role: 'MAFIA', joinOrder: 0, isMafia: true,
          provider: 'openai', model: 'gpt-4o', won: 1,
        }],
      });

      const recovered = stats.getCompareReport();
      expect(recovered.models).toHaveLength(1);
      expect(recovered.models[0].model).toBe('gpt-4o');
      // And the recovered report IS cached (identical on the next call).
      expect(stats.getCompareReport()).toBe(recovered);
    });
  });

  /**
   * PERF-MAFIA-6 — the materialized degenerate/mock gate must be
   * OBSERVATIONALLY IDENTICAL to the correlated fallback it replaced.
   *
   * getCompareReport() materializes the surviving game ids once per build
   * (`getIncludedCompareGameIds`) and every aggregate probes that set with
   * json_each. When the set cannot be built the helpers return null and every
   * aggregate keeps the legacy correlated DEGENERATE_GAME_SQL /
   * MOCK_GAME_SQL predicate. These tests pin that the two paths return the
   * SAME rows on the same store — row order included, no ordering slop — over
   * a fixture that actually contains degenerate, mock, in-flight and orphaned
   * rows (so the gates have something to disagree about).
   */
  describe('PERF-MAFIA-6 materialized gate ≡ correlated fallback', () => {
    /**
     * Reject ONLY the materialization statement so
     * getIncludedCompareGameIds() returns null; every other query still runs
     * against the real store, which is exactly the degraded-but-honest path
     * the fallback branch exists for.
     */
    function withUnavailableMaterialization<T>(target: FakeRepo, fn: () => T): T {
      const db = target.db as unknown as { prepare: (sql: string) => unknown };
      const realPrepare = db.prepare.bind(db);
      db.prepare = (sql: string) => {
        if (sql.includes('SELECT g.id as id FROM games g')) {
          throw new Error('PERF-MAFIA-6 test: materialization unavailable');
        }
        return realPrepare(sql);
      };
      try {
        return fn();
      } finally {
        db.prepare = realPrepare;
      }
    }

    /** Record every prepared statement while `fn` runs. */
    function recordStatements<T>(target: FakeRepo, fn: () => T): { result: T; sqls: string[] } {
      const db = target.db as unknown as { prepare: (sql: string) => unknown };
      const realPrepare = db.prepare.bind(db);
      const sqls: string[] = [];
      db.prepare = (sql: string) => {
        sqls.push(sql);
        return realPrepare(sql);
      };
      try {
        return { result: fn(), sqls };
      } finally {
        db.prepare = realPrepare;
      }
    }

    /**
     * Store carrying every class the gate distinguishes:
     *  - gate-healthy  ENDED, real dialogue, long duration  → counted
     *  - gate-degen    ENDED, 3 empty broadcasts, 80 s      → degenerate
     *  - gate-mock     ENDED, write-time $.mock flag        → mock
     *  - gate-live     IN_PROGRESS (gate returns NULL)      → counted
     *  - gate-missing  token_usage only, no games row       → orphan
     */
    function seedGateFixture(target: FakeRepo) {
      target.seedGame({
        id: 'gate-healthy',
        status: 'ENDED',
        winner: 'TOWN',
        duration: 300_000,
        numPlayers: 4,
        players: [
          {
            id: 'gh-mafia', name: 'H Mafia', role: 'MAFIA', isMafia: true,
            joinOrder: 0, provider: 'openai', model: 'gpt-4o-mini', won: 0,
            role_performance: 0.4,
          },
          {
            id: 'gh-town', name: 'H Town', role: 'VILLAGER', isMafia: false,
            joinOrder: 1, provider: 'anthropic', model: 'claude-3', won: 1,
            role_performance: 0.8,
          },
        ],
        events: [
          { type: 'AGENT_SAYS_BROADCASTED', actorId: 'gh-mafia', data: { says: 'the town is quiet' } },
          { type: 'AGENT_SAYS_BROADCASTED', actorId: 'gh-town', data: { says: 'I am a villager' } },
          { type: 'AGENT_SAYS_BROADCASTED', actorId: 'gh-mafia', data: { statement: 'vote tomorrow' } },
        ],
      });
      target.seedGame({
        id: 'gate-degen',
        status: 'ENDED',
        winner: 'TOWN',
        duration: 80_000,
        numPlayers: 2,
        players: [
          {
            id: 'gd-player', name: 'D Player', role: 'VILLAGER', isMafia: false,
            joinOrder: 0, provider: 'fake', model: 'degenerate-only', won: 1,
            role_performance: 0.1,
          },
        ],
        events: [
          { type: 'AGENT_SAYS_BROADCASTED', actorId: 'gd-player', data: {} },
          { type: 'AGENT_SAYS_BROADCASTED', actorId: 'gd-player', data: {} },
          { type: 'AGENT_SAYS_BROADCASTED', actorId: 'gd-player', data: {} },
        ],
      });
      target.seedGame({
        id: 'gate-mock',
        status: 'ENDED',
        winner: 'MAFIA',
        duration: 300_000,
        numPlayers: 2,
        players: [
          {
            id: 'gm-player', name: 'M Player', role: 'MAFIA', isMafia: true,
            joinOrder: 0, provider: 'fake', model: 'mock-only', won: 1,
            role_performance: 0.1,
          },
        ],
        events: [
          { type: 'AGENT_SAYS_BROADCASTED', actorId: 'gm-player', data: { says: 'canned mock line' } },
        ],
      });
      // Write-time flag the legacy adapter sets when every provider call fell
      // back to the canned mock (DF-MAFIA-AI-BENCHMARK-12).
      target.db
        .prepare(`UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?`)
        .run('gate-mock');
      target.seedGame({
        id: 'gate-live',
        status: 'IN_PROGRESS',
        numPlayers: 4,
        players: [
          {
            id: 'gl-player', name: 'L Player', role: 'VILLAGER', joinOrder: 0,
            provider: 'openai', model: 'gpt-4o-mini',
          },
        ],
      });

      target.insertTokenUsage({
        gameId: 'gate-healthy', playerId: 'gh-mafia', turnNumber: 1,
        provider: 'openai', model: 'gpt-4o-mini', promptTokens: 100,
        completionTokens: 50, totalTokens: 150, cost: 0.01,
      });
      target.insertTokenUsage({
        gameId: 'gate-healthy', playerId: 'gh-town', turnNumber: 1,
        provider: 'anthropic', model: 'claude-3', promptTokens: 200,
        completionTokens: 100, totalTokens: 300, cost: 0.02,
      });
      target.insertTokenUsage({
        gameId: 'gate-degen', playerId: 'gd-player', turnNumber: 1,
        provider: 'fake', model: 'degenerate-only', promptTokens: 5,
        completionTokens: 5, totalTokens: 10, cost: 0.001,
      });
      target.insertTokenUsage({
        gameId: 'gate-mock', playerId: 'gm-player', turnNumber: 1,
        provider: 'fake', model: 'mock-only', promptTokens: 0,
        completionTokens: 0, totalTokens: 0, cost: 0,
      });
      // Orphaned usage row: no games row, so the inner join drops it on BOTH
      // paths (the join is load-bearing even after the flag predicate moves).
      // Seeded with enforcement off — a real store can carry such a row, and
      // the aggregates must keep ignoring it rather than count it in.
      target.db.pragma('foreign_keys = OFF');
      target.insertTokenUsage({
        gameId: 'gate-missing', playerId: 'gone', turnNumber: 1,
        provider: 'openai', model: 'orphan-only', promptTokens: 10,
        completionTokens: 10, totalTokens: 20, cost: 0.5,
      });
      target.db.pragma('foreign_keys = ON');
      // Legacy assignment source (getModelComparisonFromAssignments).
      target.db
        .prepare(
          `INSERT INTO player_model_assignments
             (id, game_id, player_id, player_name, provider, model, role, created_at)
           VALUES ('pma-gate', 'gate-healthy', 'gh-town', 'H Town',
                   'anthropic', 'claude-3', 'VILLAGER', 1)`,
        )
        .run();
    }

    it('returns the same compare report from the fallback and materialized paths', () => {
      seedGateFixture(repo);

      const materialized = getCompareReport(repo);
      const fallback = withUnavailableMaterialization(repo, () => getCompareReport(repo));

      // Non-vacuity: the fixture produces real rows AND the gate excludes the
      // games it must — otherwise "equal" would be "equally empty".
      expect(materialized.models.length).toBeGreaterThan(0);
      const modelKeys = materialized.models.map((m) => `${m.provider}/${m.model}`);
      expect(modelKeys).toContain('openai/gpt-4o-mini');
      expect(modelKeys).toContain('anthropic/claude-3');
      expect(modelKeys).not.toContain('fake/degenerate-only');
      expect(modelKeys).not.toContain('fake/mock-only');
      expect(modelKeys).not.toContain('openai/orphan-only');
      // The mock game really is classified as mock (audit counter on the
      // report), so its exclusion above is the gate at work.
      expect(materialized.mockGames).toBe(1);

      // The two paths agree on EVERY row, in order.
      expect(fallback).toEqual(materialized);
      expect(fallback.models).toEqual(materialized.models);
      expect(fallback.unattributedModels).toEqual(materialized.unattributedModels);
      expect(fallback.headToHead).toEqual(materialized.headToHead);
      expect(fallback.trends).toEqual(materialized.trends);
      expect(fallback.mockGames).toEqual(materialized.mockGames);
    });

    it('returns the same compare report when the fallback model/trend branch runs', () => {
      // A store whose only rows are the DF-33 mis-key family: the real-model
      // partition is empty, so the honest fallback model builder AND the
      // assignment-derived fallback trends query both execute.
      repo.seedGame({
        id: 'gate-ghost',
        status: 'ENDED',
        winner: 'TOWN',
        duration: 300_000,
        numPlayers: 2,
        players: [
          {
            id: 'gg-player', name: 'G Player', role: 'VILLAGER', joinOrder: 0,
            provider: 'CUSTOM', model: 'openai', won: 1,
          },
        ],
        events: [
          { type: 'AGENT_SAYS_BROADCASTED', actorId: 'gg-player', data: { says: 'legacy row' } },
        ],
      });
      repo.insertTokenUsage({
        gameId: 'gate-ghost', playerId: 'gg-player', turnNumber: 1,
        provider: 'CUSTOM', model: 'openai', promptTokens: 10,
        completionTokens: 10, totalTokens: 20, cost: 0.1,
      });
      repo.db
        .prepare(
          `INSERT INTO player_model_assignments
             (id, game_id, player_id, player_name, provider, model, role, created_at)
           VALUES ('pma-ghost', 'gate-ghost', 'gg-player', 'G Player',
                   'CUSTOM', 'openai', 'VILLAGER', 1)`,
        )
        .run();
      // A degenerate game the fallback's assignment query must still exclude.
      repo.seedGame({
        id: 'gate-ghost-degen',
        status: 'ENDED',
        winner: 'TOWN',
        duration: 90_000,
        numPlayers: 2,
        players: [
          {
            id: 'ggd-player', name: 'GD Player', role: 'VILLAGER', joinOrder: 0,
            provider: 'CUSTOM', model: 'qwen3', won: 1,
          },
        ],
        events: [
          { type: 'AGENT_SAYS_BROADCASTED', actorId: 'ggd-player', data: {} },
          { type: 'AGENT_SAYS_BROADCASTED', actorId: 'ggd-player', data: {} },
          { type: 'AGENT_SAYS_BROADCASTED', actorId: 'ggd-player', data: {} },
        ],
      });

      const materialized = getCompareReport(repo);
      const fallback = withUnavailableMaterialization(repo, () => getCompareReport(repo));

      expect(materialized.models).toEqual([]);
      expect(materialized.unattributedModels.length).toBeGreaterThan(0);
      expect(fallback).toEqual(materialized);
    });

    it('evaluates the correlated gate once per build and json_each everywhere else', () => {
      seedGateFixture(repo);

      const { result, sqls } = recordStatements(repo, () => getCompareReport(repo));
      expect(result.models.length).toBeGreaterThan(0);

      // Exactly ONE statement carries the correlated degenerate/mock scan: the
      // build's single materialization (the constants live only in the
      // fallback branch now, so nothing here can silently re-run them).
      const materializations = sqls.filter((sql) =>
        sql.includes('SELECT g.id as id FROM games g'),
      );
      expect(materializations).toHaveLength(1);

      // No aggregate re-evaluates the per-row correlated gate: nothing that
      // aggregates players/token_usage may read `events` (the correlated
      // DEGENERATE_GAME_SQL is the only such reader), and the gate-carrying
      // aggregates all probe the materialized set with json_each.
      const aggregates = sqls.filter(
        (sql) => sql.includes('FROM players p') || sql.includes('FROM token_usage tu'),
      );
      expect(aggregates.length).toBeGreaterThanOrEqual(5);
      for (const sql of aggregates) {
        expect(sql).not.toContain('FROM events e');
      }
      const gated = aggregates.filter((sql) => sql.includes('json_each'));
      // getModelStats, usage aggregate, role breakdown, numPlayers
      // breakdown, avg-cost, avg-role-performance, trends.
      expect(gated.length).toBeGreaterThanOrEqual(7);
      expect(materializations[0]).toContain('FROM events e');
    });

    it('getModelComparison() materialized and forced-null paths agree', () => {
      seedGateFixture(repo);

      const materialized = getModelComparison(repo);
      const forcedFallback = getModelComparison(repo, null);

      expect(materialized.length).toBeGreaterThan(0);
      expect(forcedFallback).toEqual(materialized);
    });
  });
});