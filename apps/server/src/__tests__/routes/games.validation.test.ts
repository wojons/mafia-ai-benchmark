/**
 * MAF-REV-001: request-body validation on POST /api/v1/games.
 *
 * Mounts the real games router on an ephemeral Express app (listen(0)) and
 * drives it with Node's built-in fetch, matching the games-routes.test.ts
 * conventions. The route must reject an invalid body with HTTP 400 BEFORE any
 * engine work, so the stub legacy adapter and the stub standard engine also
 * record every call they receive: a 400 that still started a game would be
 * exactly the defect this row is about.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createGamesRouter } from '../../routes/games.js';
import { createSqliteBackedRepository, createFakeEventBus } from '../services/mocks.js';
import type { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';

type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

/** Configs the stub legacy adapter was asked to start (route -> adapter). */
let startedConfigs: Array<Record<string, unknown>>;
/** Args the stub standard engine was asked to create games with. */
let createdGames: Array<Record<string, unknown>>;

function createStubLegacyAdapter(): LegacyGameAdapter {
  return {
    startGame: (config: Record<string, unknown>) => {
      startedConfigs.push(config);
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

const stubEngine = {
  createGame: (config: Record<string, unknown>) => {
    createdGames.push(config);
    return { id: 'stub-standard-game', status: 'SETUP', config: { numPlayers: 5 } };
  },
};

type GamePostBody = {
  success: boolean;
  error?: string;
  data?: { gameId?: string; status?: string; config?: { numPlayers?: number } };
};

/**
 * Boot the real games router over an ephemeral port. `legacyAdapter` null
 * exercises the standard-engine fallback branch of the same handler.
 */
async function bootGamesRouter(legacyAdapter: LegacyGameAdapter | null): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const repo = createSqliteBackedRepository() as unknown as FakeRepo;
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createGamesRouter(
      { gameEngine: stubEngine, gameRepository: repo, eventBus: createFakeEventBus() } as never,
      legacyAdapter,
    ),
  );
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address() as { port: number };
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function postGame(
  baseUrl: string,
  body: unknown,
): Promise<{ status: number; body: GamePostBody }> {
  const response = await fetch(`${baseUrl}/api/v1/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as GamePostBody };
}

describe('POST /api/v1/games validation (MAF-REV-001) — legacy engine path', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    startedConfigs = [];
    createdGames = [];
    ({ server, baseUrl } = await bootGamesRouter(createStubLegacyAdapter()));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  // --------------------------------------------------------------------------
  // numPlayers
  // --------------------------------------------------------------------------

  it('rejects numPlayers=2 with 400 and never starts a game', async () => {
    const { status, body } = await postGame(baseUrl, { numPlayers: 2 });

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('numPlayers');
    // The engine that throws "Minimum 5 players required" must never be reached.
    expect(startedConfigs).toHaveLength(0);
  });

  it('rejects numPlayers="abc" with 400', async () => {
    const { status, body } = await postGame(baseUrl, { numPlayers: 'abc' });

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('numPlayers');
    expect(startedConfigs).toHaveLength(0);
  });

  for (const bad of [0, 4, 16, 100, 5.5, -3, '5', '', true, null]) {
    it(`rejects malformed numPlayers ${JSON.stringify(bad)} with 400`, async () => {
      const { status, body } = await postGame(baseUrl, { numPlayers: bad });

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('numPlayers');
      expect(startedConfigs).toHaveLength(0);
    });
  }

  it('accepts the boundary values 5 and 15 and starts the game (201)', async () => {
    for (const numPlayers of [5, 15]) {
      const { status, body } = await postGame(baseUrl, { numPlayers });

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data?.gameId).toBe('stub-legacy-game');
      expect(body.data?.config?.numPlayers).toBe(numPlayers);
    }
    expect(startedConfigs).toHaveLength(2);
  });

  // --------------------------------------------------------------------------
  // engineType
  // --------------------------------------------------------------------------

  it('rejects engineType="quantum" with 400 before the engine runs', async () => {
    const { status, body } = await postGame(baseUrl, { numPlayers: 5, engineType: 'quantum' });

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('engineType');
    expect(startedConfigs).toHaveLength(0);
  });

  for (const bad of ['legacy-engine', 'LEGACY', 42, null, ['legacy']]) {
    it(`rejects invalid engineType ${JSON.stringify(bad)} with 400`, async () => {
      const { status, body } = await postGame(baseUrl, { numPlayers: 5, engineType: bad });

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('engineType');
      expect(startedConfigs).toHaveLength(0);
    });
  }

  it('accepts engineType legacy/native and an omitted engineType (201)', async () => {
    for (const engineType of ['legacy', 'native', undefined]) {
      const { status, body } = await postGame(baseUrl, { numPlayers: 5, engineType });

      expect(status).toBe(201);
      expect(body.success).toBe(true);
    }
    expect(startedConfigs).toHaveLength(3);
  });

  // --------------------------------------------------------------------------
  // roleModels
  // --------------------------------------------------------------------------

  for (const bad of [
    'openai/gpt-4o-mini',
    42,
    ['openai/gpt-4o-mini'],
    null,
    { MAFIA: 42 },
    { MAFIA: null },
    { MAFIA: [] },
    { MAFIA: '' },
    { MAFIA: {} },
    { MAFIA: { provider: 'openai' } },
    { MAFIA: { provider: 'openai', model: 7 } },
  ]) {
    it(`rejects malformed roleModels ${JSON.stringify(bad)} with 400`, async () => {
      const { status, body } = await postGame(baseUrl, { numPlayers: 5, roleModels: bad });

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('roleModels');
      expect(startedConfigs).toHaveLength(0);
    });
  }

  it('accepts provider/model string specs and an omitted roleModels (201)', async () => {
    const bodies = [
      { numPlayers: 5, roleModels: { MAFIA: 'openai/gpt-4o-mini', TOWN: 'openai/gpt-4o-mini' } },
      { numPlayers: 5, roleModels: {} },
      { numPlayers: 5 },
    ];
    for (const body of bodies) {
      const { status } = await postGame(baseUrl, body);
      expect(status).toBe(201);
    }
    expect(startedConfigs).toHaveLength(3);
    // The valid roleModels reach the adapter unchanged.
    expect(startedConfigs[0].roleModels).toEqual({
      MAFIA: 'openai/gpt-4o-mini',
      TOWN: 'openai/gpt-4o-mini',
    });
  });

  /**
   * The web dashboard (apps/web GameList.tsx) posts per-role pickers as
   * `{ role: { provider, model } }` objects. That shape is well formed — it is
   * what the UI renders and what it has always sent — so validation tolerates
   * it instead of 400-ing every dashboard-created game.
   */
  it('tolerates the dashboard { provider, model } roleModels shape (201)', async () => {
    const { status } = await postGame(baseUrl, {
      numPlayers: 5,
      roleModels: {
        MAFIA: { provider: 'openrouter', model: 'deepseek-v4-flash' },
        VILLAGER: { provider: 'openrouter', model: 'deepseek-v4-flash' },
      },
    });

    expect(status).toBe(201);
    expect(startedConfigs).toHaveLength(1);
  });

  // --------------------------------------------------------------------------
  // Existing behaviour preserved
  // --------------------------------------------------------------------------

  it('keeps the existing default: empty body creates a 5-player game (201)', async () => {
    const { status, body } = await postGame(baseUrl, {});

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data?.config?.numPlayers).toBe(5);
    expect(startedConfigs).toHaveLength(1);
  });
});

describe('POST /api/v1/games validation (MAF-REV-001) — standard engine fallback', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    startedConfigs = [];
    createdGames = [];
    // No legacy adapter: the handler takes the standard-engine branch, which
    // must be guarded by the same validation.
    ({ server, baseUrl } = await bootGamesRouter(null));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('rejects an invalid body with 400 before the standard engine is reached', async () => {
    for (const body of [{ numPlayers: 2 }, { numPlayers: 'abc' }, { engineType: 'quantum' }]) {
      const { status } = await postGame(baseUrl, body);
      expect(status).toBe(400);
    }
    expect(createdGames).toHaveLength(0);
  });

  it('still creates a game for a valid body (201)', async () => {
    const { status, body } = await postGame(baseUrl, { numPlayers: 6 });

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data?.gameId).toBe('stub-standard-game');
    expect(createdGames).toHaveLength(1);
  });
});
