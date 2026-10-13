/**
 * WebSocket admin-auth visibility clamp (DF-MAFIA-AI-BENCHMARK-34).
 *
 * The HTTP events route clamps unauthenticated readers to public-only
 * (publicOnlyFallbackVisibility, MAF-REV-004) — but the WebSocket path
 * subscribed joiners to the raw EventBus feed with no per-joiner filter, so
 * an anonymous WS client joining a game received ADMIN-visibility frames
 * (mafia role attribution, private think text) that the same client could
 * never read over HTTP.
 *
 * Coverage (drives the REAL WebSocketHandler over real sockets with a real
 * EventBus — same shape as websocket-spectate.test.ts):
 *  - Auth enforced + anonymous upgrade (?-> /ws, no token): ADMIN/PRIVATE
 *    frames are WITHHELD, PUBLIC frames still arrive.
 *  - Auth enforced + token-carrying upgrade (?token= / X-Admin-Token /
 *    Bearer): the FULL feed arrives (AC2).
 *  - Auth DISABLED (no ADMIN_AUTH_TOKEN): anonymous clients keep receiving
 *    ADMIN frames — unchanged legacy behavior (AC for the opt-in contract).
 *  - Mixed audience: the clamped client and the authorized client connected
 *    to the same game get disjoint sets of the SAME published events.
 *
 * Auth is toggled via setAdminAuthOverride (imported straight from the
 * production middleware) with restore in afterEach — no process.env races.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { WebSocketHandler } from '../websocket/index.js';
import { EventBus } from '../services/event-bus.js';
import { setAdminAuthOverride } from '../middleware/auth.js';
import type { ServerContext } from '../index.js';
import type { GameEvent } from '@mafia/shared/types';

interface TestHarness {
  wss: WebSocketServer;
  handler: WebSocketHandler;
  eventBus: EventBus;
  url: string;
  server: import('http').Server;
}

const TEST_TOKEN = 'ws-test-admin-token-7d1f';

function makeEvent(gameId: string, type: string, visibility: 'PUBLIC' | 'PRIVATE' | 'ADMIN'): GameEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    gameId,
    type: type as GameEvent['type'],
    timestamp: new Date(),
    visibility,
    // The leak this fix stops: admin-think text with the mafia role on it.
    data: { note: `vis-${visibility}`, role: visibility === 'ADMIN' ? 'MAFIA' : undefined },
    metadata: { turnNumber: 1, dayNumber: 1, phase: 'DAY_DISCUSSION', sequence: 1 },
  } as unknown as GameEvent;
}

let h: TestHarness;

beforeAll(async () => {
  const eventBus = new EventBus();
  const context = {
    gameEngine: {
      getGameState: () => ({ gameId: 'g-ws-auth', status: 'RUNNING' }),
    },
    eventBus,
  } as unknown as ServerContext;

  const server = await new Promise<import('http').Server>((resolve) => {
    const { createServer } = require('http') as typeof import('http');
    const s = createServer();
    s.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  const wss = new WebSocketServer({ server });
  const handler = new WebSocketHandler(wss, context);
  h = { wss, handler, eventBus, url: `ws://127.0.0.1:${port}`, server };
});

afterAll(async () => {
  setAdminAuthOverride(undefined);
  h.wss.close();
  await new Promise<void>((resolve) => h.server.close(() => resolve()));
});

afterEach(() => {
  // Restore auth control to process.env (unset in this test process).
  setAdminAuthOverride(undefined);
  for (const client of h.wss.clients as Set<WebSocket>) {
    client.terminate();
  }
});

/** Collect GAME_EVENT frames from a client into arrays. */
function connectAndCollect(opts: { gameId: string; url?: string; headers?: Record<string, string> }): {
  ws: WebSocket;
  gameEvents: Array<Record<string, unknown>>;
} {
  const ws = new WebSocket(opts.url ?? h.url, { headers: opts.headers });
  const gameEvents: Array<Record<string, unknown>> = [];
  ws.on('message', (data: Buffer) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'GAME_EVENT') gameEvents.push(msg.payload);
  });
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'JOIN_GAME', payload: { gameId: opts.gameId } }));
  });
  return { ws, gameEvents };
}

function waitConnected(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

function waitFor(predicate: () => boolean, timeoutMs = 3000, stepMs = 25): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, stepMs);
  });
}

async function awaitJoin(gameId: string, count: number): Promise<void> {
  const joined = await waitFor(() => h.handler.getClientsInGame(gameId).length === count);
  expect(joined).toBe(true);
}

describe('WebSocket admin-auth visibility clamp (DF-MAFIA-AI-BENCHMARK-34)', () => {
  it('AC1: anonymous joiner receives PUBLIC frames but ZERO ADMIN/PRIVATE frames while auth is enforced', async () => {
    setAdminAuthOverride(TEST_TOKEN);
    const gameId = 'g-ws-auth-anon';
    const { ws, gameEvents } = connectAndCollect({ gameId });
    await waitConnected(ws);
    await awaitJoin(gameId, 1);

    // The exact leak shape from the dogfood capture: mixed stream, ADMIN
    // majority (mafia attribution + private think text).
    h.eventBus.publish(makeEvent(gameId, 'AGENT_THINK_STARTED', 'ADMIN'));
    h.eventBus.publish(makeEvent(gameId, 'PHASE_CHANGED', 'PUBLIC'));
    h.eventBus.publish(makeEvent(gameId, 'AGENT_THINK_COMPLETED', 'ADMIN'));
    h.eventBus.publish(makeEvent(gameId, 'VOTE_CAST', 'PRIVATE'));

    // The PUBLIC frame MUST arrive (anon spectating stays open, same as HTTP),
    // and after the wait window only that one frame may be present.
    const gotPublic = await waitFor(() => gameEvents.length >= 1);
    expect(gotPublic).toBe(true);
    await waitFor(() => gameEvents.length > 1, 400);
    expect(gameEvents.length).toBe(1);
    expect((gameEvents[0] as { type?: string }).type).toBe('PHASE_CHANGED');
    expect((gameEvents[0] as { visibility?: string }).visibility).toBe('PUBLIC');
    expect(JSON.stringify(gameEvents)).not.toContain('MAFIA');
    ws.close();
  });

  it('AC2: a token-carrying joiner (?token=x-admin-token / Bearer / X-Admin-Token header) still receives the full feed', async () => {
    setAdminAuthOverride(TEST_TOKEN);
    const gameId = 'g-ws-auth-token';

    // Transport 1: ?token= query param (browser-native).
    const viaQuery = connectAndCollect({ gameId, url: `${h.url}?token=${TEST_TOKEN}` });
    await waitConnected(viaQuery.ws);
    // Transport 2: X-Admin-Token header (server-side clients).
    const viaHeader = connectAndCollect({ gameId, headers: { 'x-admin-token': TEST_TOKEN } });
    await waitConnected(viaHeader.ws);
    // Transport 3: Authorization: Bearer header.
    const viaBearer = connectAndCollect({ gameId, headers: { authorization: `Bearer ${TEST_TOKEN}` } });
    await waitConnected(viaBearer.ws);
    await awaitJoin(gameId, 3);

    h.eventBus.publish(makeEvent(gameId, 'AGENT_THINK_STARTED', 'ADMIN'));
    h.eventBus.publish(makeEvent(gameId, 'PHASE_CHANGED', 'PUBLIC'));
    h.eventBus.publish(makeEvent(gameId, 'VOTE_CAST', 'PRIVATE'));

    for (const c of [viaQuery, viaHeader, viaBearer]) {
      const got = await waitFor(() => c.gameEvents.length >= 3);
      expect(got).toBe(true);
      // Pre-existing fanout quirk (DF-34 scope note): each joiner's own EventBus
      // callback calls broadcastToGame, so with N joiners every client receives
      // each event N times. The AC is about WHICH visibilities get through —
      // assert the deduped set, not the raw sequence.
      const visibilities = [...new Set(c.gameEvents.map((e) => (e as { visibility?: string }).visibility))];
      expect(visibilities.sort()).toEqual(['ADMIN', 'PRIVATE', 'PUBLIC']);
    }
    viaQuery.ws.close();
    viaHeader.ws.close();
    viaBearer.ws.close();
  });

  it('AC2-negative: a WRONG token does not unlock ADMIN frames', async () => {
    setAdminAuthOverride(TEST_TOKEN);
    const gameId = 'g-ws-auth-wrong-token';
    const { ws, gameEvents } = connectAndCollect({ gameId, url: `${h.url}?token=wrong-token` });
    await waitConnected(ws);
    await awaitJoin(gameId, 1);

    h.eventBus.publish(makeEvent(gameId, 'AGENT_THINK_STARTED', 'ADMIN'));
    h.eventBus.publish(makeEvent(gameId, 'PHASE_CHANGED', 'PUBLIC'));

    const gotPublic = await waitFor(() => gameEvents.length >= 1);
    expect(gotPublic).toBe(true);
    await waitFor(() => gameEvents.length > 1, 400);
    expect(gameEvents.length).toBe(1);
    expect((gameEvents[0] as { visibility?: string }).visibility).toBe('PUBLIC');
    ws.close();
  });

  it('opt-in contract: with ADMIN_AUTH_TOKEN UNSET, anonymous joiners keep receiving ADMIN frames (unchanged legacy behavior)', async () => {
    setAdminAuthOverride(null); // auth DISABLED
    const gameId = 'g-ws-auth-disabled';
    const { ws, gameEvents } = connectAndCollect({ gameId });
    await waitConnected(ws);
    await awaitJoin(gameId, 1);

    h.eventBus.publish(makeEvent(gameId, 'AGENT_THINK_STARTED', 'ADMIN'));
    h.eventBus.publish(makeEvent(gameId, 'PHASE_CHANGED', 'PUBLIC'));

    const got = await waitFor(() => gameEvents.length >= 2);
    expect(got).toBe(true);
    const visibilities = gameEvents.map((e) => (e as { visibility?: string }).visibility);
    expect(visibilities).toEqual(['ADMIN', 'PUBLIC']);
    ws.close();
  });

  it('mixed audience: same published events, disjoint delivery (clamped anon vs authorized token client)', async () => {
    setAdminAuthOverride(TEST_TOKEN);
    const gameId = 'g-ws-auth-mixed';
    const anon = connectAndCollect({ gameId });
    const admin = connectAndCollect({ gameId, url: `${h.url}?token=${TEST_TOKEN}` });
    await waitConnected(anon.ws);
    await waitConnected(admin.ws);
    await awaitJoin(gameId, 2);

    h.eventBus.publish(makeEvent(gameId, 'AGENT_THINK_STARTED', 'ADMIN'));
    h.eventBus.publish(makeEvent(gameId, 'PHASE_CHANGED', 'PUBLIC'));

    const adminGot = await waitFor(() => admin.gameEvents.length >= 2);
    expect(adminGot).toBe(true);
    // Fanout note: N joiners => every client receives each event N times.
    // The AC is the per-client CLAMP: anon's deduped set is PUBLIC-only,
    // the admin client's deduped set contains the ADMIN frame.
    const anonVis = [...new Set(anon.gameEvents.map((e) => (e as { visibility?: string }).visibility))];
    expect(anonVis).toEqual(['PUBLIC']);
    const adminVis = [...new Set(admin.gameEvents.map((e) => (e as { visibility?: string }).visibility))];
    expect(adminVis.sort()).toEqual(['ADMIN', 'PUBLIC']);
    anon.ws.close();
    admin.ws.close();
  });

  it('broadcastToAll carries the same per-client clamp', async () => {
    setAdminAuthOverride(TEST_TOKEN);
    const gameId = 'g-ws-auth-broadcast-all';
    const anon = connectAndCollect({ gameId });
    await waitConnected(anon.ws);
    await awaitJoin(gameId, 1);

    // Client-visible BROADCAST frames route through broadcastToAll.
    h.handler.broadcastToAll(makeEvent(gameId, 'AGENT_THINK_STARTED', 'ADMIN') as unknown as Record<string, unknown>);
    h.handler.broadcastToAll(makeEvent(gameId, 'PHASE_CHANGED', 'PUBLIC') as unknown as Record<string, unknown>);

    // Collect BROADCAST frames (connectAndCollect only traps GAME_EVENT).
    const seen: string[] = [];
    anon.ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'BROADCAST') seen.push((msg.payload as { visibility?: string }).visibility ?? 'unknown');
    });
    await waitFor(() => seen.length >= 1);
    // Only the PUBLIC broadcast may have been delivered to the anon client.
    expect(seen).toEqual(['PUBLIC']);
    anon.ws.close();
  });
});