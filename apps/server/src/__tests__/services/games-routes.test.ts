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
 * Per-game statuses (legacy vocabulary: RUNNING/ENDED) can be supplied via
 * the optional second argument; games without an entry default to ENDED.
 */
function createLegacyAdapterWithGames(
  gameIds: string[],
  statuses?: Record<string, 'RUNNING' | 'ENDED'>,
): LegacyGameAdapter {
  const startedAt = new Date();
  return {
    getActiveGames: () => gameIds,
    getGameState: (gameId: string) =>
      gameIds.includes(gameId)
        ? { gameId, status: statuses?.[gameId] ?? 'ENDED', startedAt, players: [] }
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

/**
 * MAF-GAP-049: status filter validation + application to legacy games.
 *
 * Seeds DB games in mixed statuses and a fake legacy adapter with mixed
 * RUNNING/ENDED states to prove the merged response honors ?status=N and
 * rejects unknown values with 400 (previously any string passed through the
 * unvalidated cast and legacy rows were appended unfiltered).
 */
describe('GET /api/v1/games status filter', () => {
  let repo: FakeRepo;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    // Seed 3 DB games in mixed statuses (created_at DESC ordering: g3, g2, g1)
    repo.seedGame({ id: 'g1', status: 'ENDED' });
    repo.seedGame({ id: 'g2', status: 'IN_PROGRESS' });
    repo.seedGame({ id: 'g3', status: 'SETUP' });

    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createGamesRouter(
        { gameEngine: {}, gameRepository: repo, eventBus: createFakeEventBus() } as any,
        // legacy-1 is RUNNING (maps to IN_PROGRESS), legacy-2 is ENDED
        createLegacyAdapterWithGames(['legacy-1', 'legacy-2'], { 'legacy-1': 'RUNNING' }),
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

  it('returns only IN_PROGRESS rows across DB and legacy games', async () => {
    const response = await fetch(`${baseUrl}/api/v1/games?status=IN_PROGRESS`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    // g2 (DB IN_PROGRESS) + legacy-1 (RUNNING → IN_PROGRESS); g1/g3 (DB) and
    // the ENDED legacy-2 must be excluded from the merged result.
    expect(body.data).toHaveLength(2);
    const ids = body.data.map((g: { id: string }) => g.id).sort();
    expect(ids).toEqual(['g2', 'legacy-1']);
    for (const game of body.data) {
      expect(game.status).toBe('IN_PROGRESS');
    }
  });

  it('excludes non-matching legacy games when filtering by ENDED', async () => {
    const response = await fetch(`${baseUrl}/api/v1/games?status=ENDED`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    // g1 (DB ENDED) + legacy-2 (ENDED); the RUNNING legacy-1 must NOT leak
    // through the filter.
    expect(body.data).toHaveLength(2);
    const ids = body.data.map((g: { id: string }) => g.id).sort();
    expect(ids).toEqual(['g1', 'legacy-2']);
    for (const game of body.data) {
      expect(game.status).toBe('ENDED');
    }
  });

  it('rejects an invalid status value with 400', async () => {
    const response = await fetch(`${baseUrl}/api/v1/games?status=bogus`);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid status filter');
  });

  it('accepts every canonical status value (SETUP/IN_PROGRESS/PAUSED/ENDED/CANCELLED)', async () => {
    for (const status of ['SETUP', 'IN_PROGRESS', 'PAUSED', 'ENDED', 'CANCELLED']) {
      const response = await fetch(`${baseUrl}/api/v1/games?status=${status}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      for (const game of body.data) {
        expect(game.status).toBe(status);
      }
    }
  });
});
