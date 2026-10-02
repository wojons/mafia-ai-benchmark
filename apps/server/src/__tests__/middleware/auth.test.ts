/**
 * MAF-REV-004 — optional admin token auth.
 *
 * The server had NO authentication: ADMIN-visibility events (e.g.
 * AGENT_THINK_STARTED / COMPLETED THINK text) were readable by any client on
 * GET /api/v1/games/:gameId/events (default visibility 'all') and any network
 * client could create games via POST /api/v1/games.
 *
 * Coverage:
 *  - ADMIN_AUTH_TOKEN unset: FULL passthrough — create-game still 201 and
 *    events still serve the default 'all' filter (existing behavior).
 *  - ADMIN_AUTH_TOKEN set: 401 {success:false,error:'unauthorized'} without
 *    credentials on (a) admin-exposing event reads and (b) game creation;
 *    200/201 with the correct Bearer header (or X-Admin-Token); public
 *    visibility stays open without a token.
 *  - Route-level defense in depth: with auth enforced and no credentials,
 *    the events route serves public-only events even when its router is
 *    mounted WITHOUT the global middleware.
 *
 * Pattern: boots the REAL games router over an ephemeral Express app
 * (listen(0)) and drives it with fetch — same shape as
 * routes/games.validation.test.ts. Auth is toggled via setAdminAuthOverride
 * (imported straight from the production middleware, no process.env races).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import {
  adminAuthMiddleware,
  setAdminAuthOverride,
  isAdminAuthEnabled,
} from '../../middleware/auth.js';
import { createGamesRouter } from '../../routes/games.js';
import { createSqliteBackedRepository, createFakeEventBus } from '../services/mocks.js';
import type { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';

const TEST_TOKEN = 'test-admin-token-0f9a';

let startedConfigs: Array<Record<string, unknown>> = [];

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

/** Events the events route will serve: PRIVATE + PUBLIC + ADMIN examples. */
type MixedVisibilityEvents = {
  type: string;
  visibility?: string;
  data: unknown;
};

/**
 * Minimal structural repo surface this test touches. Deliberately NOT
 * ReturnType<typeof createSqliteBackedRepository>: that intersection reduces
 * to `never` (GameRepository.db is private in one constituent) — the same
 * pre-existing quirk other suites route around.
 */
type AuthTestRepo = {
  seedGame(opts: { id: string; status?: string; events?: MixedVisibilityEvents[] }): void;
};

async function seedEventsWithMixedVisibility(repo: AuthTestRepo): Promise<void> {
  repo.seedGame({
    id: 'game-auth-1',
    status: 'IN_PROGRESS',
    events: [
      { type: 'GAME_STARTED', visibility: 'PUBLIC', data: { note: 'public-start' } },
      { type: 'AGENT_THINK', visibility: 'PRIVATE', data: { note: 'private-think' } },
      { type: 'AGENT_THINK', visibility: 'ADMIN', data: { note: 'admin-think' } },
    ],
  });
}

async function bootServer(withAdminMiddleware: boolean): Promise<{ server: Server; baseUrl: string }> {
  const repo = createSqliteBackedRepository();
  seedEventsWithMixedVisibility(repo);
  const app = express();
  app.use(express.json());
  const gamesRouter = createGamesRouter(
    {
      gameEngine: {
        createGame: (config: Record<string, unknown>) => {
          startedConfigs.push(config);
          return { id: 'stub-standard-game', status: 'SETUP', config };
        },
      },
      gameRepository: repo,
      eventBus: createFakeEventBus(),
    } as never,
    createStubLegacyAdapter(),
  );
  if (withAdminMiddleware) app.use(adminAuthMiddleware());
  app.use('/', gamesRouter);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address() as { port: number };
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

type ApiResult = { status: number; body: { success: boolean; error?: string; data?: Array<Record<string, unknown>> | Record<string, unknown>; count?: number } };

async function postGame(baseUrl: string, headers: Record<string, string> = {}): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}/api/v1/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ numPlayers: 5 }),
  });
  return { status: response.status, body: (await response.json()) as ApiResult['body'] };
}

async function getEvents(baseUrl: string, gameId = 'game-auth-1', query = '', headers: Record<string, string> = {}): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}/api/v1/games/${gameId}/events${query}`, { headers });
  return { status: response.status, body: (await response.json()) as ApiResult['body'] };
}

const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

let server: Server;
let baseUrl: string;

async function boot(withAdminMiddleware: boolean): Promise<void> {
  ({ server, baseUrl } = await bootServer(withAdminMiddleware));
}

afterEach(async () => {
  setAdminAuthOverride(undefined);
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

// ---------------------------------------------------------------------------
// ADMIN_AUTH_TOKEN unset — full passthrough (existing behavior unchanged)
// ---------------------------------------------------------------------------

describe('admin auth DISABLED (ADMIN_AUTH_TOKEN unset)', () => {
  beforeEach(async () => {
    setAdminAuthOverride(undefined);
    await boot(true);
  });

  it('middleware reports disabled and passes game creation through (201)', async () => {
    expect(isAdminAuthEnabled()).toBe(false);

    const { status, body } = await postGame(baseUrl);
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(startedConfigs).toHaveLength(1);
  });

  it("events with default visibility 'all' still return everything (200, admin events included)", async () => {
    const { status, body } = await getEvents(baseUrl);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const types = (body.data as Array<Record<string, unknown>>).map((e) => e.data && (e.data as { note?: string }).note);
    expect(types).toContain('admin-think'); // ADMIN-visibility events readable — as before
    expect(body.count).toBe(3);
  });

  it('unrelated GETs and public-visibility reads remain open', async () => {
    const pub = await getEvents(baseUrl, 'game-auth-1', '?visibility=public');
    expect(pub.status).toBe(200);
    expect(pub.body.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ADMIN_AUTH_TOKEN set — enforcement
// ---------------------------------------------------------------------------

describe('admin auth ENFORCED (token set)', () => {
  beforeEach(async () => {
    startedConfigs = [];
    setAdminAuthOverride(TEST_TOKEN);
    await boot(true);
  });

  it('middleware reports enabled', () => {
    expect(isAdminAuthEnabled()).toBe(true);
  });

  it('POST /api/v1/games is 401 without credentials, 201 with the right Bearer token', async () => {
    const denied = await postGame(baseUrl);
    expect(denied.status).toBe(401);
    expect(denied.body).toEqual({ success: false, error: 'unauthorized' });
    expect(startedConfigs).toHaveLength(0); // engine never reached

    const allowed = await postGame(baseUrl, bearer(TEST_TOKEN));
    expect(allowed.status).toBe(201);
    expect(startedConfigs).toHaveLength(1);
  });

  it('POST /api/v1/games accepts X-Admin-Token as the credential transport', async () => {
    const allowed = await postGame(baseUrl, { 'X-Admin-Token': TEST_TOKEN });
    expect(allowed.status).toBe(201);
  });

  it('POST /api/v1/games 401s a wrong token and rejects the create', async () => {
    const wrong = await postGame(baseUrl, bearer('wrong-token'));
    expect(wrong.status).toBe(401);
    expect(startedConfigs).toHaveLength(0);
  });

  it("GET events with the exposing default 'all' is 401 without credentials", async () => {
    const denied = await getEvents(baseUrl);
    expect(denied.status).toBe(401);
    expect(denied.body).toEqual({ success: false, error: 'unauthorized' });
  });

  it('GET events with visibility=all|private|admin is 401 without credentials', async () => {
    for (const v of ['all', 'private', 'admin']) {
      const denied = await getEvents(baseUrl, 'game-auth-1', `?visibility=${v}`);
      expect(denied.status).toBe(401);
    }
  });

  it('GET events returns 200 with the correct Bearer token (admin events served)', async () => {
    const allowed = await getEvents(baseUrl, 'game-auth-1', '', bearer(TEST_TOKEN));
    expect(allowed.status).toBe(200);
    const notes = (allowed.body.data as Array<Record<string, unknown>>).map(
      (e) => (e.data as { note?: string }).note,
    );
    expect(notes).toContain('admin-think');
    expect(allowed.body.count).toBe(3);
  });

  it('GET events accepts X-Admin-Token as the credential transport', async () => {
    const allowed = await getEvents(baseUrl, 'game-auth-1', '', { 'X-Admin-Token': TEST_TOKEN });
    expect(allowed.status).toBe(200);
  });

  it('public visibility stays OPEN without credentials (200, PUBLIC only)', async () => {
    const pub = await getEvents(baseUrl, 'game-auth-1', '?visibility=public');
    expect(pub.status).toBe(200);
    expect(pub.body.count).toBe(1);
    const vis = (pub.body.data as Array<Record<string, unknown>>).map((e) => e.visibility);
    expect(vis).toEqual(['PUBLIC']);
  });

  it('a wrong token on a public-visibility read still gets through only via the open path (no credentials needed)', async () => {
    // The public filter is credential-free: even a bogus header must not 401 it.
    const pub = await getEvents(baseUrl, 'game-auth-1', '?visibility=public', bearer('bogus'));
    expect(pub.status).toBe(200);
  });

  it('404 for an unknown game is reached only WITH credentials (auth runs before the handler)', async () => {
    const deniedNoCreds = await getEvents(baseUrl, 'no-such-game');
    expect(deniedNoCreds.status).toBe(401);

    const notFoundWithCreds = await getEvents(baseUrl, 'no-such-game', '', bearer(TEST_TOKEN));
    expect(notFoundWithCreds.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Defense in depth: router mounted WITHOUT the global middleware
// ---------------------------------------------------------------------------

describe('route-level public-only fallback (auth set, router without global middleware)', () => {
  beforeEach(async () => {
    setAdminAuthOverride(TEST_TOKEN);
    await boot(false);
  });

  it("default visibility is clamped to public-only instead of 'all'", async () => {
    const result = await getEvents(baseUrl);
    expect(result.status).toBe(200); // served, not refused
    expect(result.body.count).toBe(1);
    const vis = (result.body.data as Array<Record<string, unknown>>).map((e) => e.visibility);
    expect(vis).toEqual(['PUBLIC']); // ADMIN/THINK text withheld
  });

  it('explicit private/admin filters are clamped to public-only too', async () => {
    for (const v of ['private', 'admin', 'all']) {
      const result = await getEvents(baseUrl, 'game-auth-1', `?visibility=${v}`);
      expect(result.status).toBe(200);
      expect(result.body.count).toBe(1);
    }
  });

  it('with correct credentials the full (uncapped) events set is served', async () => {
    const result = await getEvents(baseUrl, 'game-auth-1', '', bearer(TEST_TOKEN));
    expect(result.status).toBe(200);
    expect(result.body.count).toBe(3);
  });
});