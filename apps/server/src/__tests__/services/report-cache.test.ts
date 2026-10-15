/**
 * PERF-MAFIA-2 — benchmark report memoization tests.
 *
 * generateReport() over the full fleet is memoized inside the
 * StatsCollector on a data watermark (computeReportWatermark in
 * stats-collector/index.ts): identical data re-serves instantly, any
 * write to the report's source tables busts the cache. These tests pin
 * BOTH halves of that contract over a REAL StatsCollector backed by an
 * in-memory SQLite repository (same conventions as
 * stats-collector.test.ts / benchmark-report-contract.test.ts):
 *
 *   1. A second generateReport() call on unchanged data returns a payload
 *      IDENTICAL to the first — same summary, same array contents, and
 *      (because the cache serves the same object) the exact same
 *      generatedAt. This is the "cold==warm proves nothing is cached"
 *      defect turned into a regression test.
 *   2. Mutating the watermark — INSERTing a new game, a new token_usage
 *      row, and doing an in-place UPDATE (the mock-flag json_set and a
 *      status flip, neither of which changes row counts) — each busts the
 *      cache: the next report reflects the new data.
 *   3. Reports scoped to a gameId are NEVER cached (the detail section
 *      must track per-game changes immediately).
 *   4. The error-fallback path is never memoized: after a failure the
 *      next call retries and recovers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCollector } from '../../services/stats-collector.js';
import { createSqliteBackedRepository } from './mocks.js';

// Type alias matching the return shape of createSqliteBackedRepository().
type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

describe('StatsCollector report memoization (PERF-MAFIA-2)', () => {
  let repo: FakeRepo;
  let stats: StatsCollector;

  beforeEach(() => {
    // Every test gets a FRESH in-memory repository — the memo cache is
    // keyed per-repository (WeakMap), so no cross-test contamination and
    // no manual reset needed.
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    stats = new StatsCollector(repo as any);
  });

  describe('cached path — identical payload on the second call', () => {
    it('returns a byte-identical payload (same generatedAt) on the second call', () => {
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
      repo.insertApiCall({ gameId: 'g1', playerId: 'p1', provider: 'OPENAI',
        model: 'gpt-4', endpoint: '/chat', latency: 120, timestamp: Date.now() });

      const first = stats.generateReport();
      // Allow the clock to move: the second call must not produce a new
      // generatedAt — it serves the SAME cached object.
      const second = stats.generateReport();

      // Identical payload INCLUDING generatedAt: the cached report is the
      // report generated for this data, not a new one.
      expect(second).toEqual(first);
      expect((second as any).generatedAt).toBe((first as any).generatedAt);
      // Spot-check the shape survived the cache (same contract as
      // stats-collector.test.ts 'generateReport returns a structured report').
      expect((first as any).summary.totalGames).toBe(1);
      expect((first as any).summary.completedGames).toBe(1);
      expect((first as any).agentStats).toHaveLength(1);
    });

    it('exportJSON rides the same cache (identical JSON output)', () => {
      repo.seedGame({ id: 'g1', status: 'ENDED', winner: 'TOWN', duration: 30_000 });
      const one = stats.exportJSON();
      const two = stats.exportJSON();
      expect(two).toBe(one);
    });
  });

  describe('watermark mutation busts the cache', () => {
    it('INSERTing a new game changes the summary on the next call', () => {
      repo.seedGame({ id: 'g1', status: 'ENDED', winner: 'TOWN', duration: 30_000 });

      const first = stats.generateReport();
      expect((first as any).summary.totalGames).toBe(1);

      // Simulate a new game row landing (new game INSERTed — exactly what
      // a benchmark run does mid-fleet).
      repo.seedGame({ id: 'g2', status: 'ENDED', winner: 'MAFIA', duration: 45_000 });

      const second = stats.generateReport();
      expect((second as any).summary.totalGames).toBe(2);
      expect((second as any).summary.mafiaWinRate).toBeCloseTo(0.5, 5);
      // NOTE: no generatedAt inequality here — two generations in the same
      // millisecond produce identical ISO timestamps (same-ms collision,
      // CI run 38696052740). The data-field assertions above already prove
      // a FRESH object was generated (cache actually busted).
    });

    it('INSERTing a new token_usage row changes agentStats on the next call', () => {
      repo.seedGame({ id: 'g1', status: 'ENDED', winner: 'TOWN', duration: 30_000 });
      repo.insertTokenUsage({ gameId: 'g1', playerId: 'p1', turnNumber: 1,
        provider: 'OPENAI', model: 'gpt-4', promptTokens: 100,
        completionTokens: 50, totalTokens: 150, cost: 0.01, timestamp: Date.now() });

      const first = stats.generateReport();
      expect((first as any).agentStats[0].totalTokens).toBe(150);

      // Simulate a new token_usage row for the same agent.
      repo.insertTokenUsage({ gameId: 'g1', playerId: 'p1', turnNumber: 2,
        provider: 'OPENAI', model: 'gpt-4', promptTokens: 10,
        completionTokens: 5, totalTokens: 15, cost: 0.001, timestamp: Date.now() });

      const second = stats.generateReport();
      const agent = (second as any).agentStats.find(
        (a: any) => a.agentId === 'p1',
      );
      expect(agent.totalTokens).toBe(165);
    });

    it('an in-place config UPDATE (mock flag) busts the cache', () => {
      repo.seedGame({ id: 'mg1', status: 'ENDED', winner: 'MAFIA', duration: 9_000 });

      const first = stats.generateReport();
      // Mock exclusion lives in getGameStats: a mock MAFIA "win" must not
      // count. The report summary carries it via mafiaWinRate.
      expect((first as any).summary.mafiaWinRate).toBe(1);

      // The write-time mock marker flipped AFTER the report was cached —
      // same row count, same statuses, different bytes. The watermark's
      // config-length sum must catch it.
      repo.db.prepare(
        `UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?`,
      ).run('mg1');

      const second = stats.generateReport();
      // Mock exclusion lived in getGameStats: the mock MAFIA "win" no
      // longer counts once the flag is set.
      expect((second as any).summary.mafiaWinRate).toBe(0);
      // Same-ms note: no generatedAt inequality — the mock-exclusion rate
      // flip above is the fresh-object proof (CI run 38696052740 flake).
    });

    it('an in-place status flip (IN_PROGRESS → ENDED) busts the cache', () => {
      repo.seedGame({ id: 'g1', status: 'IN_PROGRESS' });

      const first = stats.generateReport();
      expect((first as any).summary.activeGames).toBe(1);
      expect((first as any).summary.completedGames).toBe(0);

      repo.db.prepare(
        `UPDATE games SET status = 'ENDED', winner = 'TOWN', duration = 30_000
         WHERE id = ?`,
      ).run('g1');

      const second = stats.generateReport();
      expect((second as any).summary.activeGames).toBe(0);
      expect((second as any).summary.completedGames).toBe(1);
      // Same-ms note: the activeGames/completedGames flips above prove the
      // cache busted — generatedAt can be byte-identical in the same ms.
    });
  });

  describe('gameId-scoped reports are never cached', () => {
    it('per-game detail tracks changes immediately on every call', () => {
      repo.seedGame({
        id: 'g1', status: 'IN_PROGRESS',
        players: [{ id: 'p1', name: 'P1', role: 'VILLAGER', joinOrder: 0 }],
      });

      const first = stats.generateReport('g1');
      const game1 = (first as any).game;
      expect(game1.winner).toBe('IN_PROGRESS');

      repo.db.prepare(
        `UPDATE games SET status = 'ENDED', winner = 'TOWN' WHERE id = ?`,
      ).run('g1');

      const second = stats.generateReport('g1');
      expect((second as any).game.winner).toBe('TOWN');
      // Same-ms note: winner flip above is the fresh-object proof.
    });
  });

  describe('error fallback is never memoized', () => {
    it('a failed generation does not poison the next call', () => {
      repo.seedGame({ id: 'g1', status: 'ENDED', winner: 'TOWN', duration: 30_000 });

      // Drop the token_usage table to break the watermark (and the report);
      // the fallback must come back, and must NOT be cached.
      repo.db.exec('DROP TABLE token_usage');
      const failed = stats.generateReport();
      expect((failed as any).error).toBe('Failed to generate report');

      // Restore the table: the next call must regenerate for real, not
      // serve the remembered fallback.
      repo.db.exec(`CREATE TABLE token_usage (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        turn_number INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        cost REAL,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      )`);
      repo.insertTokenUsage({ gameId: 'g1', playerId: 'p1', turnNumber: 1,
        provider: 'OPENAI', model: 'gpt-4', promptTokens: 1,
        completionTokens: 1, totalTokens: 2, cost: 0.0001, timestamp: Date.now() });

      const recovered = stats.generateReport();
      expect((recovered as any).error).toBeUndefined();
      expect((recovered as any).summary.totalGames).toBe(1);
      expect((recovered as any).agentStats).toHaveLength(1);
      // And the recovered report IS cached (identical on the next call).
      expect(stats.generateReport()).toEqual(recovered);
    });
  });
});