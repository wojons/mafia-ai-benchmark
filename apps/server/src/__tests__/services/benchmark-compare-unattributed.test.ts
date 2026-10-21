/**
 * DF-MAFIA-AI-BENCHMARK-36 — /api/v1/benchmark/compare must apply the SAME
 * CUSTOM/* bucketing as /api/v1/benchmark/report.
 *
 * DF-33 (commit 736e69d) introduced the bucket but only wired it into the
 * report path: GET /api/v1/benchmark/report returned clean
 * modelPerformance (gpt-4o-mini 3708g, gpt-4o 90g) with the mis-key family
 * in `unattributedModels`, while GET /api/v1/benchmark/compare — same
 * minute, same store — still returned the ghost rows as FIRST-CLASS model
 * rows:
 *
 *   {"provider":"CUSTOM","model":"openai","gamesPlayed":208,"wins":0}
 *   {"provider":"CUSTOM","model":"qwen3.6-35b-fast","gamesPlayed":1}
 *
 * Both endpoints feed the same model leaderboard (the web dashboard's
 * BenchmarkLeaderboard renders compare.models), so disagreeing key sets is
 * a correctness bug, not cosmetics.
 *
 * Contract pinned here:
 *   1. compare.models carries NO CUSTOM-provider row (no ghost 'openai' /
 *      'qwen3.6-35b-fast' competitor entries).
 *   2. report.modelPerformance and compare.models produce the SAME
 *      model-row key set on the same store.
 *   3. The mis-key family lands in compare.unattributedModels with the
 *      same keys and aggregates as the report's bucket (same row shape as
 *      compare.models plus `key`); the field is always present.
 *   4. Ghost trend series and ghost head-to-head pairings stay off the
 *      compare surface.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createBenchmarkRouter } from '../../routes/benchmark.js';
import { StatsCollector } from '../../services/stats-collector.js';
import { getModelComparison } from '../../services/stats-collector/models.js';
import { createSqliteBackedRepository } from './mocks.js';

// Type alias matching the return shape of createSqliteBackedRepository().
type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

type ModelRow = { provider: string; model: string; gamesPlayed: number; wins: number };

const rowKey = (row: { provider: string; model: string }): string =>
  `${row.provider}/${row.model}`;

describe('DF-MAFIA-AI-BENCHMARK-36 — compare/report CUSTOM bucket parity', () => {
  let repo: FakeRepo;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    seedFixtures(repo);

    const statsCollector = new StatsCollector(repo as never);
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createBenchmarkRouter({
        benchmarkRunner: {} as never, // these routes never touch the runner
        statsCollector,
      } as never),
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    repo.db.close();
  });

  async function fetchData(path: string): Promise<any> {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    return body.data;
  }

  it('compare.models carries no CUSTOM-provider ghost rows', async () => {
    const data = await fetchData('/api/v1/benchmark/compare');
    const rows = data.models as ModelRow[];

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    // AC 1: no CUSTOM row survives in the main table (case-insensitive).
    expect(rows.every((r) => r.provider.toUpperCase() !== 'CUSTOM')).toBe(true);
    // The exact live ghost shapes must be gone, under any spelling.
    expect(rows.map(rowKey)).not.toContain('CUSTOM/openai');
    expect(rows.map(rowKey)).not.toContain('CUSTOM/qwen3.6-35b-fast');
    // The legacy player ghost named a MODEL that must not render beside
    // real competitors, and the cost ghost named the PROVIDER in the model
    // column — neither may appear as a row.
    expect(rows.some((r) => r.model === 'qwen3.6-35b-fast')).toBe(false);
    expect(rows.some((r) => r.model === 'openai')).toBe(false);
  });

  it('report.modelPerformance and compare.models agree exactly on the model-row key set', async () => {
    // Both surfaces read the SAME store through the SAME StatsCollector —
    // this is the invariant DF-36 was filed for (AC 2/AC 3).
    const [report, compare] = await Promise.all([
      fetchData('/api/v1/benchmark/report'),
      fetchData('/api/v1/benchmark/compare'),
    ]);

    const reportKeys = (report.modelPerformance as ModelRow[]).map(rowKey).sort();
    const compareKeys = (compare.models as ModelRow[]).map(rowKey).sort();

    expect(compareKeys).toEqual(reportKeys);

    // Non-vacuous: the agreed set carries the real models (a test that
    // passed on two empty lists would prove nothing).
    expect(reportKeys).toContain('openai/gpt-4o-mini');
    expect(reportKeys).toContain('openai/gpt-4o');
    expect(reportKeys).not.toContain('CUSTOM/openai');
    expect(reportKeys).not.toContain('CUSTOM/qwen3.6-35b-fast');
  });

  it('routes the mis-key family to compare.unattributedModels with the report bucket aggregates', async () => {
    const [report, compare] = await Promise.all([
      fetchData('/api/v1/benchmark/report'),
      fetchData('/api/v1/benchmark/compare'),
    ]);

    const compareBucket = compare.unattributedModels as Array<
      ModelRow & { key: string; avgTokensPerGame: number }
    >;
    const reportBucket = report.unattributedModels as Array<
      ModelRow & { key: string; avgTokens: number }
    >;

    // AC 1: the field exists and both endpoints bucket the SAME keys.
    expect(Array.isArray(compareBucket)).toBe(true);
    expect(compareBucket.map((r) => r.key).sort()).toEqual(
      reportBucket.map((r) => r.key).sort(),
    );

    // Same rows, same aggregates — the bucket is a re-shape, not a recount.
    const reportByKey = new Map(reportBucket.map((r) => [r.key, r]));
    for (const row of compareBucket) {
      expect(row.key).toBe(`${row.provider}/${row.model}`);
      const twin = reportByKey.get(row.key);
      expect(twin).toBeDefined();
      expect(row.gamesPlayed).toBe(twin!.gamesPlayed);
      expect(row.wins).toBe(twin!.wins);
      expect(row.avgTokensPerGame).toBe(Math.round(twin!.avgTokens));
    }

    // The exact historical ghost shapes, with their real aggregates.
    expect(
      compareBucket.find((r) => r.key === 'CUSTOM/openai')?.gamesPlayed,
    ).toBe(2);
    expect(
      compareBucket.find((r) => r.key === 'CUSTOM/qwen3.6-35b-fast')?.gamesPlayed,
    ).toBe(1);
  });

  it('keeps ghost trend series and ghost matchups off the compare surface', async () => {
    // A real pairing and a ghost pairing (the legacy cost-tracker could
    // record both — model_matchups has no provider normalisation).
    const insertMatchup = repo.db.prepare(`
      INSERT INTO model_matchups
        (id, model_a_provider, model_a, model_b_provider, model_b,
         games_played, model_a_wins, model_b_wins, ties)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertMatchup.run(
      'mu-real', 'openai', 'gpt-4o-mini', 'openai', 'gpt-4o', 10, 6, 4, 0,
    );
    insertMatchup.run(
      'mu-ghost', 'CUSTOM', 'openai', 'openai', 'gpt-4o-mini', 5, 1, 4, 0,
    );

    const data = await fetchData('/api/v1/benchmark/compare');

    const trendKeys = (data.trends as Array<{ model: string }>).map((t) => t.model);
    expect(trendKeys).not.toContain('CUSTOM/qwen3.6-35b-fast');
    expect(trendKeys.every((k) => !k.toUpperCase().startsWith('CUSTOM/'))).toBe(true);

    const h2h = data.headToHead as Array<{ modelA: string; modelB: string }>;
    expect(h2h.map((r) => `${r.modelA}|${r.modelB}`)).not.toContain(
      'CUSTOM/openai|openai/gpt-4o-mini',
    );
    // The real pairing survives — the filter is scoped to the ghost family.
    expect(h2h.map((r) => `${r.modelA}|${r.modelB}`)).toContain(
      'openai/gpt-4o-mini|openai/gpt-4o',
    );
  });

  it('keeps the model-row key set identical when the store holds MORE than 10 real models (DF-36b)', async () => {
    // DF-MAFIA-AI-BENCHMARK-36b: bucketing alone was not enough for the
    // invariant — the report slices modelPerformance to 10 rows while
    // compare.models was unbounded, so any store with >10 real models
    // returned two different leaderboards (judge verdict 3f3d0402).
    // Seed 14 real models (distinct games-played so the ranking is
    // deterministic) plus both CUSTOM /* ghost families, then require the
    // SAME key set from both endpoints.
    const wideRepo = createSqliteBackedRepository() as unknown as FakeRepo;

    const REAL_MODEL_COUNT = 14;
    const realKeys: string[] = [];
    // Model i plays in games 0..i — model 13 plays 14 games, model 0 one.
    for (let gameIndex = 0; gameIndex < REAL_MODEL_COUNT; gameIndex++) {
      const players = [];
      for (let modelIndex = gameIndex; modelIndex < REAL_MODEL_COUNT; modelIndex++) {
        const model = `bench-model-${String(modelIndex).padStart(2, '0')}`;
        if (gameIndex === modelIndex) realKeys.push(`openai/${model}`);
        players.push({
          id: `p-${gameIndex}-${modelIndex}`,
          name: `player-${gameIndex}-${modelIndex}`,
          role: 'VILLAGER',
          isMafia: false,
          won: 1,
          joinOrder: modelIndex,
          provider: 'openai',
          model,
        });
      }
      wideRepo.seedGame({
        id: `wide-${gameIndex}`,
        status: 'ENDED',
        winner: 'TOWN',
        players,
      });
    }

    // Both DF-33 ghost families must still be bucketed, not ranked.
    wideRepo.seedGame({ id: 'wide-ghost-1', status: 'ENDED', winner: 'TOWN' });
    wideRepo.insertTokenUsage({
      gameId: 'wide-ghost-1', playerId: 'ALL', turnNumber: 0,
      provider: 'CUSTOM', model: 'openai',
      promptTokens: 500, completionTokens: 500, totalTokens: 1000, cost: 0.10,
    });
    wideRepo.seedGame({
      id: 'wide-ghost-2',
      status: 'ENDED',
      winner: 'TOWN',
      players: [
        {
          id: 'p-ghost', name: 'legacy-ghost', role: 'VILLAGER',
          isMafia: false, won: 1, joinOrder: 0,
          provider: 'CUSTOM', model: 'qwen3.6-35b-fast',
        },
      ],
    });

    // Non-vacuity: the fixture really does carry more than 10 real models
    // (asserted on the source both endpoints derive from, so the parity
    // assertion below cannot pass by both lists being short).
    const sourceRows = getModelComparison(wideRepo as never);
    const sourceRealKeys = sourceRows
      .map(rowKey)
      .filter((key) => !key.toUpperCase().startsWith('CUSTOM/'));
    expect(sourceRealKeys.length).toBe(REAL_MODEL_COUNT);
    expect(realKeys.length).toBe(REAL_MODEL_COUNT);

    const wideCollector = new StatsCollector(wideRepo as never);
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createBenchmarkRouter({
        benchmarkRunner: {} as never,
        statsCollector: wideCollector,
      } as never),
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as { port: number };
    const wideBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const fetchWide = async (path: string): Promise<any> => {
        const response = await fetch(`${wideBaseUrl}${path}`);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        return body.data;
      };

      const [report, compare] = await Promise.all([
        fetchWide('/api/v1/benchmark/report'),
        fetchWide('/api/v1/benchmark/compare'),
      ]);

      const reportKeys = (report.modelPerformance as ModelRow[]).map(rowKey).sort();
      const compareKeys = (compare.models as ModelRow[]).map(rowKey).sort();

      // The invariant DF-36b was filed for.
      expect(compareKeys).toEqual(reportKeys);
      // Same count, capped by the same leaderboard limit — not two
      // differently-truncated rankings.
      expect(compareKeys.length).toBe(reportKeys.length);
      expect(compareKeys.length).toBeLessThanOrEqual(10);
      expect(compareKeys.length).toBeGreaterThan(0);

      // Ghosts still bucketed on both surfaces.
      expect(compareKeys).not.toContain('CUSTOM/openai');
      expect(compareKeys).not.toContain('CUSTOM/qwen3.6-35b-fast');
      const compareBucketKeys = (
        compare.unattributedModels as Array<{ key: string }>
      ).map((r) => r.key).sort();
      const reportBucketKeys = (
        report.unattributedModels as Array<{ key: string }>
      ).map((r) => r.key).sort();
      expect(compareBucketKeys).toEqual(reportBucketKeys);
      expect(compareBucketKeys).toEqual([
        'CUSTOM/openai',
        'CUSTOM/qwen3.6-35b-fast',
      ]);

      // The per-model trend series describe the SAME retained rows — a
      // capped-away model must not still be plotted next to the leaderboard.
      const trendKeys = (compare.trends as Array<{ model: string }>)
        .map((t) => t.model)
        .sort();
      expect(trendKeys).toEqual(compareKeys);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      wideRepo.db.close();
      server = undefined as unknown as Server;
    }
  });

  it('keeps compare.unattributedModels present (empty array) when no mis-key rows exist', async () => {
    const cleanRepo = createSqliteBackedRepository() as unknown as FakeRepo;
    cleanRepo.seedGame({
      id: 'clean-1',
      status: 'ENDED',
      winner: 'TOWN',
      players: [
        {
          id: 'cp1',
          name: 'Clean',
          role: 'VILLAGER',
          joinOrder: 0,
          provider: 'openai',
          model: 'gpt-4o-mini',
          won: 1,
        },
      ],
    });
    const statsCollector = new StatsCollector(cleanRepo as never);
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createBenchmarkRouter({
        benchmarkRunner: {} as never,
        statsCollector,
      } as never),
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as { port: number };
    const cleanBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${cleanBaseUrl}/api/v1/benchmark/compare`);
      const body = await response.json();
      expect(body.success).toBe(true);
      // Stable response shape: the bucket is always present.
      expect(body.data.unattributedModels).toEqual([]);
      expect(
        body.data.models.some((r: ModelRow) => r.model === 'gpt-4o-mini'),
      ).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      cleanRepo.db.close();
      // Restore the outer afterEach's expectation of a live `server`.
      server = undefined as unknown as Server;
    }
  });
});

/**
 * Seed the live shapes DF-36 was filed against: two real models plus the
 * two DF-33 mis-key ghost families (token_usage 'CUSTOM/openai' and the
 * players-table 'CUSTOM/qwen3.6-35b-fast').
 */
function seedFixtures(repo: FakeRepo): void {
  // Real model, plain spelling.
  repo.seedGame({
    id: 'g-mini',
    status: 'ENDED',
    winner: 'TOWN',
    players: [
      {
        id: 'pMini',
        name: 'town-mini',
        role: 'VILLAGER',
        isMafia: false,
        won: 1,
        joinOrder: 0,
        provider: 'openai',
        model: 'gpt-4o-mini',
      },
    ],
  });

  // Real model whose legacy spelling hides behind the passthrough —
  // MAF-GAP-045 normalization re-keys it and it must STAY in the table.
  repo.seedGame({
    id: 'g-real-prefixed',
    status: 'ENDED',
    winner: 'MAFIA',
    players: [
      {
        id: 'pReal',
        name: 'mafia-4o',
        role: 'MAFIA',
        isMafia: true,
        won: 1,
        joinOrder: 0,
        provider: 'CUSTOM',
        model: 'openai/gpt-4o',
      },
    ],
  });
  repo.insertTokenUsage({
    gameId: 'g-real-prefixed', playerId: 'pReal', turnNumber: 1,
    provider: 'CUSTOM', model: 'openai/gpt-4o',
    promptTokens: 300, completionTokens: 300, totalTokens: 600, cost: 0.06,
  });

  // DF-33 ghost family, token_usage source: the legacy cost-tracker put
  // the PROVIDER in the model column ('CUSTOM/openai'), two ended games.
  repo.seedGame({ id: 'g-miskey-1', status: 'ENDED', winner: 'TOWN' });
  repo.seedGame({ id: 'g-miskey-2', status: 'ENDED', winner: 'MAFIA' });
  repo.insertTokenUsage({
    gameId: 'g-miskey-1', playerId: 'ALL', turnNumber: 0,
    provider: 'CUSTOM', model: 'openai',
    promptTokens: 500, completionTokens: 500, totalTokens: 1000, cost: 0.10,
  });
  repo.insertTokenUsage({
    gameId: 'g-miskey-2', playerId: 'ALL', turnNumber: 0,
    provider: 'CUSTOM', model: 'openai',
    promptTokens: 1500, completionTokens: 1500, totalTokens: 3000, cost: 0.30,
  });

  // DF-33 ghost family, players-table source: bare legacy model name.
  repo.seedGame({
    id: 'g-qwen',
    status: 'ENDED',
    winner: 'TOWN',
    players: [
      {
        id: 'pQwen',
        name: 'legacy-qwen',
        role: 'VILLAGER',
        isMafia: false,
        won: 1,
        joinOrder: 0,
        provider: 'CUSTOM',
        model: 'qwen3.6-35b-fast',
      },
    ],
  });
}
