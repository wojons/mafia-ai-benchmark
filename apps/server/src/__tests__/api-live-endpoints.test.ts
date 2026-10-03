/**
 * Live-API integration tests for the endpoints the legacy standalone
 * integration.test.js runner (MAF-GAP-074) covered but no vitest suite did.
 *
 * That 649-line file was a custom pass/fail-counter runner (own http client,
 * process.exit summary) excluded by the package vitest config (only src
 * .test.ts/.test.tsx files are matched) and referenced by no script/turbo/CI
 * task, so its "31 API integration tests" silently never executed. It was also STALE:
 * it asserted status 'SETUP', a `game-`-prefixed id, `data.totalCost`, and an
 * array-shaped /api/v1/models response — none of which the current API
 * serves. This port carries the coverage forward against the CURRENT wire
 * shapes, probed live (2026-10-02):
 *
 *   GET  /api/v1                     → { version, name, endpoints }
 *   GET  /api/v1/games?status=SETUP  → 200, validated status filter
 *   GET  /api/v1/stats               → { totalGames, activeGames, ... }
 *   GET  /api/v1/models              → { providers, models[], totalCached }
 *   GET  /api/v1/models/pricing      → pricing with hasPricing boolean
 *   POST /api/v1/models/calculate-cost → { cost, pricing, formatted }
 *   POST .../players/:i/model + role/:role/model + models/bulk
 *                                    → 404 unknown game / 400 invalid body
 *   GET  /api/v1/games/:id/sse-status → activeConnections counter
 *   GET  /api/v1/games/:id/events (SSE) → connected event + counter moves
 *
 * Known defect NOT pinned here (route happy paths 500): the model-assignment
 * routes call gameRepository.assignPlayerModel/assignRoleModel, whose INSERT
 * omits player_id while player_model_assignments.player_id is NOT NULL —
 * every assignment 500s with "NOT NULL constraint failed". Fixing the schema/
 * repository is out of MAF-GAP-074's scope (test-resurrection row); the port
 * pins the deterministic 400/404 arms so the routes' wiring is still guarded.
 *
 * Like api.test.ts / health.test.ts, the REST endpoint tests need a LIVE
 * mafia server (probeMafiaServer; skipped cleanly otherwise) and honor
 * TEST_BASE_URL. The SSE block (MAF-FLAKE-001) is hermetic instead: it
 * boots the real games router on an ephemeral port and never touches
 * :3004 — see its header below.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import express from 'express';
import type { Server } from 'http';
import { BASE_URL, probeMafiaServer } from './helpers/mafia-server';
import { createGamesRouter } from '../routes/games.js';
import { EventBus } from '../services/event-bus.js';
import { createSqliteBackedRepository } from './services/mocks.js';
import type { ServerContext } from '../index.js';

const SERVER_PROBE = await probeMafiaServer(BASE_URL);

if (!SERVER_PROBE.available) {
  console.warn(`\n⚠️  Skipping live API integration tests: ${SERVER_PROBE.message}\n`);
}

async function createGame(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/v1/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numPlayers: 5 }),
  });
  expect(response.status).toBe(201);
  const body = await response.json();
  return body.data.gameId as string;
}

// ---------------------------------------------------------------------------
// API info + stats + games list (orphan: testAPIInfoEndpoint, testServerStats,
// testGamesList*, carried against current shapes)
// ---------------------------------------------------------------------------

describe.skipIf(!SERVER_PROBE.available)('API info endpoint', () => {
  it('GET /api/v1 returns version and endpoint list', async () => {
    const response = await fetch(`${BASE_URL}/api/v1`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.version).toBe('1.0.0');
    expect(body.name).toBe('Mafia AI Benchmark API');
    expect(typeof body.endpoints).toBe('string');
    expect(body.endpoints).toContain('/api/v1/games');
  });
});

describe.skipIf(!SERVER_PROBE.available)('Games list filters', () => {
  it('GET /api/v1/games returns a games array in the success envelope', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/games`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/v1/games?status=SETUP validates the canonical status and returns 200', async () => {
    // SETUP is a member of VALID_GAME_STATUSES (MAF-GAP-049 validation): the
    // filter itself must be accepted even when no SETUP games exist.
    const response = await fetch(`${BASE_URL}/api/v1/games?status=SETUP`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe.skipIf(!SERVER_PROBE.available)('Server statistics', () => {
  it('GET /api/v1/stats exposes the GameStats fields', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/stats`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.totalGames).toBe('number');
    expect(typeof body.data.activeGames).toBe('number');
    expect(typeof body.data.completedGames).toBe('number');
    expect(typeof body.data.mafiaWins).toBe('number');
    expect(typeof body.data.townWins).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Models catalog + pricing + cost calculation (orphan: testListModels,
// testModelPricing*, testCalculateCost* — pinned to current envelope shapes)
// ---------------------------------------------------------------------------

describe.skipIf(!SERVER_PROBE.available)('Models catalog', () => {
  it('GET /api/v1/models returns providers and a models array (object envelope)', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/models`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(typeof body.data).toBe('object');
    expect(Array.isArray(body.data.providers)).toBe(true);
    expect(body.data.providers.length).toBeGreaterThan(0);
    expect(Array.isArray(body.data.models)).toBe(true);
    expect(typeof body.data.totalCached).toBe('number');
  });
});

describe.skipIf(!SERVER_PROBE.available)('Model pricing', () => {
  it('returns numeric per-million pricing for a known model', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/models/pricing?model=gpt-4o-mini`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.modelId).toBe('gpt-4o-mini');
    expect(typeof body.data.inputPerMillion).toBe('number');
    expect(typeof body.data.outputPerMillion).toBe('number');
    expect(body.data.hasPricing).toBe(true);
  });

  it('reports hasPricing:false for an unknown model instead of erroring', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/models/pricing?model=unknown-model-xyz`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.modelId).toBe('unknown-model-xyz');
    expect(body.data.hasPricing).toBe(false);
    // NO_PRICING_MARKER (-6.66) is the sentinel for missing prices.
    expect(body.data.noPricingMarker).toBe(-6.66);
  });

  it('serves pricing for every popular catalog model', async () => {
    for (const model of ['gpt-4o', 'claude-sonnet-4-20250514', 'gemini-2.5-flash', 'deepseek-chat']) {
      const response = await fetch(`${BASE_URL}/api/v1/models/pricing?model=${model}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    }
  });
});

describe.skipIf(!SERVER_PROBE.available)('Cost calculation', () => {
  it('computes the exact cost for a known model', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/models/calculate-cost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: 'gpt-4o-mini', inputTokens: 15000, outputTokens: 5000 }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    // Current envelope: { cost, pricing, formatted } — not the orphan's
    // stale data.totalCost. gpt-4o-mini: $0.15/M in, $0.60/M out.
    const expected = (15000 / 1e6) * 0.15 + (5000 / 1e6) * 0.6;
    expect(body.data.cost).toBeCloseTo(expected, 6);
    expect(typeof body.data.formatted).toBe('string');
    expect(body.data.formatted).toContain('(15000 in, 5000 out)');
    expect(body.data.pricing.hasPricing).toBe(true);
  });

  it('returns cost 0 with the NO_PRICING_MARKER pricing for an unknown model', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/models/calculate-cost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: 'unknown-model-xyz', inputTokens: 1000, outputTokens: 500 }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.cost).toBe(0);
    expect(body.data.pricing.hasPricing).toBe(false);
    expect(body.data.pricing.inputPerMillion).toBe(-6.66);
    expect(body.data.formatted).toBe('No pricing data available');
  });

  it('accepts 400 when tokens are missing', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/models/calculate-cost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: 'gpt-4o-mini' }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Model assignment routes (orphan: testSetPlayerModel, testSetRoleModel,
// testBulkModelConfiguration). The happy paths currently 500 on the live
// server (player_id NOT NULL schema drift — see file header), so the port
// pins the deterministic validation arms only.
// ---------------------------------------------------------------------------

describe.skipIf(!SERVER_PROBE.available)('Model assignment routes (validation arms)', () => {
  it('POST players/:i/model returns 404 for an unknown game', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/games/nonexistent-game-xyz/players/0/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4o-mini' }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Game not found');
  });

  it('POST players/:i/model returns 400 when provider/model are missing', async () => {
    const gameId = await createGame();
    const response = await fetch(`${BASE_URL}/api/v1/games/${gameId}/players/0/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai' }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('provider and model are required');
  });

  it('POST role/:role/model returns 404 for an unknown game', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/games/nonexistent-game-xyz/role/MAFIA/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' }),
    });
    expect(response.status).toBe(404);
  });

  it('POST models/bulk returns 404 for an unknown game and 400 for a non-array assignment list', async () => {
    const game404 = await fetch(`${BASE_URL}/api/v1/games/nonexistent-game-xyz/models/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments: [{ type: 'player', index: 0, provider: 'openai', model: 'gpt-4o-mini' }] }),
    });
    expect(game404.status).toBe(404);

    const game400 = await fetch(`${BASE_URL}/api/v1/games/nonexistent-game-xyz/models/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments: 'not-an-array' }),
    });
    expect(game400.status).toBe(400);
    const body = await game400.json();
    expect(body.error).toContain('assignments array is required');
  });
});

// ---------------------------------------------------------------------------
// SSE event streaming (orphan: testSSEConnection, testSSEStatus) — carried
// with a raw-socket client whose disconnect the server can observe.
//
// MAF-FLAKE-001: these tests used to run against the shared LIVE :3004
// server and raced it twice — (a) the fixed 800/1500ms "read some bytes"
// sleeps were flaky 200-first-chunk timing under load, and (b) the
// counter assertions assumed the whole process had no other SSE
// subscribers, which the live server's active games violate. They now run
// hermetically: the REAL games router over an in-memory SQLite repo and a
// REAL EventBus on an EPHEMERAL port (the boot pattern of
// routes/games.validation.test.ts), where the only subscribers are the
// test's own. Streaming is asserted with marker-conditioned reads (read
// UNTIL the stream contains the expected bytes), not fixed sleeps; the
// counter is per-test gameId, so no shared counter exists to race.
//
// The SSE arm of GET /api/v1/games/:id/events and the sse-status route
// never consult game existence (no 404 arm on either), so no game needs
// creating: a synthetic gameId exercises the full surface. These tests are
// hermetic, so unlike the rest of this file they run WITHOUT a live server.
// ---------------------------------------------------------------------------

let sseServer: Server;
let sseBaseUrl: string;

beforeAll(async () => {
  const repo = createSqliteBackedRepository();
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createGamesRouter(
      {
        gameEngine: {},
        gameRepository: repo,
        eventBus: new EventBus(),
      } as unknown as ServerContext,
      null,
    ),
  );
  sseServer = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = sseServer.address() as { port: number };
  sseBaseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    sseServer.close((err) => (err ? reject(err) : resolve())),
  );
});

/** Synthetic id — the SSE + sse-status routes never look the game up. */
const SSE_TEST_GAME_ID = 'sse-hermetic-game';

/**
 * Opens a raw TCP connection speaking minimal HTTP with Accept:
 * text/event-stream and returns the received bytes so far. Destroying the
 * socket is a real client disconnect, so the server's req 'close' handler
 * fires and sse-status drops back to 0 (a fetch()-AbortController client can
 * also work, but the raw socket makes the disconnect timing deterministic).
 */
function openSSE(gameId: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const url = new URL(sseBaseUrl);
    const socket = net.createConnection(Number(url.port), url.hostname);
    socket.setTimeout(10000);
    socket.on('connect', () => {
      socket.write(
        `GET /api/v1/games/${gameId}/events HTTP/1.1\r\nHost: ${url.host}\r\nAccept: text/event-stream\r\n\r\n`,
      );
      resolve(socket);
    });
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('SSE connection timed out'));
    });
  });
}

/** Read whatever arrives on the SSE socket within `ms`. */
async function readSSEFor(socket: net.Socket, ms: number): Promise<string> {
  const chunks: Buffer[] = [];
  const onData = (chunk: Buffer) => chunks.push(chunk);
  socket.on('data', onData);
  await new Promise((resolve) => setTimeout(resolve, ms));
  socket.off('data', onData);
  return Buffer.concat(chunks).toString();
}

/**
 * MAF-FLAKE-001: read from the SSE socket UNTIL the accumulated stream
 * contains `marker` (bounded by a 5s deadline). Replaces the fixed
 * sleep-then-grep reads whose 800/1500ms budgets flaked under load —
 * first-chunk timing is now waited for, not assumed.
 */
async function readSSEUntil(socket: net.Socket, marker: string, deadlineMs = 5000): Promise<string> {
  let stream = '';
  const start = Date.now();
  while (!stream.includes(marker) && Date.now() - start < deadlineMs) {
    stream += await readSSEFor(socket, 100);
  }
  expect(stream.includes(marker)).toBe(true);
  return stream;
}

async function sseStatus(gameId: string): Promise<{ activeConnections: number; isStreaming: boolean }> {
  const response = await fetch(`${sseBaseUrl}/api/v1/games/${gameId}/sse-status`);
  expect(response.status).toBe(200);
  const body = await response.json();
  return body.data;
}

/** Poll sse-status until the predicate holds (bounded); returns the last read. */
async function waitForStatus(
  gameId: string,
  predicate: (data: { activeConnections: number; isStreaming: boolean }) => boolean,
  attempts = 25,
): Promise<{ activeConnections: number; isStreaming: boolean }> {
  let data = await sseStatus(gameId);
  for (let i = 0; i < attempts && !predicate(data); i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    data = await sseStatus(gameId);
  }
  return data;
}

describe('SSE event streaming (hermetic router on ephemeral port)', () => {
  it('streams a connected event for a game and reports it in sse-status', async () => {
    const gameId = SSE_TEST_GAME_ID;

    const socket = await openSSE(gameId);
    try {
      const stream = await readSSEUntil(socket, '"type":"connected"');
      expect(stream).toContain('HTTP/1.1 200');
      expect(stream).toContain('text/event-stream');
    } finally {
      socket.destroy();
    }

    // After the disconnect is processed the counter must return to 0.
    const data = await waitForStatus(gameId, (d) => d.activeConnections === 0);
    expect(data.activeConnections).toBe(0);
    expect(data.isStreaming).toBe(false);
  }, 20000);

  it('reports activeConnections 1 + isStreaming while a client is connected', async () => {
    const gameId = SSE_TEST_GAME_ID;

    expect((await sseStatus(gameId)).activeConnections).toBe(0);

    const socket = await openSSE(gameId);
    try {
      // Consume the response head + connected event so the server registers
      // the subscription, then check the counter from a separate connection.
      await readSSEUntil(socket, '"type":"connected"');
      const data = await sseStatus(gameId);
      expect(data.activeConnections).toBe(1);
      expect(data.isStreaming).toBe(true);
    } finally {
      socket.destroy();
    }

    // Wait for the server to process the disconnect before the suite ends,
    // so no subscription leaks into other tests.
    const data = await waitForStatus(gameId, (d) => d.activeConnections === 0);
    expect(data.activeConnections).toBe(0);
  }, 20000);
});

// ---------------------------------------------------------------------------
// Error handling (orphan: test404NotFound, testInvalidJSON — same envelopes)
// ---------------------------------------------------------------------------

describe.skipIf(!SERVER_PROBE.available)('Error envelopes', () => {
  it('GET /api/v1/nonexistent returns 404 NOT_FOUND code', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/nonexistent`);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('not found');
  });

  it('POST /api/v1/games with malformed JSON returns 400 BAD_REQUEST', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {{{',
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});