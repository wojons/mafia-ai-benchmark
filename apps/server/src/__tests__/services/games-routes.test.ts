/**
 * Game routes — GET /api/v1/games limit enforcement (MAF-GAP-013).
 *
 * Mounts the real games router on an ephemeral Express app (listen(0)) and
 * drives it with Node's built-in fetch. The repository honors limit only for
 * DB rows; legacy games are appended after, so the route must slice the
 * merged result. These tests seed both DB games and a fake legacy adapter
 * with active games to prove the merged response honors ?limit=N.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createGamesRouter } from '../../routes/games.js';
import { createSqliteBackedRepository, createFakeEventBus } from './mocks.js';
import type { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';

type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

/**
 * Minimal fake legacy adapter that reports active games with real state, so
 * the merged DB + legacy list path in GET /api/v1/games is exercised.
 */
function createLegacyAdapterWithGames(gameIds: string[]): LegacyGameAdapter {
  const startedAt = new Date();
  return {
    getActiveGames: () => gameIds,
    getGameState: (gameId: string) =>
      gameIds.includes(gameId)
        ? { gameId, status: 'ENDED', startedAt, players: [] }
        : undefined,
  } as unknown as LegacyGameAdapter;
}

describe('GET /api/v1/games limit enforcement', () => {
  let repo: FakeRepo;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    // Seed 3 DB games (created_at DESC ordering: g3, g2, g1)
    repo.seedGame({ id: 'g1', status: 'ENDED' });
    repo.seedGame({ id: 'g2', status: 'ENDED' });
    repo.seedGame({ id: 'g3', status: 'ENDED' });

    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createGamesRouter(
        { gameEngine: {}, gameRepository: repo, eventBus: createFakeEventBus() } as any,
        createLegacyAdapterWithGames(['legacy-1', 'legacy-2']),
      ),
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

  it('returns exactly N items and count == returned length when ?limit=N', async () => {
    const response = await fetch(`${baseUrl}/api/v1/games?limit=2`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.count).toBe(2);
  });

  it('enforces limit on the MERGED result (DB + legacy games)', async () => {
    // 3 DB games + 2 legacy games = 5 total; limit=2 must slice the merged
    // array, not just the DB rows.
    const response = await fetch(`${baseUrl}/api/v1/games?limit=2`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.count).toBe(2);
  });

  it('returns all games when no limit is given (default 50)', async () => {
    const response = await fetch(`${baseUrl}/api/v1/games`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(5);
    expect(body.count).toBe(5);
  });

  it('returns fewer than N items when fewer exist', async () => {
    const response = await fetch(`${baseUrl}/api/v1/games?limit=100`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(5);
    expect(body.count).toBe(5);
  });
});
