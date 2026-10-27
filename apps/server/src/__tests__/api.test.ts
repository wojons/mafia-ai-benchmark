/**
 * API integration tests for the games surface — HERMETIC (README-7).
 *
 * This suite used to be a LIVE integration suite: it probed whatever mafia
 * server answered on the BASE_URL fallback (:3004) and POSTed real 5-player
 * games into it, appending ENDED rows to the live benchmark database and
 * moving the published leaderboard every time a reader followed Quick Start +
 * Running Tests. It now boots the REAL games router (routes/games.ts) on an
 * ephemeral port over an in-memory SQLite repository carrying the project
 * schema — the boot pattern of routes/games.validation.test.ts and the SSE
 * block of api-live-endpoints.test.ts — so the same wire shapes are pinned
 * with zero live-server dependency and zero writes outside this process.
 *
 * The live-coverage role these tests used to play continues in
 * api-live-endpoints.test.ts / health.test.ts, which run against a REAL
 * server only when TEST_BASE_URL is set explicitly (see README.md
 * "Running Tests"); CI pins TEST_BASE_URL against a server it starts itself
 * (see .github/workflows/ci.yml).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createGamesRouter } from '../routes/games.js';
import { createSqliteBackedRepository, createFakeEventBus } from './services/mocks.js';
import type { LegacyGameAdapter } from '../services/legacy-game-adapter.js';
import type { ServerContext } from '../index.js';

type Repo = ReturnType<typeof createSqliteBackedRepository>;

/** Configs the stub legacy adapter was asked to start (route -> adapter). */
let startedLegacyConfigs: Array<Record<string, unknown>>;

const stubEngine = {
  createGame: (config: Record<string, unknown>) => {
    startedLegacyConfigs.push(config);
    return { id: 'stub-standard-game', status: 'SETUP', config: { numPlayers: 5 } };
  },
};

function createStubLegacyAdapter(): LegacyGameAdapter {
  return {
    startGame: (config: Record<string, unknown>) => {
      startedLegacyConfigs.push(config);
      return {
        gameId: 'stub-legacy-game',
        status: 'RUNNING',
        startedAt: new Date(),
        players: [],
        eventCount: 0,
      };
    },
    getActiveGames: () => [],
    getGameState: () => undefined,
  } as unknown as LegacyGameAdapter;
}

/**
 * Boot the real games router (plus /health, which index.ts mounts at the app
 * level rather than inside setupRoutes) on an ephemeral port over the
 * in-memory sqlite repository. `legacyAdapter: null` exercises the
 * standard-engine fallback branch and the legacy-games 503 arm; a stub
 * adapter exercises the legacy path without spawning child processes.
 */
async function bootGamesRoutes(
  legacyAdapter: LegacyGameAdapter | null,
): Promise<{ server: Server; repo: Repo; baseUrl: string }> {
  const repo = createSqliteBackedRepository() as unknown as Repo;
  const app = express();
  app.use(express.json());
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  });
  app.use(
    '/',
    createGamesRouter(
      { gameEngine: stubEngine, gameRepository: repo, eventBus: createFakeEventBus() } as unknown as ServerContext,
      legacyAdapter,
    ),
  );
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address() as { port: number };
  return { server, repo, baseUrl: `http://127.0.0.1:${address.port}` };
}

let server: Server;
let repo: Repo;
let baseUrl: string;

// Second boot: fallback branch (no legacy adapter) for the legacy-games 503 arm.
let fallbackServer: Server;
let fallbackBaseUrl: string;

beforeAll(async () => {
  const boot = await bootGamesRoutes(createStubLegacyAdapter());
  server = boot.server;
  repo = boot.repo;
  baseUrl = boot.baseUrl;

  const fallbackBoot = await bootGamesRoutes(null);
  fallbackServer = fallbackBoot.server;
  fallbackBaseUrl = fallbackBoot.baseUrl;

  seedFixtures();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await new Promise<void>((resolve, reject) =>
    fallbackServer.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  startedLegacyConfigs = [];
});

// ============================================================================
// Health
// ============================================================================

describe('Health endpoint (hermetic app)', () => {
  it('returns healthy status', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.timestamp).toBeDefined();
    expect(data.uptime).toBeGreaterThan(0);
    expect(data.memory).toBeDefined();
  });
});

// ============================================================================
// Games CRUD
// ============================================================================

describe('Games API (hermetic app; stub legacy adapter)', () => {
  // --------------------------------------------------------------------------
  // Create game
  // --------------------------------------------------------------------------

  describe('POST /api/v1/games', () => {
    it('creates a game with 5 players and returns 201 with gameId', async () => {
      const response = await fetch(`${baseUrl}/api/v1/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numPlayers: 5 }),
      });
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.gameId).toBe('stub-legacy-game');
      expect(body.data.status).toBe('starting');
      expect(body.data.config).toBeDefined();
      expect(body.data.config.engineType).toBe('legacy');
      // The route must have handed the request to the legacy adapter with the
      // requested player count (this suite used to verify the create path by
      // POSTing real games at the live server; the stub records the call).
      expect(startedLegacyConfigs).toHaveLength(1);
      expect(startedLegacyConfigs[0].numPlayers).toBe(5);
    });

    it('creates a game with empty body (defaults to 5 players)', async () => {
      const response = await fetch(`${baseUrl}/api/v1/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      // Should succeed with defaults
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.gameId).toBeDefined();
      expect(typeof body.data.gameId).toBe('string');
      expect(body.data.config.numPlayers).toBe(5);
      expect(startedLegacyConfigs).toHaveLength(1);
      expect(startedLegacyConfigs[0].numPlayers).toBe(5);
    });
  });

  // --------------------------------------------------------------------------
  // List games
  // --------------------------------------------------------------------------

  describe('GET /api/v1/games', () => {
    it('returns an array of games', async () => {
      const response = await fetch(`${baseUrl}/api/v1/games`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.count).toBe('number');
      expect(body.count).toBe(body.data.length);
      // The two seeded fixture rows must be visible in the merged list.
      expect(body.data.map((g: { id: string }) => g.id)).toEqual(
        expect.arrayContaining([DETAIL_GAME_ID, EVENTS_GAME_ID]),
      );
    });

    // MAF-GAP-049: the status filter is validated against the canonical
    // vocabulary and applies to legacy games too (previously an unvalidated
    // cast passed any string through, and legacy rows were appended
    // unfiltered — ?status=bogus returned 200 with every active legacy game).
    it('returns only IN_PROGRESS rows when ?status=IN_PROGRESS', async () => {
      const response = await fetch(`${baseUrl}/api/v1/games?status=IN_PROGRESS`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      // Every row in the merged (DB + legacy) response must match the filter.
      for (const game of body.data) {
        expect(game.status).toBe('IN_PROGRESS');
      }
    });

    it('returns 400 with success:false for an invalid ?status value', async () => {
      const response = await fetch(`${baseUrl}/api/v1/games?status=bogus`);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid status filter');
    });
  });

  // --------------------------------------------------------------------------
  // Get game by ID
  // --------------------------------------------------------------------------

  describe('GET /api/v1/games/:gameId', () => {
    it('returns game details for a valid game ID', async () => {
      const response = await fetch(`${baseUrl}/api/v1/games/${DETAIL_GAME_ID}`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.id).toBe(DETAIL_GAME_ID);
      expect(body.data.status).toBeDefined();
      expect(body.data.config).toBeDefined();
      // Seeded players survive hydration through the repository projection.
      expect(body.data.players).toHaveLength(5);
    });

    it('returns 404 for a non-existent game ID', async () => {
      const response = await fetch(`${baseUrl}/api/v1/games/nonexistent-id-12345`);
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
      expect(typeof body.error).toBe('string');
    });
  });

  // --------------------------------------------------------------------------
  // Get game events
  // --------------------------------------------------------------------------

  describe('GET /api/v1/games/:gameId/events', () => {
    it('returns an array of events for a valid game', async () => {
      const response = await fetch(`${baseUrl}/api/v1/games/${EVENTS_GAME_ID}/events`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.count).toBe('number');
      expect(body.count).toBe(body.data.length);
      expect(body.data.length).toBeGreaterThan(0);

      const event = body.data[0];
      expect(event.id).toBeDefined();
      expect(event.type).toBeDefined();
      expect(event.timestamp).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Legacy games
  // --------------------------------------------------------------------------

  describe('GET /api/v1/legacy-games', () => {
    it('returns an array of active legacy games', async () => {
      const response = await fetch(`${baseUrl}/api/v1/legacy-games`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 503 with the legacy-engine-unavailable error when no adapter is mounted', async () => {
      const response = await fetch(`${fallbackBaseUrl}/api/v1/legacy-games`);
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Legacy engine not available');
    });
  });
});

// ============================================================================
// Seeded fixtures — the detail/events targets are seeded into the hermetic
// repo directly (createGame now goes through the stub legacy adapter, which
// owns no persistence of its own beyond the games row).
// ============================================================================

const DETAIL_GAME_ID = 'api-hermetic-detail-1';
const EVENTS_GAME_ID = 'api-hermetic-events-1';

function seedFixtures(): void {
  repo.seedGame({
    id: DETAIL_GAME_ID,
    status: 'IN_PROGRESS',
    numPlayers: 5,
    players: [
      { id: 'p1', name: 'Alice Quinn', role: 'SHERIFF', isAlive: true, isMafia: false, joinOrder: 1 },
      { id: 'p2', name: 'Bob Marley', role: 'MAFIA', isAlive: true, isMafia: true, joinOrder: 2 },
      { id: 'p3', name: 'Cara Delevingne', role: 'DOCTOR', isAlive: true, isMafia: false, joinOrder: 3 },
      { id: 'p4', name: 'Dan Aykroyd', role: 'CITIZEN', isAlive: true, isMafia: false, joinOrder: 4 },
      { id: 'p5', name: 'Eve Harrington', role: 'CITIZEN', isAlive: true, isMafia: false, joinOrder: 5 },
    ],
    events: [
      {
        type: 'GAME_CREATED',
        visibility: 'PUBLIC',
        actorId: 'p1',
        data: { config: { numPlayers: 5 } },
        dayNumber: 1,
        turnNumber: 1,
        phase: 'SETUP',
      },
      {
        type: 'PHASE_CHANGED',
        visibility: 'PUBLIC',
        data: { phase: 'DAY_DISCUSSION' },
        dayNumber: 1,
        turnNumber: 2,
        phase: 'DAY_DISCUSSION',
      },
    ],
  });
  repo.seedGame({
    id: EVENTS_GAME_ID,
    status: 'IN_PROGRESS',
    numPlayers: 5,
    events: [
      {
        type: 'GAME_CREATED',
        visibility: 'PUBLIC',
        actorId: 'p1',
        data: { config: { numPlayers: 5 } },
        dayNumber: 1,
        turnNumber: 1,
        phase: 'SETUP',
      },
    ],
  });
}