/**
 * WebSocket live spectate (DF-MAFIA-AI-BENCHMARK-16).
 *
 * A WS client that sends JOIN_GAME for a running game must receive GAME_EVENT
 * frames when the legacy adapter publishes events on the EventBus. The EventBus
 * is event-TYPE-keyed (the adapter publishes by event type like
 * 'PHASE_CHANGED'/'GAME_ENDED'), so the old `game:<id>` topic subscription
 * never fired and the callback's excludeClientId additionally excluded the
 * joiner itself. These tests drive the real WebSocketHandler over real
 * sockets with a real EventBus, publishing fake game events with matching
 * gameId, and assert the joiner(s) receive the GAME_EVENT envelope.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { WebSocketHandler } from '../websocket/index.js';
import { EventBus } from '../services/event-bus.js';
import type { ServerContext } from '../index.js';
import type { GameEvent } from '@mafia/shared/types';

const TEST_PORT = 0; // ephemeral

interface TestHarness {
  wss: WebSocketServer;
  handler: WebSocketHandler;
  eventBus: EventBus;
  url: string;
  server: import('http').Server;
}

function makeFakeGameEvent(gameId: string, type: string): GameEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    gameId,
    type: type as GameEvent['type'],
    timestamp: new Date(),
    visibility: 'PUBLIC',
    data: { note: 'spectate-test-event' },
    metadata: { turnNumber: 1, dayNumber: 1, phase: 'DAY_DISCUSSION', sequence: 1 },
  } as unknown as GameEvent;
}

let h: TestHarness;

beforeAll(async () => {
  const eventBus = new EventBus();
  const context = {
    gameEngine: {
      getGameState: () => ({ gameId: 'g-spectate', status: 'RUNNING' }),
    },
    eventBus,
  } as unknown as ServerContext;

  const server = await new Promise<import('http').Server>((resolve) => {
    const { createServer } = require('http') as typeof import('http');
    const s = createServer();
    s.listen(TEST_PORT, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  const wss = new WebSocketServer({ server });
  const handler = new WebSocketHandler(wss, context);
  h = { wss, handler, eventBus, url: `ws://127.0.0.1:${port}`, server };
});

afterAll(async () => {
  h.wss.close();
  await new Promise<void>((resolve) => h.server.close(() => resolve()));
});

/** Collect GAME_EVENT frames from a client into an array (pushed in order). */
function connectAndCollect(
  gameId: string | null,
): { ws: WebSocket; gameEvents: Array<Record<string, unknown>>; all: string[] } {
  const ws = new WebSocket(h.url);
  const gameEvents: Array<Record<string, unknown>> = [];
  const all: string[] = [];
  ws.on('message', (data: Buffer) => {
    const msg = JSON.parse(data.toString());
    all.push(msg.type);
    if (msg.type === 'GAME_EVENT') gameEvents.push(msg.payload);
  });
  ws.on('open', () => {
    if (gameId) {
      ws.send(JSON.stringify({ type: 'JOIN_GAME', payload: { gameId } }));
    }
  });
  return { ws, gameEvents, all };
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

describe('WebSocket live spectate (DF-MAFIA-AI-BENCHMARK-16)', () => {
  beforeEach(() => {
    // Each test starts with a clean EventBus subscription surface.
    // WebSocketHandler clients are recreated per test via fresh connections.
  });

  afterEach(async () => {
    // Close any sockets opened during the test so handleDisconnect cleanup runs.
    for (const client of (h.wss.clients as Set<WebSocket>)) {
      client.terminate();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('AC1: a lone spectator receives GAME_EVENT frames for the game it joined (no self-exclusion)', async () => {
    const gameId = 'g-spectate-solo';
    const { ws, gameEvents } = connectAndCollect(gameId);
    await waitConnected(ws);

    // Wait for the join to settle, then publish a fake game event the adapter
    // would emit (by event TYPE — the EventBus's actual keying).
    const joined = await waitFor(() => {
      const clients = h.handler.getClientsInGame(gameId);
      return clients.length === 1;
    });
    expect(joined).toBe(true);

    h.eventBus.publish(makeFakeGameEvent(gameId, 'PHASE_CHANGED'));
    h.eventBus.publish(makeFakeGameEvent(gameId, 'GAME_ENDED'));

    const got = await waitFor(() => gameEvents.length >= 2);
    expect(got).toBe(true);
    expect(gameEvents.length).toBe(2);
    expect((gameEvents[0] as { type?: string }).type).toBe('PHASE_CHANGED');
    expect((gameEvents[1] as { type?: string }).type).toBe('GAME_ENDED');
    expect((gameEvents[0] as { gameId?: string }).gameId).toBe(gameId);
  });

  it('AC2: two clients joining the same game both receive the published events', async () => {
    const gameId = 'g-spectate-pair';
    const a = connectAndCollect(gameId);
    const b = connectAndCollect(gameId);
    await waitConnected(a.ws);
    await waitConnected(b.ws);

    const bothJoined = await waitFor(() => h.handler.getClientsInGame(gameId).length === 2);
    expect(bothJoined).toBe(true);

    h.eventBus.publish(makeFakeGameEvent(gameId, 'VOTE_CAST'));

    const gotA = await waitFor(() => a.gameEvents.length >= 1);
    const gotB = await waitFor(() => b.gameEvents.length >= 1);
    expect(gotA).toBe(true);
    expect(gotB).toBe(true);
    expect((a.gameEvents[0] as { type?: string }).type).toBe('VOTE_CAST');
    expect((b.gameEvents[0] as { type?: string }).type).toBe('VOTE_CAST');
  });

  it('does not deliver events for other games (gameId filter)', async () => {
    const gameId = 'g-spectate-mine';
    const { ws, gameEvents } = connectAndCollect(gameId);
    await waitConnected(ws);
    await waitFor(() => h.handler.getClientsInGame(gameId).length === 1);

    h.eventBus.publish(makeFakeGameEvent('g-someone-else', 'PHASE_CHANGED'));

    const none = await waitFor(() => gameEvents.length >= 1, 500);
    expect(none).toBe(false);
    expect(gameEvents.length).toBe(0);
  });

  it('AC3: LEAVE_GAME unsubscribes the EventBus listener — re-join works and events stop while away', async () => {
    const gameId = 'g-spectate-leave';
    const { ws, gameEvents } = connectAndCollect(gameId);
    await waitConnected(ws);
    await waitFor(() => h.handler.getClientsInGame(gameId).length === 1);

    h.eventBus.publish(makeFakeGameEvent(gameId, 'PHASE_CHANGED'));
    await waitFor(() => gameEvents.length >= 1);
    expect(gameEvents.length).toBe(1);

    // Leave: the subscription must be torn down.
    ws.send(JSON.stringify({ type: 'LEAVE_GAME', payload: {} }));
    await waitFor(() => h.handler.getClientsInGame(gameId).length === 0);

    h.eventBus.publish(makeFakeGameEvent(gameId, 'VOTE_CAST'));
    const leaked = await waitFor(() => gameEvents.length >= 2, 500);
    expect(leaked).toBe(false); // no event after leave => no leaked subscription

    // Re-join must deliver again (fresh subscription).
    ws.send(JSON.stringify({ type: 'JOIN_GAME', payload: { gameId } }));
    await waitFor(() => h.handler.getClientsInGame(gameId).length === 1);

    h.eventBus.publish(makeFakeGameEvent(gameId, 'GAME_ENDED'));
    const rejoined = await waitFor(() => gameEvents.length >= 2);
    expect(rejoined).toBe(true);
    expect((gameEvents[1] as { type?: string }).type).toBe('GAME_ENDED');
  });
});