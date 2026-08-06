import { describe, it, expect } from 'vitest';

// Host port 3000 is owned by DuckBrain's HTTP server on fleet hosts; the
// mafia compose stack exposes the server on :3004 (docker "3004:3000").
// CI starts its own source server on :3000, so the default stays :3000.
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

/**
 * Pre-test probe: these integration tests require a LIVE mafia server. Fresh
 * contributors running `pnpm test` from the root often have no server up, and
 * on fleet hosts localhost:3000 is owned by DuckBrain's HTTP daemon (its
 * /health returns 200 but has no `memory` field), which used to surface as 8
 * confusing red failures. The suite is skipped with a clear message unless the
 * resolved base URL is a reachable mafia server (GET /health with a `memory`
 * field in the JSON body discriminates a mafia server from DuckBrain).
 */
async function probeMafiaServer(baseUrl: string): Promise<{ available: boolean; message: string }> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      return {
        available: false,
        message: `no mafia server reachable at ${baseUrl} (GET /health -> HTTP ${response.status}); set TEST_BASE_URL to run`,
      };
    }
    const data = await response.json();
    if (typeof data.memory === 'undefined') {
      return {
        available: false,
        message: `a non-mafia service responded at ${baseUrl} (/health has no \`memory\` field); set TEST_BASE_URL to a running mafia server to run`,
      };
    }
    return { available: true, message: `mafia server reachable at ${baseUrl}` };
  } catch (error) {
    return {
      available: false,
      message: `no mafia server reachable at ${baseUrl} (${(error as Error).message}); set TEST_BASE_URL to run`,
    };
  }
}

const SERVER_PROBE = await probeMafiaServer(BASE_URL);

if (!SERVER_PROBE.available) {
  console.warn(`\n⚠️  Skipping API integration tests: ${SERVER_PROBE.message}\n`);
}

/**
 * Helper: create a game and return the gameId.
 * Since game creation spawns a real legacy engine child process (~30-60s),
 * the game is created asynchronously. This just fires the POST and returns the ID.
 */
async function createGame(numPlayers = 5): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/v1/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numPlayers }),
  });
  expect(response.status).toBe(201);
  const data = await response.json();
  expect(data.success).toBe(true);
  expect(data.data.gameId).toBeDefined();
  expect(typeof data.data.gameId).toBe('string');
  return data.data.gameId;
}

// ============================================================================
// Health
// ============================================================================

describe.skipIf(!SERVER_PROBE.available)('Health endpoint', () => {
  it('returns healthy status', async () => {
    const response = await fetch(`${BASE_URL}/health`);
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

describe.skipIf(!SERVER_PROBE.available)('Games API', () => {
  // --------------------------------------------------------------------------
  // Create game
  // --------------------------------------------------------------------------

  describe('POST /api/v1/games', () => {
    it('creates a game with 5 players and returns 201 with gameId', async () => {
      const response = await fetch(`${BASE_URL}/api/v1/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numPlayers: 5 }),
      });
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.gameId).toBeDefined();
      expect(typeof body.data.gameId).toBe('string');
      expect(body.data.gameId.length).toBeGreaterThan(0);
      expect(body.data.status).toBe('starting');
      expect(body.data.config).toBeDefined();
      expect(body.data.config.engineType).toBe('legacy');
    });

    it('creates a game with empty body (defaults to 5 players)', async () => {
      const response = await fetch(`${BASE_URL}/api/v1/games`, {
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
    });
  });

  // --------------------------------------------------------------------------
  // List games
  // --------------------------------------------------------------------------

  describe('GET /api/v1/games', () => {
    it('returns an array of games', async () => {
      const response = await fetch(`${BASE_URL}/api/v1/games`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.count).toBe('number');
      expect(body.count).toBe(body.data.length);
    });
  });

  // --------------------------------------------------------------------------
  // Get game by ID
  // --------------------------------------------------------------------------

  describe('GET /api/v1/games/:gameId', () => {
    it('returns game details for a valid game ID', async () => {
      const gameId = await createGame(5);

      const response = await fetch(`${BASE_URL}/api/v1/games/${gameId}`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.id).toBe(gameId);
      expect(body.data.status).toBeDefined();
      expect(body.data.config).toBeDefined();
    });

    it('returns 404 for a non-existent game ID', async () => {
      const response = await fetch(`${BASE_URL}/api/v1/games/nonexistent-id-12345`);
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
      const gameId = await createGame(5);

      // Wait briefly — the legacy child process should emit at least a
      // GAME_CREATED event almost immediately after creation.
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const response = await fetch(`${BASE_URL}/api/v1/games/${gameId}/events`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.count).toBe('number');
      expect(body.count).toBe(body.data.length);

      // If the game engine already emitted events, verify their shape
      if (body.data.length > 0) {
        const event = body.data[0];
        expect(event.id).toBeDefined();
        expect(event.type).toBeDefined();
        expect(event.timestamp).toBeDefined();
      }
    });
  });

  // --------------------------------------------------------------------------
  // Legacy games
  // --------------------------------------------------------------------------

  describe('GET /api/v1/legacy-games', () => {
    it('returns an array (may be empty or return 503 if no legacy adapter)', async () => {
      const response = await fetch(`${BASE_URL}/api/v1/legacy-games`);

      // Legacy adapter may or may not be available. Accept both.
      if (response.status === 503) {
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.error).toContain('Legacy engine not available');
        return;
      }

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });
});
