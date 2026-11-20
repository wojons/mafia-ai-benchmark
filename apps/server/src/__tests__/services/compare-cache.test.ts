/**
 * PERF-MAFIA-3 / PERF-MAFIA-5 — benchmark compare memoization tests.
 *
 * getCompareReport() is memoized inside the StatsCollector on the same
 * data-watermark mechanism the full-fleet report uses (PERF-MAFIA-2),
 * keyed per GameRepository (WeakMap) AND per normalized `?models=` filter.
 * PERF-MAFIA-5 arm 2 turned that memo into STALE-WHILE-REVALIDATE: a cached
 * report is served with ZERO database work on the request path, and the
 * watermark validation + rebuild run in a throttled background refresh
 * (COMPARE_REFRESH_THROTTLE_MS) that the tests await via
 * flushCompareRefresh().
 *
 * These tests pin BOTH halves of that contract over a REAL StatsCollector
 * backed by an in-memory SQLite repository (same conventions as
 * report-cache.test.ts / stats-collector.test.ts):
 *
 *   1. A second getCompareReport() call on unchanged data returns a payload
 *      IDENTICAL to the first (same object identity — the cache serves the
 *      cached reference) AND prepares no SQL at all.
 *   2. Mutating a compare source — INSERTing a game, a token_usage row, a
 *      benchmark_games row (head-to-head derivation), changing a players
 *      role in place (rolePerformance cells), and flipping a model in a
 *      player_model_assignments row (legacy trend fallback) — is served
 *      stale on the calling path (bounded staleness) and then reflected by
 *      the deferred refresh: the NEXT report after flushCompareRefresh()
 *      reflects the new data.
 *   3. Concurrent callers during a pending rebuild all get the cached
 *      reference promptly, coalesce into ONE validation cycle, and see the
 *      rebuilt report afterwards.
 *   4. The true cold path (no report for that filter) still fingerprints and
 *      builds synchronously and returns correct data.
 *   5. The `?models=` filter is part of the cache key: a filtered call
 *      never re-serves the unfiltered report (and vice versa).
 *   6. An error fallback is never memoized, and a broken/absent fingerprint
 *      destroys the entry instead of serving it forever (compute fresh,
 *      never memoize); a rebuild that throws keeps the last-good report.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCollector } from '../../services/stats-collector.js';
import {
  flushCompareRefresh,
  COMPARE_REFRESH_THROTTLE_MS,
} from '../../services/stats-collector.js';
import {
  getCompareReport,
  getModelComparison,
} from '../../services/stats-collector/models.js';
import { createSqliteBackedRepository } from './mocks.js';

// Type alias matching the return shape of createSqliteBackedRepository().
type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

/**
 * Statements that identify the compare fingerprint (base + compare-only).
 * Matching them is how the tests tell "the store was re-validated" apart
 * from "the store was fingerprinted inside the request".
 */
const FINGERPRINT_MARKERS = ['AS gamesFp', 'AS bgCount'];

/**
 * The BASE watermark statement (`computeCompletedCompareBaseWatermark`)
 * prepares exactly one statement per validation cycle, so counting it
 * counts cycles — the compare-only half is a second statement in the same
 * cycle and would double-count.
 */
const BASE_FINGERPRINT_MARKER = 'AS gamesFp';

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

  /**
   * Record every statement `prepare()`d while `fn` runs.
   *
   * PERF-MAFIA-5 arm 2: a cache HIT must prepare NOTHING — an empty list is
   * the direct proof that neither the fingerprint scan nor a rebuild happened
   * on the calling (request) path, which is the whole point of the row.
   */
  function capturePreparedStatements<T>(
    target: FakeRepo,
    fn: () => T,
  ): { result: T; sqls: string[] } {
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
   * Install a store whose reads fail selectively for `fn`'s lifetime:
   * `block` decides which prepared statements throw. Returns the failure
   * count so a test can prove the sabotage actually bit (no vacuous pass).
   */
  function withFailingStatements<T>(
    target: FakeRepo,
    block: (sql: string) => boolean,
    fn: () => Promise<T>,
  ): Promise<T> {
    const db = target.db as unknown as { prepare: (sql: string) => unknown };
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      if (block(sql)) throw new Error('PERF-MAFIA-5 test: statement unavailable');
      return realPrepare(sql);
    };
    return fn().finally(() => {
      db.prepare = realPrepare;
    });
  }

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
      const { result: second, sqls } = capturePreparedStatements(repo, () =>
        stats.getCompareReport(),
      );
      expect(second).toBe(first);
      // PERF-MAFIA-5 arm 2: and it must do so without touching the store —
      // no fingerprint scan, no rebuild, not even a pragma.
      expect(sqls).toEqual([]);
      // Spot-check the shape survived the cache round-trip.
      expect(second.models).toHaveLength(1);
      expect(second.models[0].model).toBe('gpt-4');
      expect(second.models[0].gamesPlayed).toBe(1);
    });
  });

  describe('watermark mutation is picked up by the deferred refresh', () => {
    it('ignores events appended to an in-progress game', async () => {
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
      // The deferred validation must agree: it recomputes the fingerprint,
      // finds it unchanged, and keeps serving the same report.
      await flushCompareRefresh(repo);
      expect(stats.getCompareReport()).toBe(first);
    });

    it('still invalidates when a terminal event changes completed statistics', async () => {
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

      // PERF-MAFIA-5 arm 2: the calling path serves the cached report — it
      // does not fingerprint and does not rebuild (bounded staleness).
      expect(stats.getCompareReport()).toBe(first);

      // ...and the deferred refresh reflects the mutation.
      await flushCompareRefresh(repo);
      const second = stats.getCompareReport();
      expect(second).not.toBe(first);
      expect(second.models[0].wins).toBe(1);
    });

    it('INSERTing a new game changes gamesPlayed after the deferred refresh', async () => {
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

      // Bounded staleness: served from cache, no fingerprint on the caller.
      const { result: stale, sqls } = capturePreparedStatements(repo, () =>
        stats.getCompareReport(),
      );
      expect(stale).toBe(first);
      expect(stale.models[0].gamesPlayed).toBe(1);
      expect(sqls).toEqual([]);

      await flushCompareRefresh(repo);

      const second = stats.getCompareReport();
      expect(second).not.toBe(first);
      expect(second.models[0].gamesPlayed).toBe(2);
      expect(second.models[0].wins).toBe(1);
    });

    it('INSERTing a token_usage row changes avgTokensPerGame after the deferred refresh', async () => {
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

      expect(stats.getCompareReport()).toBe(first);

      await flushCompareRefresh(repo);

      const second = stats.getCompareReport();
      expect(second.models[0].avgTokensPerGame).toBe(150);
    });

    it('INSERTing a benchmark_games row changes headToHead after the deferred refresh', async () => {
      // The compare-only source: head-to-head is derived from
      // benchmark_games (DF-40) — a table the base report watermark does
      // not cover. The deferred validation MUST bust on its writes.
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

      expect(stats.getCompareReport()).toBe(first);

      await flushCompareRefresh();

      const second = stats.getCompareReport();
      expect(second).not.toBe(first);
      expect(second.headToHead.length).toBeGreaterThan(0);
      const pairing = second.headToHead[0];
      expect(pairing.modelA).toBe('google/gemini-2.5-flash');
      expect(pairing.modelB).toBe('openai/gpt-4o-mini');
      expect(pairing.modelAWins).toBe(1);
    });

    it('an in-place players role UPDATE changes rolePerformance after the deferred refresh', async () => {
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

      expect(stats.getCompareReport()).toBe(first);

      await flushCompareRefresh(repo);

      const second = stats.getCompareReport();
      expect(second.models[0].rolePerformance['MAFIA']).toBeDefined();
      expect(second.models[0].rolePerformance['VILLAGER']).toBeUndefined();
    });

    it('an in-place player_model_assignments model UPDATE changes the fallback trends', async () => {
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

      expect(stats.getCompareReport()).toBe(first);

      await flushCompareRefresh(repo);

      const second = stats.getCompareReport();
      const trendAfter = second.trends.find(
        (t) => t.model === 'openai/gpt-4o',
      );
      expect(trendAfter).toBeDefined();
      expect(second.trends.find((t) => t.model === 'openai/gpt-4o-mini'))
        .toBeUndefined();
    });
  });

  /**
   * PERF-MAFIA-5 arm 2 — the stale-while-revalidate contract itself:
   * the request path never fingerprints/rebuilds, the refresh is throttled
   * and coalesced, and freshness always lands (arm 4 rebuild path).
   */
  describe('PERF-MAFIA-5 arm 2 — stale-while-revalidate rebuild path', () => {
    function seedTwoModels() {
      repo.seedGame({
        id: 'g1', status: 'ENDED', winner: 'MAFIA', duration: 60_000,
        players: [{
          id: 'p1', name: 'P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
          provider: 'openai', model: 'gpt-4o-mini', won: 1,
        }],
      });
    }

    it('documents a bounded staleness window (throttle <= 2 s)', () => {
      // The row's documented bound: validation is deferred by at most one
      // throttle window. Pin it so a drive-by "make it faster" change cannot
      // quietly turn the bound into "whenever the next request happens".
      expect(COMPARE_REFRESH_THROTTLE_MS).toBeGreaterThan(0);
      expect(COMPARE_REFRESH_THROTTLE_MS).toBeLessThanOrEqual(2000);
    });

    it('true cold path fingerprints and builds synchronously, then caches', () => {
      seedTwoModels();

      // No report for this filter yet: this call is ALLOWED to block, and it
      // must fingerprint (so the entry can be stored against its data).
      const { result, sqls } = capturePreparedStatements(repo, () =>
        stats.getCompareReport(),
      );
      expect(sqls.some((sql) => FINGERPRINT_MARKERS.some((m) => sql.includes(m))))
        .toBe(true);
      expect(result.models).toHaveLength(1);
      expect(result.models[0].gamesPlayed).toBe(1);

      // ...and the next call rides the cache with zero database work.
      const { result: warm, sqls: warmSqls } = capturePreparedStatements(repo, () =>
        stats.getCompareReport(),
      );
      expect(warm).toBe(result);
      expect(warmSqls).toEqual([]);
    });

    it('concurrent callers during a pending rebuild return promptly, coalesce into ONE cycle, and see the rebuilt report', async () => {
      seedTwoModels();
      const first = stats.getCompareReport();

      // An ENDED game finishes while the dashboard is being polled.
      repo.seedGame({
        id: 'g2', status: 'ENDED',
        players: [{
          id: 'g2p1', name: 'G2P1', role: 'TOWN', joinOrder: 0,
          provider: 'openai', model: 'gpt-4o-mini', won: 0,
        }],
      });

      // Four callers in the same tick: every one gets the cached reference
      // and NONE of them fingerprints or rebuilds (no head-of-line block).
      const { result: burst, sqls } = capturePreparedStatements(repo, () => [
        stats.getCompareReport(),
        stats.getCompareReport(),
        stats.getCompareReport(),
        stats.getCompareReport(),
      ]);
      expect(burst).toHaveLength(4);
      for (const report of burst) expect(report).toBe(first);
      expect(sqls).toEqual([]);
      // Still the pre-mutation payload: staleness is real and bounded, not
      // silently "correct because the caller rebuilt".
      expect(burst[3].models[0].gamesPlayed).toBe(1);

      // The four requests must have queued ONE validation cycle, not four.
      let fingerprintRuns = 0;
      {
        const db = repo.db as unknown as { prepare: (sql: string) => unknown };
        const realPrepare = db.prepare.bind(db);
        db.prepare = (sql: string) => {
          if (sql.includes(BASE_FINGERPRINT_MARKER)) fingerprintRuns += 1;
          return realPrepare(sql);
        };
        try {
          await flushCompareRefresh();
        } finally {
          db.prepare = realPrepare;
        }
      }
      expect(fingerprintRuns).toBe(1);

      // The rebuild landed: freshness is guaranteed, staleness is not forever.
      const fresh = stats.getCompareReport();
      expect(fresh).not.toBe(first);
      expect(fresh.models[0].gamesPlayed).toBe(2);
    });

    it('a broken fingerprint destroys the entry — compute fresh, never memoize', async () => {
      seedTwoModels();
      const first = stats.getCompareReport();
      expect(first.models[0].gamesPlayed).toBe(1);

      repo.seedGame({
        id: 'g2', status: 'ENDED',
        players: [{
          id: 'g2p1', name: 'G2P1', role: 'TOWN', joinOrder: 0,
          provider: 'openai', model: 'gpt-4o-mini', won: 0,
        }],
      });

      // Fingerprint reads fail (schema variant / broken store); the report
      // build itself still works.
      let uncached: { result: ReturnType<typeof stats.getCompareReport>; sqls: string[] } | null = null;
      let again: { result: ReturnType<typeof stats.getCompareReport>; sqls: string[] } | null = null;
      await withFailingStatements(
        repo,
        (sql) => FINGERPRINT_MARKERS.some((m) => sql.includes(m)),
        async () => {
          // The calling path still serves what it has (zero DB work)...
          expect(stats.getCompareReport()).toBe(first);
          // ...but the deferred validation cannot fingerprint, so it DROPS
          // the entry rather than re-serving it forever.
          await flushCompareRefresh(repo);

          // Next call is the cold path: with no fingerprint to store under,
          // the report is computed fresh and NEVER memoized.
          uncached = capturePreparedStatements(repo, () => stats.getCompareReport());
          again = capturePreparedStatements(repo, () => stats.getCompareReport());
        },
      );

      expect(uncached!.result).not.toBe(first);
      expect(uncached!.result.models[0].gamesPlayed).toBe(2);
      // Two consecutive cold calls → two distinct objects (uncached).
      expect(again!.result).not.toBe(uncached!.result);
      expect(again!.result.models[0]).toEqual(uncached!.result.models[0]);

      // Once the fingerprint is readable again the report is cacheable again.
      const recovered = stats.getCompareReport();
      expect(recovered.models[0].gamesPlayed).toBe(2);
      expect(stats.getCompareReport()).toBe(recovered);
    });

    it('a rebuild that throws keeps the last-good report instead of blanking the cache', async () => {
      seedTwoModels();
      const first = stats.getCompareReport();

      repo.seedGame({
        id: 'g2', status: 'ENDED',
        players: [{
          id: 'g2p1', name: 'G2P1', role: 'TOWN', joinOrder: 0,
          provider: 'openai', model: 'gpt-4o-mini', won: 0,
        }],
      });

      // Fingerprint readable, build broken — a transient read failure.
      let buildFailures = 0;
      await withFailingStatements(
        repo,
        (sql) => {
          if (FINGERPRINT_MARKERS.some((m) => sql.includes(m))) return false;
          buildFailures += 1;
          return true;
        },
        async () => {
          expect(stats.getCompareReport()).toBe(first);
          await flushCompareRefresh(repo);
        },
      );
      // Non-vacuity: the build really was attempted and really failed.
      expect(buildFailures).toBeGreaterThan(0);
      // The last-good report survives the failed rebuild...
      expect(stats.getCompareReport()).toBe(first);

      // ...and the next validation cycle (now that reads work again) heals it.
      await flushCompareRefresh(repo);
      const fresh = stats.getCompareReport();
      expect(fresh).not.toBe(first);
      expect(fresh.models[0].gamesPlayed).toBe(2);
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

    it('the deferred refresh rebuilds each cached filter key from its own filter', async () => {
      repo.seedGame({
        id: 'g1', status: 'ENDED',
        players: [
          { id: 'p1', name: 'P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'gpt-4o-mini', won: 1 },
        ],
      });

      const unfiltered = stats.getCompareReport();
      const filtered = stats.getCompareReport(['gpt-4o-mini']);

      // A new ENDED game with a DIFFERENT model: the unfiltered rebuild must
      // pick it up, the filtered one must NOT (filter stays in the key, it is
      // never dropped by the refresh).
      repo.seedGame({
        id: 'g2', status: 'ENDED',
        players: [
          { id: 'p2', name: 'P2', role: 'TOWN', joinOrder: 0,
            provider: 'anthropic', model: 'claude-3', won: 1 },
        ],
      });

      // Touch both keys so both are queued for the refresh.
      expect(stats.getCompareReport()).toBe(unfiltered);
      expect(stats.getCompareReport(['gpt-4o-mini'])).toBe(filtered);

      await flushCompareRefresh();

      expect(stats.getCompareReport().models).toHaveLength(2);
      const filteredAfter = stats.getCompareReport(['gpt-4o-mini']);
      expect(filteredAfter.models).toHaveLength(1);
      expect(filteredAfter.models[0].model).toBe('gpt-4o-mini');
    });
  });

  describe('error fallback is never memoized', () => {
    it('a failed comparison does not poison the next call', async () => {
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
      await flushCompareRefresh(repo);
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
     * Does this statement carry the CORRELATED degenerate/mock gate — the
     * per-row re-classification of the enclosing `games` row that PERF-MAFIA-6
     * removed from the compare build?
     *
     * Matched on the canonical predicate TEXT (GameRepository
     * .DEGENERATE_GAME_SQL / .MOCK_GAME_SQL both open with
     * `CASE WHEN <alias>.status != 'ENDED'`, aliased g / gdeg / gmock), not on a
     * call site: a statement added later that never imports the helper still
     * trips this detector. Any SQL outside those two constants that opened a
     * CASE on a games alias status would be a false positive, which is the
     * conservative direction for a structural gate.
     */
    const CORRELATED_GATE_MARKER = /WHEN\s+[A-Za-z_][A-Za-z0-9_]*\.status\s*!=\s*'ENDED'/;
    function carriesCorrelatedGate(sql: string): boolean {
      return CORRELATED_GATE_MARKER.test(sql);
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

      // benchmark_games rows so the head-to-head derivation (the compare
      // build's benchmark_games statement) has something to classify:
      //   p-gate-degen  parent game IS degenerate → row kept (gamesPlayed/ties),
      //                 win attribution refused by the gate;
      //   p-gate-orphan parent games row is GONE → row kept and classified
      //                 INCLUDED by both gate paths (the LEFT JOIN contract).
      target.insertBenchmarkRun({
        id: 'run-gate', config: {}, status: 'COMPLETED',
      });
      target.insertBenchmarkGame({
        game_id: 'gate-degen', run_id: 'run-gate', pairing_id: 'p-gate-degen',
        model_a: 'fake/degenerate-only', model_b: 'fake/degenerate-only',
        seed: 1, model_a_role: 'VILLAGER', model_b_role: 'VILLAGER',
        winner: 'TOWN', completed_at: Date.now(), valid: 1,
      });
      // benchmark_games.game_id FKs games(id); a real store can still carry the
      // row after the parent is gone, so this fixture seeds one with enforcement
      // off (same convention as the orphaned token_usage row above).
      target.db.pragma('foreign_keys = OFF');
      target.insertBenchmarkGame({
        game_id: 'gate-orphan', run_id: 'run-gate', pairing_id: 'p-gate-orphan',
        model_a: 'openai/gpt-4o-mini', model_b: 'anthropic/claude-3',
        seed: 1, model_a_role: 'VILLAGER', model_b_role: 'VILLAGER',
        winner: 'TOWN', completed_at: Date.now(), valid: 1,
      });
      target.db.pragma('foreign_keys = ON');
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

      // The head-to-head projection is gated, not filtered: a degenerate
      // parent game still counts toward gamesPlayed (honest `ties` remainder)
      // and contributes NO win, and an orphaned benchmark_games row (parent
      // games row gone) stays INCLUDED on both paths.
      const degenPair = materialized.headToHead.find(
        (r) => r.modelA === 'fake/degenerate-only',
      );
      expect(degenPair).toBeDefined();
      expect(degenPair!.gamesPlayed).toBe(1);
      expect(degenPair!.modelAWins).toBe(0);
      expect(degenPair!.ties).toBe(1);
      const orphanPair = materialized.headToHead.find(
        (r) => r.modelA === 'openai/gpt-4o-mini' && r.modelB === 'anthropic/claude-3',
      );
      expect(orphanPair).toBeDefined();
      expect(orphanPair!.gamesPlayed).toBe(1);

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

    it('evaluates the correlated gate once per build — every other prepared statement probes the materialized set', () => {
      seedGateFixture(repo);

      const { result, sqls } = recordStatements(repo, () => getCompareReport(repo));
      expect(result.models.length).toBeGreaterThan(0);
      expect(sqls.length).toBeGreaterThanOrEqual(10);

      // Exactly ONE statement carries the correlated degenerate/mock scan: the
      // build's single materialization (the constants live only in the
      // fallback branch now, so nothing here can silently re-run them).
      const materializations = sqls.filter((sql) =>
        sql.includes('SELECT g.id as id FROM games g'),
      );
      expect(materializations).toHaveLength(1);
      expect(carriesCorrelatedGate(materializations[0])).toBe(true);

      // The ONLY other correlated classification allowed in this build is the
      // mock AUDIT counter (#mockGames on the report). It is not an aggregate
      // row filter: it counts mock games in one pass over games, it cannot be
      // derived from the included-id set, and it carries MOCK_GAME_SQL only (no
      // `events` scan). Pinned by name so a SECOND correlated statement cannot
      // hide behind the exemption.
      const auditCounters = sqls.filter((sql) => sql.includes('as count FROM games g'));
      expect(auditCounters).toHaveLength(1);
      for (const sql of auditCounters) {
        expect(sql).not.toContain('FROM events e');
      }

      // EVERY statement this build prepares is inspected — no players /
      // token_usage narrowing (that narrowing is exactly how the
      // benchmark_games head-to-head statement kept its per-row correlated scan;
      // tier-2 FAIL 885f285b). Nothing but those two known statements may
      // re-evaluate the gate.
      const correlated = sqls.filter((sql) => carriesCorrelatedGate(sql));
      const unexpected = correlated.filter(
        (sql) => sql !== materializations[0] && sql !== auditCounters[0],
      );
      expect(unexpected).toEqual([]);

      // The head-to-head statement is covered by the assertion above: it is
      // prepared by this build and it probes the materialized set instead of
      // carrying the correlated gate.
      const headToHead = sqls.filter((sql) => sql.includes('FROM benchmark_games bg'));
      expect(headToHead).toHaveLength(1);
      expect(headToHead[0]).toContain('json_each');
      expect(carriesCorrelatedGate(headToHead[0])).toBe(false);

      // Spread check: the gate-carrying aggregates all probe the set —
      // getModelStats, usage aggregate, assignments, role breakdown,
      // numPlayers breakdown, avg-cost, avg-role-performance, trends and the
      // head-to-head derivation.
      const gated = sqls.filter((sql) => sql.includes('json_each'));
      expect(gated.length).toBeGreaterThanOrEqual(8);
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