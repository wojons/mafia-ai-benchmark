/**
 * Benchmark report population contract (DF-MAFIA-AI-BENCHMARK-41-R2).
 *
 * ch:trace row=DF-MAFIA-AI-BENCHMARK-41-R2 spec=none:benchmark-population test=focused-server-population-identity doc=none:not-needed evidence=worker-test-output
 *
 * The fixture is an isolated in-memory SQLite repository mounted on an
 * ephemeral Express server. It never contacts or writes the live :3004 store.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createBenchmarkRouter } from '../../routes/benchmark.js';
import { StatsCollector } from '../../services/stats-collector.js';
import { createSqliteBackedRepository } from './mocks.js';

type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

type BenchmarkData = {
  summary: {
    totalGames: number;
    activeGames: number;
    inProgress: number;
    completedGames: number;
    mockGames: number;
    population: {
      totalGames: number;
      completedGames: number;
      mockGames: number;
      inProgress: number;
      failedGames: number;
      cancelledGames: number;
    };
    failedGames: number;
    cancelledGames: number;
  };
  mockGames?: number;
};

describe('GET /api/v1/benchmark/report — population declaration (DF-MAFIA-AI-BENCHMARK-41-R2)', () => {
  let repo: FakeRepo;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;

    repo.seedGame({
      id: 'population-completed',
      status: 'ENDED',
      winner: 'TOWN',
      duration: 120_000,
      players: [{
        id: 'population-completed-player',
        name: 'completed-player',
        role: 'VILLAGER',
        isMafia: false,
        won: 1,
        joinOrder: 0,
        provider: 'openai',
        model: 'gpt-4o-mini',
      }],
    });
    repo.seedGame({
      id: 'population-mock',
      status: 'ENDED',
      winner: 'MAFIA',
      duration: 9_000,
    });
    repo.db.prepare(
      "UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?",
    ).run('population-mock');
    repo.seedGame({
      id: 'population-in-progress',
      status: 'IN_PROGRESS',
      startedAt: Date.now(),
    });
    repo.seedGame({
      id: 'population-cancelled',
      status: 'CANCELLED',
    });
    repo.seedGame({
      id: 'population-failed',
      status: 'FAILED',
    });

    const statsCollector = new StatsCollector(repo as any);
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
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    repo.db.close();
  });

  async function fetchData(path: string): Promise<BenchmarkData> {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    return body.data as BenchmarkData;
  }

  it('publishes non-vacuous population buckets that reconcile exactly', async () => {
    const report = await fetchData('/api/v1/benchmark/report');
    const { summary } = report;

    // Prove the fixture exercises every population bucket before checking the
    // identity; an all-zero or empty fixture must not be able to pass.
    expect(summary.totalGames).toBe(5);
    expect(summary.completedGames).toBeGreaterThan(0);
    expect(summary.mockGames).toBeGreaterThan(0);
    expect(summary.inProgress).toBeGreaterThan(0);
    expect(summary.cancelledGames).toBeGreaterThan(0);
    expect(summary.failedGames).toBeGreaterThan(0);
    expect(summary.population).toEqual({
      totalGames: 5,
      completedGames: summary.completedGames,
      mockGames: summary.mockGames,
      inProgress: summary.inProgress,
      failedGames: summary.failedGames,
      cancelledGames: summary.cancelledGames,
    });

    expect(summary.inProgress).toBe(summary.activeGames);
    expect(summary.totalGames).toBe(
      summary.completedGames +
        summary.mockGames +
        summary.inProgress +
        summary.failedGames +
        summary.cancelledGames,
    );
  });

  it('matches compare.mockGames using the same repository derivation', async () => {
    const [report, compare] = await Promise.all([
      fetchData('/api/v1/benchmark/report'),
      fetchData('/api/v1/benchmark/compare'),
    ]);

    expect(report.mockGames).toBeUndefined();
    expect(compare.mockGames).toBe(1);
    expect(report.summary.mockGames).toBe(compare.mockGames);
  });
});
