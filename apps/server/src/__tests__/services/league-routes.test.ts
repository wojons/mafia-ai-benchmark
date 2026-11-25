/**
 * League route tests (MAF-LAYER-3).
 *
 * Mounts the real league router on an ephemeral Express app (listen(0)) and
 * drives it with Node's built-in fetch — same pattern as
 * benchmark-routes.test.ts. The LeagueRunner is backed by the in-memory
 * SQLite fake repository and a fake LegacyGameAdapter; tests publish
 * terminal events to play games through the mock path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createLeagueRouter } from '../../routes/league.js';
import { LeagueRunner } from '../../services/league-runner.js';
import {
  createSqliteBackedRepository,
  createFakeEventBus,
  createFakeLegacyGameAdapter,
  type FakeLegacyGameAdapter,
} from './mocks';
import type { GameEvent } from '@mafia/shared/events';

type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

function terminalEvent(gameId: string, winner: string): GameEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 10)}`,
    gameId,
    type: 'GAME_ENDED',
    timestamp: new Date(),
    visibility: 'PUBLIC',
    data: { winner },
    metadata: { turnNumber: 1, dayNumber: 1, phase: 'GAME_OVER', sequence: 1 },
  };
}

describe('League routes', () => {
  let repo: FakeRepo;
  let eventBus: ReturnType<typeof createFakeEventBus>;
  let adapter: FakeLegacyGameAdapter;
  let runner: LeagueRunner;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    eventBus = createFakeEventBus();
    adapter = createFakeLegacyGameAdapter(repo as never);
    runner = new LeagueRunner({
      eventBus,
      gameRepository: repo as never,
      legacyAdapter: adapter,
    });

    const app = express();
    app.use(express.json());
    app.use('/', createLeagueRouter({ leagueRunner: runner } as never));

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
  // POST /api/v1/league
  // ==========================================================================

  describe('POST /api/v1/league', () => {
    it('creates a league run and returns the run contract (201)', async () => {
      const response = await fetch(`${baseUrl}/api/v1/league`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
            games: 2,
            numPlayers: 5,
            budgetUsd: 5,
            seatSeed: 123,
          },
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.leagueId).toBeTruthy();
      expect(body.data.games).toBe(2);
      expect(body.data.models).toEqual(['openai/gpt-4o-mini', 'openai/gpt-4o']);
      expect(body.data.seatGroups).toEqual(['MAFIA', 'SHERIFF', 'DOCTOR', 'VILLAGER']);
      expect(body.data.message).toContain('League started');

      // The run row + the first game exist (round 1 armed synchronously).
      const status = runner.getStatus(body.data.leagueId);
      expect(status).not.toBeNull();
      expect(adapter.started).toHaveLength(1);
    });

    it('surfaces an invalid config as 400 with the validation reason', async () => {
      const response = await fetch(`${baseUrl}/api/v1/league`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { models: ['only-one'], budgetUsd: 1 } }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('at least 2 models');
    });

    it('surfaces a missing budget cap as 400', async () => {
      const response = await fetch(`${baseUrl}/api/v1/league`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { models: ['a', 'b'] } }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('budgetUsd');
    });
  });

  // ==========================================================================
  // GET /api/v1/league
  // ==========================================================================

  describe('GET /api/v1/league', () => {
    it('lists league runs (empty when none exist)', async () => {
      const response = await fetch(`${baseUrl}/api/v1/league`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('lists created league runs most recent first', async () => {
      await fetch(`${baseUrl}/api/v1/league`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { models: ['a', 'b'], budgetUsd: 10, seatSeed: 1 } }),
      });
      const second = await fetch(`${baseUrl}/api/v1/league`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { models: ['a', 'b'], budgetUsd: 10, seatSeed: 2 } }),
      });
      const secondBody = await second.json();

      const response = await fetch(`${baseUrl}/api/v1/league`);
      const body = await response.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0].leagueId).toBe(secondBody.data.leagueId);
      expect(body.data[0].status).toBe('RUNNING');
    });
  });

  // ==========================================================================
  // GET /api/v1/league/:id
  // ==========================================================================

  describe('GET /api/v1/league/:id', () => {
    it('returns 404 for an unknown league id', async () => {
      const response = await fetch(`${baseUrl}/api/v1/league/unknown-id`);
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('not found');
    });

    it('serves the league contract: status, spend/cap state, per-game provenance', async () => {
      const start = await fetch(`${baseUrl}/api/v1/league`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
            games: 1,
            numPlayers: 5,
            budgetUsd: 2,
            seatSeed: 55,
          },
        }),
      });
      const { data: startData } = await start.json();

      // Play the single round through the mock path and record usage.
      eventBus.publish(terminalEvent(adapter.started[0].gameId, 'MAFIA'));
      repo.insertTokenUsage({
        gameId: adapter.started[0].gameId,
        playerId: 'p-all',
        turnNumber: 0,
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        cost: 0.25,
      });
      // Let the loop terminalize.
      await new Promise((r) => setTimeout(r, 30));

      const response = await fetch(`${baseUrl}/api/v1/league/${startData.leagueId}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);

      const detail = body.data;
      expect(detail.status.leagueId).toBe(startData.leagueId);
      expect(detail.status.status).toBe('COMPLETED');
      expect(detail.status.config).toMatchObject({
        models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
        games: 1,
        numPlayers: 5,
        budgetUsd: 2,
        seatSeed: 55,
      });

      // Per-game provenance: seat map + outcome + per-game spend.
      expect(detail.games).toHaveLength(1);
      const game = detail.games[0];
      expect(game.gameId).toBe(adapter.started[0].gameId);
      expect(game.round).toBe(1);
      expect(game.winner).toBe('MAFIA');
      expect(Object.keys(game.seatMap).sort()).toEqual(
        ['DOCTOR', 'MAFIA', 'SHERIFF', 'VILLAGER'],
      );
      for (const model of Object.values(game.seatMap)) {
        expect(['openai/gpt-4o-mini', 'openai/gpt-4o']).toContain(model);
      }
      expect(game.costUsd).toBe(0.25);
      expect(game.totalTokens).toBe(1500);

      // Spend + cap state.
      expect(detail.spend).toEqual({
        spentUsd: 0.25,
        budgetUsd: 2,
        remainingUsd: 1.75,
        capped: false,
      });
    });

    it('surfaces BUDGET_CAPPED league state through the API', async () => {
      const start = await fetch(`${baseUrl}/api/v1/league`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            models: ['openai/a', 'openai/b'],
            games: 4,
            numPlayers: 5,
            budgetUsd: 0.1,
            seatSeed: 9,
          },
        }),
      });
      const { data: startData } = await start.json();

      eventBus.publish(terminalEvent(adapter.started[0].gameId, 'MAFIA'));
      repo.insertTokenUsage({
        gameId: adapter.started[0].gameId,
        playerId: 'p-all',
        turnNumber: 0,
        provider: 'openai',
        model: 'a',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        cost: 0.5,
      });
      await new Promise((r) => setTimeout(r, 30));

      const response = await fetch(`${baseUrl}/api/v1/league/${startData.leagueId}`);
      const body = await response.json();
      expect(body.data.status.status).toBe('BUDGET_CAPPED');
      expect(body.data.spend.capped).toBe(true);
      expect(body.data.spend.remainingUsd).toBe(-0.4);
      // Exactly one game was created: nothing starts after the cap.
      expect(body.data.games).toHaveLength(1);
      expect(adapter.started).toHaveLength(1);
    });
  });
});
