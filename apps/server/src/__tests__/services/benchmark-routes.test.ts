/**
 * Benchmark runner route tests (MAF-GAP-011).
 *
 * Mounts the real benchmark router on an ephemeral Express app (listen(0))
 * and drives it with Node's built-in fetch — no live server, no child
 * processes, no LLM calls. The BenchmarkRunner is backed by the in-memory
 * SQLite fake repository, so runs can be seeded directly in the DB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createBenchmarkRouter } from '../../routes/benchmark.js';
import { BenchmarkRunner } from '../../services/benchmark-runner.js';
import { createSqliteBackedRepository, createFakeEventBus, createFakeStatsCollector, createFakeAgentCoordinator, createFakeLegacyGameAdapter } from './mocks.js';
import type { GameEngine } from '../../services/game-engine.js';

// Type alias matching the return shape of createSqliteBackedRepository().
type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

describe('Benchmark routes', () => {
  let repo: FakeRepo;
  let runner: BenchmarkRunner;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    runner = new BenchmarkRunner({
      gameEngine: {} as GameEngine,
      agentCoordinator: createFakeAgentCoordinator(),
      eventBus: createFakeEventBus(),
      statsCollector: createFakeStatsCollector(),
      gameRepository: repo as any,
      legacyAdapter: createFakeLegacyGameAdapter(),
    });

    const app = express();
    app.use(express.json());
    app.use('/', createBenchmarkRouter({ benchmarkRunner: runner } as any));

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

  // ==========================================================================
  // GET /api/v1/benchmark/runs
  // ==========================================================================

  describe('GET /api/v1/benchmark/runs', () => {
    it('returns the list of runs (empty when none exist)', async () => {
      const response = await fetch(`${baseUrl}/api/v1/benchmark/runs`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('returns seeded runs via listRuns()', async () => {
      repo.insertBenchmarkRun({
        id: 'run-1',
        config: { models: ['a', 'b'], gamesPerPairing: 1, numPlayers: 5, temperature: 0.7 },
        status: 'RUNNING',
      });
      repo.seedGame({ id: 'g1' });
      repo.insertBenchmarkGame({
        game_id: 'g1',
        run_id: 'run-1',
        pairing_id: 'a__vs__b',
        model_a: 'a',
        model_b: 'b',
        seed: 0,
        model_a_role: 'VILLAGER',
        model_b_role: 'VILLAGER',
      });

      const response = await fetch(`${baseUrl}/api/v1/benchmark/runs`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].runId).toBe('run-1');
      expect(body.data[0].status).toBe('RUNNING');
      expect(body.data[0].totalGames).toBe(1);
    });
  });

  // ==========================================================================
  // GET /api/v1/benchmark/:id
  // ==========================================================================

  describe('GET /api/v1/benchmark/:id', () => {
    it('returns status + progress for an existing run', async () => {
      repo.insertBenchmarkRun({
        id: 'run-1',
        config: { models: ['a', 'b'], gamesPerPairing: 1, numPlayers: 5, temperature: 0.7 },
        status: 'RUNNING',
      });
      repo.seedGame({ id: 'g1' });
      repo.insertBenchmarkGame({
        game_id: 'g1',
        run_id: 'run-1',
        pairing_id: 'a__vs__b',
        model_a: 'a',
        model_b: 'b',
        seed: 0,
        model_a_role: 'VILLAGER',
        model_b_role: 'VILLAGER',
      });

      const response = await fetch(`${baseUrl}/api/v1/benchmark/run-1`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.status.runId).toBe('run-1');
      expect(body.data.status.status).toBe('RUNNING');
      expect(body.data.progress.totalGames).toBe(1);
      expect(body.data.progress.completedGames).toBe(0);
    });

    it('returns 404 for an unknown run id', async () => {
      const response = await fetch(`${baseUrl}/api/v1/benchmark/nonexistent`);
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Run not found');
    });
  });

  // ==========================================================================
  // POST /api/v1/benchmark/:id/cancel
  // ==========================================================================

  describe('POST /api/v1/benchmark/:id/cancel', () => {
    it('cancels a RUNNING run', async () => {
      repo.insertBenchmarkRun({
        id: 'run-1',
        config: { models: ['a', 'b'], gamesPerPairing: 1, numPlayers: 5, temperature: 0.7 },
        status: 'RUNNING',
      });

      const response = await fetch(`${baseUrl}/api/v1/benchmark/run-1/cancel`, {
        method: 'POST',
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.runId).toBe('run-1');

      // The run is now CANCELLED.
      const status = runner.getStatus('run-1')!;
      expect(status.status).toBe('CANCELLED');
    });

    it('returns 404 for an unknown run id', async () => {
      const response = await fetch(`${baseUrl}/api/v1/benchmark/nonexistent/cancel`, {
        method: 'POST',
      });
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Run not found');
    });
  });
});
