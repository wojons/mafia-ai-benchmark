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

/**
 * MAF-GAP-044: eliminations must be visible in the API. The detail route
 * previously served hardcoded currentState (phase SETUP, eliminatedPlayers
 * []) and players-table rows persisted at ROLES_ASSIGNED time (is_alive = 1
 * for everyone), so lynched/night-killed players looked alive.
 *
 * Seeds an ENDED game with a full death-event stream (2 mafia + 4 town;
 * night kills via MORNING_REVEAL, a lynch via PLAYER_LYNCHED) and proves
 * the detail endpoint now derives: GAME_OVER phase on ENDED, per-death
 * elimination events matching GAME_ENDED mafiaAlive/townAlive, and
 * isAlive=false + eliminatedPlayers for every dead player.
 */
describe('GET /api/v1/games/:gameId elimination state (MAF-GAP-044)', () => {
  let repo: FakeRepo;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    // p2 (mafia) killed night 1, p4 (sheriff) lynched day 2, p1 (mafia)
    // killed night 3 → TOWN wins with 0 mafia alive, 4 town alive.
    repo.seedGame({
      id: 'g-elim',
      status: 'ENDED',
      winner: 'TOWN',
      players: [
        { id: 'p1', name: 'Alice', role: 'MAFIA', isMafia: true, joinOrder: 0 },
        { id: 'p2', name: 'Bob', role: 'MAFIA', isMafia: true, joinOrder: 1 },
        { id: 'p3', name: 'Cara', role: 'DOCTOR', isMafia: false, joinOrder: 2 },
        { id: 'p4', name: 'Dana', role: 'SHERIFF', isMafia: false, joinOrder: 3 },
        { id: 'p5', name: 'Eli', role: 'VILLAGER', isMafia: false, joinOrder: 4 },
        { id: 'p6', name: 'Fay', role: 'VILLAGER', isMafia: false, joinOrder: 5 },
      ],
      events: [
        {
          type: 'ROLES_ASSIGNED',
          data: {
            assignments: [
              { playerId: 'p1', role: 'MAFIA', name: 'Alice' },
              { playerId: 'p2', role: 'MAFIA', name: 'Bob' },
              { playerId: 'p3', role: 'DOCTOR', name: 'Cara' },
              { playerId: 'p4', role: 'SHERIFF', name: 'Dana' },
              { playerId: 'p5', role: 'VILLAGER', name: 'Eli' },
              { playerId: 'p6', role: 'VILLAGER', name: 'Fay' },
            ],
          },
          phase: 'SETUP',
        },
        {
          type: 'MORNING_REVEAL',
          data: {
            legacyType: 'REVEAL',
            deaths: [{ id: 'p2', name: 'Bob', role: 'MAFIA', isMafia: true, isAlive: false }],
          },
          phase: 'MORNING_REVEAL',
          dayNumber: 2,
        },
        {
          type: 'PLAYER_LYNCHED',
          data: {
            legacyType: 'PLAYER_LYNCHED',
            deaths: [{ id: 'p4', name: 'Dana', role: 'SHERIFF', isMafia: false, isAlive: false }],
          },
          phase: 'DAY_VOTING',
          dayNumber: 2,
        },
        {
          type: 'MORNING_REVEAL',
          data: {
            legacyType: 'REVEAL',
            deaths: [{ id: 'p1', name: 'Alice', role: 'MAFIA', isMafia: true, isAlive: false }],
          },
          phase: 'MORNING_REVEAL',
          dayNumber: 3,
        },
        {
          type: 'GAME_ENDED',
          data: { legacyType: 'STATE_CHANGE', winner: 'TOWN', mafiaAlive: 0, townAlive: 3 },
          phase: 'GAME_OVER',
        },
      ],
    });

    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createGamesRouter(
        { gameEngine: {}, gameRepository: repo, eventBus: createFakeEventBus() } as any,
        null,
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

  it('derives GAME_OVER phase, eliminatedPlayers, and isAlive=false for every death', async () => {
    const response = await fetch(`${baseUrl}/api/v1/games/g-elim`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    const game = body.data;

    expect(game.status).toBe('ENDED');
    expect(game.currentState.phase).toBe('GAME_OVER');
    // Event order: p2 (night 1), p4 (lynch), p1 (night 3)
    expect(game.currentState.eliminatedPlayers).toEqual(['p2', 'p4', 'p1']);
    expect(game.currentState.activePlayers).toEqual(['p3', 'p5', 'p6']);

    const byId = new Map(game.players.map((p: { id: string; isAlive: boolean }) => [p.id, p]));
    expect(byId.get('p1')!.isAlive).toBe(false); // mafia, night kill
    expect(byId.get('p2')!.isAlive).toBe(false); // mafia, night kill
    expect(byId.get('p4')!.isAlive).toBe(false); // lynched town sheriff
    expect(byId.get('p3')!.isAlive).toBe(true);
    expect(byId.get('p5')!.isAlive).toBe(true);
    expect(byId.get('p6')!.isAlive).toBe(true);
  });

  it('includes one elimination event per death, matching GAME_ENDED mafiaAlive/townAlive', async () => {
    const response = await fetch(`${baseUrl}/api/v1/games/g-elim`);
    expect(response.status).toBe(200);
    const body = await response.json();
    const game = body.data;

    const deathEvents = game.events.filter((e: { type: string }) =>
      e.type === 'MORNING_REVEAL' ||
      e.type === 'PLAYER_LYNCHED' ||
      e.type === 'PLAYER_ELIMINATED' ||
      e.type === 'PLAYER_KILLED');
    const deaths = deathEvents.flatMap((e: { data: { deaths?: unknown[] } }) => e.data?.deaths ?? []);

    // Every death has its own elimination event, in stream order
    expect(deathEvents).toHaveLength(3);
    expect(deaths).toHaveLength(3);
    expect(deathEvents.map((e: { type: string }) => e.type)).toEqual([
      'MORNING_REVEAL',
      'PLAYER_LYNCHED',
      'MORNING_REVEAL',
    ]);

    const ended = game.events.find((e: { type: string }) => e.type === 'GAME_ENDED');
    expect(ended).toBeDefined();
    const mafiaDeaths = deaths.filter((d: any) => d.isMafia === true).length;
    const townDeaths = deaths.filter((d: any) => d.isMafia === false).length;
    // 2 mafia started, 4 town started — GAME_ENDED counts what survived
    expect(ended.data.mafiaAlive).toBe(2 - mafiaDeaths);
    expect(ended.data.townAlive).toBe(4 - townDeaths);
  });

  it('does not mark anyone dead for an IN_PROGRESS game without death events', async () => {
    repo.seedGame({
      id: 'g-live',
      status: 'IN_PROGRESS',
      players: [
        { id: 'p1', name: 'Alice', role: 'MAFIA', isMafia: true, joinOrder: 0 },
        { id: 'p2', name: 'Bob', role: 'VILLAGER', isMafia: false, joinOrder: 1 },
      ],
      events: [
        {
          type: 'ROLES_ASSIGNED',
          data: {
            assignments: [
              { playerId: 'p1', role: 'MAFIA' },
              { playerId: 'p2', role: 'VILLAGER' },
            ],
          },
          phase: 'SETUP',
        },
      ],
    });

    const response = await fetch(`${baseUrl}/api/v1/games/g-live`);
    expect(response.status).toBe(200);
    const body = await response.json();
    const game = body.data;

    expect(game.currentState.phase).toBe('SETUP');
    expect(game.currentState.eliminatedPlayers).toEqual([]);
    expect(game.players.every((p: { isAlive: boolean }) => p.isAlive)).toBe(true);
  });

  it('derives the live phase from the last phase event in the detail payload (DF-MAFIA-AI-BENCHMARK-4)', async () => {
    repo.seedGame({
      id: 'g-live-phase',
      status: 'IN_PROGRESS',
      players: [
        { id: 'p1', name: 'Alice', role: 'MAFIA', isMafia: true, joinOrder: 0 },
        { id: 'p2', name: 'Bob', role: 'VILLAGER', isMafia: false, joinOrder: 1 },
      ],
      events: [
        {
          type: 'ROLES_ASSIGNED',
          data: {
            assignments: [
              { playerId: 'p1', role: 'MAFIA' },
              { playerId: 'p2', role: 'VILLAGER' },
            ],
          },
          phase: 'SETUP',
          dayNumber: 1,
          turnNumber: 1,
        },
        {
          type: 'PHASE_CHANGED',
          data: { from: 'SETUP', to: 'DAY_DISCUSSION' },
          phase: 'DAY_DISCUSSION',
          dayNumber: 2,
          turnNumber: 4,
        },
      ],
    });

    const response = await fetch(`${baseUrl}/api/v1/games/g-live-phase`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    const game = body.data;

    // An IN_PROGRESS game whose last event carries phase DAY_DISCUSSION
    // must report DAY_DISCUSSION — never the hardcoded SETUP.
    expect(game.status).toBe('IN_PROGRESS');
    expect(game.currentState.phase).toBe('DAY_DISCUSSION');
    expect(game.currentState.dayNumber).toBe(2);
    expect(game.currentState.turnNumber).toBe(4);
  });
});
