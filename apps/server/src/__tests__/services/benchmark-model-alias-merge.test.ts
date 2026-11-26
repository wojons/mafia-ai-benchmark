/**
 * DF-MAFIA-AI-BENCHMARK-55 — a dated snapshot id must not survive as its
 * own model series, and recommendations must require a real sample.
 *
 * Live probe 2026-11-23 (the shapes this file pins):
 *   - GET /api/v1/benchmark/compare served compare.models[2] =
 *     { model 'gpt-4o-2024-08-06', gamesPlayed 1, winRate 1,
 *       avgTokensPerGame 10324, avgCostPerGame 0.0372 } as a SEPARATE
 *     series beside 'gpt-4o' — one game under the dated id OpenAI returned
 *     for a window fragmented the leaderboard.
 *   - report.recommendations crowned 'Best win rate:
 *     OPENAI/gpt-4o-2024-08-06 (100.0%)' on that single game.
 *   - The BenchmarkLeaderboard rendered the alias row's avg-token /
 *     avg-cost cells EMPTY.
 *
 * Contracts pinned here:
 *   1. compare.models carries NO 'gpt-4o-2024-08-06' row — the alias game
 *      is merged into the 'OPENAI/gpt-4o' series (gamesPlayed 99 + 1 = 100,
 *      the alias win counted), with its tokens/cost folded into the merged
 *      row's averages.
 *   2. The alias is equally gone from report.modelPerformance — both
 *      benchmark surfaces keep one key set (DF-36 parity).
 *   3. normalizeModelKey maps the dated id (any provider spelling) to the
 *      engine family, and ONLY the exact ids in MODEL_FAMILY_ALIASES — a
 *      different snapshot-looking id is untouched.
 *   4. generateRecommendations never names a model with gamesPlayed below
 *      MIN_RECOMMENDATION_SAMPLE (5) as best — the gate holds even at
 *      winRate 1.0, on both the win-rate and the value recommendation.
 *
 * Contract proof level: the series-merge is asserted at the SERVICE level
 * through the real express router (createBenchmarkRouter) against a real
 * in-memory SQLite store — the same store/SQL the live server runs — not
 * against a mocked repository.
 */

import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createBenchmarkRouter } from '../../routes/benchmark.js';
import { createStatsRouter } from '../../routes/stats.js';
import { StatsCollector } from '../../services/stats-collector.js';
import {
  generateRecommendations,
  normalizeModelKey,
  MIN_RECOMMENDATION_SAMPLE,
} from '../../services/stats-collector/models.js';
import {
  canonicalizeModelFamily,
  isDatedModelAlias,
} from '../../services/model-identity.js';
import { createSqliteBackedRepository } from './mocks.js';

type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

type ModelRow = {
  provider: string;
  model: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgTokensPerGame: number;
  avgCostPerGame: number;
};

const ALIAS_MODEL = 'gpt-4o-2024-08-06';
const BASE_MODEL = 'gpt-4o';
const BASE_GAMES = 99; // + 1 alias game = the 100-game merged series

describe('DF-MAFIA-AI-BENCHMARK-55 — dated gpt-4o alias + min-sample recommendations', () => {
  let repo: FakeRepo | null = null;
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }
    repo?.db.close();
    repo = null;
  });

  async function startServer(seeded: FakeRepo): Promise<string> {
    const statsCollector = new StatsCollector(seeded as never);
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createBenchmarkRouter({
        benchmarkRunner: {} as never, // these routes never touch the runner
        statsCollector,
      } as never),
    );
    // The stats surface (DF-55 persisted-head-to-head arm) shares the same
    // collector + repo — extra routes on distinct paths, benchmark routes
    // untouched.
    app.use(
      '/',
      createStatsRouter({
        statsCollector,
        gameRepository: seeded as never,
      } as never),
    );
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () =>
        resolve(listener as Server),
      );
    });
    const address = server.address() as { port: number };
    return `http://127.0.0.1:${address.port}`;
  }

  async function fetchJson<T>(baseUrl: string, path: string): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    return body.data as T;
  }

  /**
   * The probe fixture: 99 ended games under the plain engine id
   * ('OPENAI'/'gpt-4o', every base game a loss) plus ONE ended game under
   * the dated snapshot id ('OPENAI'/'gpt-4o-2024-08-06', won), carrying
   * usage exactly like the probe row (10324 tokens, $0.0372).
   */
  function seedAliasFixture(db: FakeRepo): void {
    for (let i = 0; i < BASE_GAMES; i++) {
      db.seedGame({
        id: `base-${i}`,
        status: 'ENDED',
        winner: 'MAFIA',
        players: [
          {
            id: `base-p-${i}`,
            name: `town-${i}`,
            role: 'VILLAGER',
            isMafia: false,
            won: 0,
            joinOrder: 0,
            provider: 'OPENAI',
            model: BASE_MODEL,
          },
        ],
      });
    }
    db.seedGame({
      id: 'alias-1',
      status: 'ENDED',
      winner: 'MAFIA',
      players: [
        {
          id: 'alias-p-1',
          name: 'mafia-alias',
          role: 'MAFIA',
          isMafia: true,
          won: 1,
          joinOrder: 0,
          provider: 'OPENAI',
          model: ALIAS_MODEL,
        },
      ],
    });
    db.insertTokenUsage({
      gameId: 'alias-1',
      playerId: 'alias-p-1',
      turnNumber: 1,
      provider: 'OPENAI',
      model: ALIAS_MODEL,
      promptTokens: 9000,
      completionTokens: 1324,
      totalTokens: 10324,
      cost: 0.0372,
    });
  }

  it('compare.models merges the dated alias into the gpt-4o series (100 games, win + usage counted)', async () => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    seedAliasFixture(repo);
    const baseUrl = await startServer(repo);

    const data = await fetchJson<{
      models: ModelRow[];
      unattributedModels: Array<ModelRow & { key: string }>;
      trends: Array<{ model: string }>;
    }>(baseUrl, '/api/v1/benchmark/compare');

    const rows = data.models;
    // The dated id renders as NO series of its own.
    expect(rows.some((r) => r.model === ALIAS_MODEL)).toBe(false);
    expect(
      data.unattributedModels.some((r) => r.model === ALIAS_MODEL),
    ).toBe(false);

    const merged = rows.find(
      (r) => r.provider === 'OPENAI' && r.model === BASE_MODEL,
    );
    expect(merged).toBeDefined();
    // 99 base games + 1 alias game — the alias game is COUNTED, not dropped
    // by the cross-source merge-max.
    expect(merged!.gamesPlayed).toBe(BASE_GAMES + 1);
    // The alias game's win is side-attributed into the merged series.
    expect(merged!.wins).toBe(1);
    expect(merged!.winRate).toBeCloseTo(1 / (BASE_GAMES + 1), 6);
    // The alias game's usage folds into the merged row's averages (the
    // probe's populated values) — no empty leaderboard cells.
    expect(merged!.avgTokensPerGame).toBe(10324);
    expect(merged!.avgCostPerGame).toBeCloseTo(0.0372, 6);

    // No ghost trend series for the alias.
    expect(
      data.trends.some((t) => t.model.includes(ALIAS_MODEL)),
    ).toBe(false);
  });

  it('report.modelPerformance merges the alias identically — one key set across both benchmark surfaces', async () => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    seedAliasFixture(repo);
    const baseUrl = await startServer(repo);

    const [report, compare] = await Promise.all([
      fetchJson<{
        modelPerformance: ModelRow[];
        recommendations: string[];
      }>(baseUrl, '/api/v1/benchmark/report'),
      fetchJson<{ models: ModelRow[] }>(baseUrl, '/api/v1/benchmark/compare'),
    ]);

    const reportRows = report.modelPerformance;
    expect(reportRows.some((r) => r.model === ALIAS_MODEL)).toBe(false);
    const reportMerged = reportRows.find(
      (r) => r.provider === 'OPENAI' && r.model === BASE_MODEL,
    );
    expect(reportMerged).toBeDefined();
    expect(reportMerged!.gamesPlayed).toBe(BASE_GAMES + 1);

    // DF-36 parity survives the merge: same key set on both surfaces.
    const rowKey = (r: ModelRow) => `${r.provider}/${r.model}`;
    expect(compare.models.map(rowKey).sort()).toEqual(
      reportRows.map(rowKey).sort(),
    );

    // No recommendation may name the dated id (it no longer exists as a
    // row; the gate below also covers any future sparse series).
    for (const rec of report.recommendations) {
      expect(rec.includes(ALIAS_MODEL)).toBe(false);
    }
  });

  it('normalizeModelKey collapses the dated id under every provider spelling — and ONLY table ids', () => {
    // Plain spelling, provider preserved.
    expect(normalizeModelKey('OPENAI', ALIAS_MODEL)).toEqual({
      provider: 'OPENAI',
      model: BASE_MODEL,
    });
    // Provider-prefixed model string (MAF-GAP-045 shape) still collapses.
    expect(normalizeModelKey('openai', `openai/${ALIAS_MODEL}`)).toEqual({
      provider: 'openai',
      model: BASE_MODEL,
    });
    // CUSTOM passthrough + prefixed (DF-33 shape) re-keys AND collapses.
    expect(normalizeModelKey('CUSTOM', `openai/${ALIAS_MODEL}`)).toEqual({
      provider: 'openai',
      model: BASE_MODEL,
    });
    // Case-insensitive alias lookup.
    expect(canonicalizeModelFamily('GPT-4O-2024-08-06')).toBe(BASE_MODEL);
    expect(isDatedModelAlias(ALIAS_MODEL)).toBe(true);

    // The map is exact: a DIFFERENT snapshot-looking id is NOT collapsed
    // (a benchmark may legitimately compare per snapshot).
    expect(normalizeModelKey('openai', 'gpt-4o-mini-2024-07-18')).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini-2024-07-18',
    });
    expect(isDatedModelAlias('gpt-4o-mini-2024-07-18')).toBe(false);
    // Plain ids untouched.
    expect(normalizeModelKey('OPENAI', BASE_MODEL)).toEqual({
      provider: 'OPENAI',
      model: BASE_MODEL,
    });
  });

  describe('MIN_RECOMMENDATION_SAMPLE gate on generateRecommendations', () => {
    const aliasRow = {
      provider: 'OPENAI',
      model: ALIAS_MODEL,
      gamesPlayed: 1,
      winRate: 1,
      avgCost: 0.0372,
    };
    const baseRow = {
      provider: 'OPENAI',
      model: BASE_MODEL,
      gamesPlayed: 100,
      winRate: 0.52,
      avgCost: 0.03,
    };

    it('never crowns a below-threshold series, even at winRate 1.0', () => {
      // The probe shape in isolation: the single-game 100% alias.
      expect(generateRecommendations([aliasRow])).toEqual([]);

      // Mixed with a qualified model: the alias is not named by either
      // recommendation.
      const recs = generateRecommendations([aliasRow, baseRow]);
      expect(recs).toContain(
        `Best win rate: OPENAI/${BASE_MODEL} (52.0%)`,
      );
      for (const rec of recs) {
        expect(rec.includes(ALIAS_MODEL)).toBe(false);
      }
    });

    it('returns no recommendations when NOTHING meets the sample floor', () => {
      const sparse = [
        { provider: 'a', model: 'm1', gamesPlayed: 1, winRate: 1, avgCost: 0 },
        { provider: 'b', model: 'm2', gamesPlayed: 4, winRate: 0.75, avgCost: 0 },
      ];
      expect(generateRecommendations(sparse)).toEqual([]);
    });

    it('boundary: gamesPlayed == threshold qualifies, threshold - 1 does not', () => {
      const atThreshold = {
        provider: 'openai',
        model: 'at-threshold',
        gamesPlayed: MIN_RECOMMENDATION_SAMPLE,
        winRate: 1,
        avgCost: 0.01,
      };
      expect(generateRecommendations([atThreshold])).toContain(
        'Best win rate: openai/at-threshold (100.0%)',
      );

      const belowThreshold = { ...atThreshold, gamesPlayed: MIN_RECOMMENDATION_SAMPLE - 1 };
      expect(generateRecommendations([belowThreshold])).toEqual([]);
    });

    it('the gate applies to the Best-value recommendation too', () => {
      // The 1-game alias is the cheapest per win — still not nameable.
      const recs = generateRecommendations([aliasRow, baseRow]);
      expect(recs.every((r) => !r.includes(ALIAS_MODEL))).toBe(true);
      expect(recs.some((r) => r.startsWith('Best value:'))).toBe(true);
      expect(recs.find((r) => r.startsWith('Best value:'))).toContain(BASE_MODEL);
    });
  });

  /**
   * Judge 19a1b924 surface: the PERSISTED head-to-head path (model_matchups
   * rows read verbatim by getCompareReport's h2h block and by getMatchups)
   * built its keys straight from row.model_a/model_b with NO
   * normalizeModelKey — a dated id INSERTed into the persisted table
   * surfaced as its own series beside the canonical family, while the
   * derived benchmark_games path was already normalized. Both surfaces must
   * key through the SAME shared alias table (MODEL_FAMILY_ALIASES via
   * normalizeModelKey), preserving the provider spelling.
   */
  describe('persisted model_matchups surfaces key through the alias table', () => {
    type H2hRow = {
      modelA: string;
      modelB: string;
      gamesPlayed: number;
    };

    it('a dated id persisted in model_matchups reads canonical on BOTH the compare headToHead and /stats/matchups', async () => {
      repo = createSqliteBackedRepository() as unknown as FakeRepo;
      // The judge probe shape: model_a carries the dated snapshot id,
      // model_b the distinct mini family. Seeded BEFORE any fetch so the
      // compare report's watermark cache serves a cold computation.
      repo.db
        .prepare(
          `INSERT INTO model_matchups
             (id, model_a_provider, model_a, model_b_provider, model_b,
              games_played, model_a_wins, model_b_wins, ties)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('h2h-judge', 'openai', ALIAS_MODEL, 'openai', 'gpt-4o-mini', 3, 2, 1, 0);
      const baseUrl = await startServer(repo);

      const [compare, matchups] = await Promise.all([
        fetchJson<{ headToHead: H2hRow[] }>(
          baseUrl,
          '/api/v1/benchmark/compare',
        ),
        fetchJson<H2hRow[]>(baseUrl, '/api/v1/stats/matchups'),
      ]);

      for (const [surface, rows] of [
        ['compare.headToHead', compare.headToHead],
        ['/stats/matchups', matchups],
      ] as const) {
        const persisted = rows.find((r) => r.gamesPlayed === 3);
        expect(
          persisted,
          `${surface} keeps the persisted pairing`,
        ).toBeDefined();
        // Canonical family keys, provider spelling preserved (lowercase
        // 'openai' stays lowercase).
        expect(persisted!.modelA).toBe(`openai/${BASE_MODEL}`);
        expect(persisted!.modelB).toBe('openai/gpt-4o-mini');
        // No dated-id series beside the canonical family.
        expect(JSON.stringify(rows)).not.toContain(ALIAS_MODEL);
      }
    });
  });
});
