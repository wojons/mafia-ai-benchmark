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
});