/**
 * GET /api/v1/benchmark/report response envelope (DF-MAFIA-AI-BENCHMARK-5).
 *
 * Sub-task B: the stats endpoint answers { success, data } while
 * /benchmark/report answered with the bare top-level report object
 * ({ generatedAt, summary, modelPerformance, ... }). This contract pins the
 * standard envelope: every existing field stays available under .data
 * (ADDITIVE — nothing is removed or renamed).
 *
 * Uses a REAL StatsCollector over the in-memory SQLite repo mounted on an
 * ephemeral Express app — same pattern as benchmark-report-contract.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createBenchmarkRouter } from '../../routes/benchmark.js';
import { StatsCollector } from '../../services/stats-collector.js';
import { createSqliteBackedRepository } from './mocks.js';

type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

describe('GET /api/v1/benchmark/report — { success, data } envelope (DF-MAFIA-AI-BENCHMARK-5)', () => {
  let repo: FakeRepo;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    repo.seedGame({
      id: 'g1',
      status: 'ENDED',
      winner: 'TOWN',
      players: [
        {
          id: 'p1',
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

    const statsCollector = new StatsCollector(repo as any);
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createBenchmarkRouter({
        benchmarkRunner: {} as any,
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

  it('wraps the report in { success: true, data: <report> }', async () => {
    const response = await fetch(`${baseUrl}/api/v1/benchmark/report`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      success: boolean;
      data: Record<string, unknown>;
    };
    expect(body.success).toBe(true);
    expect(typeof body.data).toBe('object');
    expect(body.data).not.toBeNull();
  });

  it('keeps every existing report field available under .data (additive)', async () => {
    const response = await fetch(`${baseUrl}/api/v1/benchmark/report`);
    const body = await response.json();

    // The pre-envelope top-level contract fields must now live under .data.
    expect(body.data.generatedAt).toBeDefined();
    expect(body.data.summary).toBeDefined();
    expect(body.data.summary.totalGames).toBe(1);
    expect(Array.isArray(body.data.modelPerformance)).toBe(true);
    expect(Array.isArray(body.data.agentStats)).toBe(true);
    expect(Array.isArray(body.data.recommendations)).toBe(true);
  });

  it('no longer exposes the report fields at the top level (envelope only)', async () => {
    const response = await fetch(`${baseUrl}/api/v1/benchmark/report`);
    const body = await response.json();

    expect(body.generatedAt).toBeUndefined();
    expect(body.summary).toBeUndefined();
    expect(body.modelPerformance).toBeUndefined();
  });

  it('keeps the ?gameId variant inside the same envelope', async () => {
    const response = await fetch(`${baseUrl}/api/v1/benchmark/report?gameId=g1`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      success: boolean;
      data: { game?: { players: unknown[]; winner: string } };
    };
    expect(body.success).toBe(true);
    expect(body.data.game).toBeDefined();
    expect(Array.isArray(body.data.game.players)).toBe(true);
    expect(body.data.game.winner).toBe('TOWN');
  });
});