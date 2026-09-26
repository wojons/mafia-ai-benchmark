/**
 * WebSocket SUBSCRIBE {gameId} alias regression (DF-MAFIA-AI-BENCHMARK-19).
 *
 * A WS client that sends SUBSCRIBE {gameId} used to get a SUBSCRIBED ack
 * (eventTypes: undefined) while NOTHING was registered — the real per-game
 * channel was JOIN_GAME only. Pre-fix, zero GAME_EVENT frames arrive for such
 * a client. Post-fix, SUBSCRIBE {gameId} aliases to the JOIN_GAME
 * registration: the client is registered against the game's EventBus stream
 * and receives GAME_EVENT frames, and the SUBSCRIBED ack echoes
 * { eventTypes: ['GAME_EVENT'], gameId }.
 *
 * Plain SUBSCRIBE {eventTypes} behavior is byte-identical to before.
 *
 * Same harness shape as websocket-spectate.test.ts: real WebSocketHandler
 * over real sockets with a real EventBus.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
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
    data: { note: 'subscribe-alias-test-event' },
    metadata: { turnNumber: 1, dayNumber: 1, phase: 'DAY_DISCUSSION', sequence: 1 },
  } as unknown as GameEvent;
}

let h: TestHarness;

beforeAll(async () => {
  const eventBus = new EventBus();
  const context = {
    gameEngine: {
      getGameState: () => ({ gameId: 'g-alias', status: 'RUNNING' }),
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

interface Collecting {
  ws: WebSocket;
  gameEvents: Array<Record<string, unknown>>;
  all: Array<Record<string, unknown>>;
}

/** Connect and collect every message (and GAME_EVENT payloads separately). */
function connectAndCollect(): Collecting {
  const ws = new WebSocket(h.url);
  const gameEvents: Array<Record<string, unknown>> = [];
  const all: Array<Record<string, unknown>> = [];
  ws.on('message', (data: Buffer) => {
    const msg = JSON.parse(data.toString());
    all.push(msg);
    if (msg.type === 'GAME_EVENT') gameEvents.push(msg.payload);
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

describe('WebSocket SUBSCRIBE {gameId} alias (DF-MAFIA-AI-BENCHMARK-19)', () => {
  afterEach(async () => {
    for (const client of (h.wss.clients as Set<WebSocket>)) {
      client.terminate();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('AC1: SUBSCRIBE {gameId} aliases to JOIN_GAME — SUBSCRIBED ack carries eventTypes + gameId, and GAME_EVENT frames actually arrive', async () => {
    const gameId = 'g-alias-solo';
    const { ws, gameEvents, all } = connectAndCollect();
    await waitConnected(ws);

    ws.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { gameId } }));

    // Wait for the alias registration to settle (registered against the game).
    const registered = await waitFor(() => h.handler.getClientsInGame(gameId).length === 1);
    expect(registered).toBe(true);

    // Ack shape: SUBSCRIBED with eventTypes ['GAME_EVENT'] and the echoed gameId.
    const ack = all.find((m) => (m as { type?: string }).type === 'SUBSCRIBED');
    expect(ack).toBeDefined();
    const ackPayload = (ack as { payload?: { eventTypes?: string[]; gameId?: string } }).payload;
    expect(ackPayload?.eventTypes).toEqual(['GAME_EVENT']);
    expect(ackPayload?.gameId).toBe(gameId);

    // Live behavior: events published for that game reach this client.
    h.eventBus.publish(makeFakeGameEvent(gameId, 'PHASE_CHANGED'));
    h.eventBus.publish(makeFakeGameEvent(gameId, 'VOTE_CAST'));

    const got = await waitFor(() => gameEvents.length >= 2);
    expect(got).toBe(true);
    expect((gameEvents[0] as { type?: string }).type).toBe('PHASE_CHANGED');
    expect((gameEvents[1] as { type?: string }).type).toBe('VOTE_CAST');
    expect((gameEvents[0] as { gameId?: string }).gameId).toBe(gameId);
  });

  it('AC2: SUBSCRIBE {game_id} (snake_case) aliases the same way', async () => {
    const gameId = 'g-alias-snake';
    const { ws, gameEvents, all } = connectAndCollect();
    await waitConnected(ws);

    ws.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { game_id: gameId } }));

    const registered = await waitFor(() => h.handler.getClientsInGame(gameId).length === 1);
    expect(registered).toBe(true);

    const ack = all.find((m) => (m as { type?: string }).type === 'SUBSCRIBED');
    const ackPayload = (ack as { payload?: { eventTypes?: string[]; gameId?: string } }).payload;
    expect(ackPayload?.eventTypes).toEqual(['GAME_EVENT']);
    expect(ackPayload?.gameId).toBe(gameId);

    h.eventBus.publish(makeFakeGameEvent(gameId, 'PHASE_CHANGED'));
    const got = await waitFor(() => gameEvents.length >= 1);
    expect(got).toBe(true);
  });

  it('AC3: plain SUBSCRIBE {eventTypes} is unchanged — ack echoes eventTypes and registers NO game (no GAME_EVENT frames)', async () => {
    const gameId = 'g-alias-plain';
    const { ws, gameEvents, all } = connectAndCollect();
    await waitConnected(ws);

    ws.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { eventTypes: ['GAME_STATE', 'VOTE_CAST'] } }));

    // Ack echo unchanged (byte-identical contract: { eventTypes } only, no gameId field).
    const acked = await waitFor(() => all.some((m) => (m as { type?: string }).type === 'SUBSCRIBED'));
    expect(acked).toBe(true);
    const ack = all.find((m) => (m as { type?: string }).type === 'SUBSCRIBED');
    const ackPayload = (ack as { payload?: { eventTypes?: string[]; gameId?: string } }).payload;
    expect(ackPayload?.eventTypes).toEqual(['GAME_STATE', 'VOTE_CAST']);
    expect(ackPayload).not.toHaveProperty('gameId');

    // No game registration happened for this client.
    expect(h.handler.getClientsInGame(gameId).length).toBe(0);

    // And events for a game do NOT reach a plain eventTypes subscriber.
    h.eventBus.publish(makeFakeGameEvent(gameId, 'PHASE_CHANGED'));
    const leaked = await waitFor(() => gameEvents.length >= 1, 500);
    expect(leaked).toBe(false);
    expect(gameEvents.length).toBe(0);
  });

  it('AC4: after aliasing, LEAVE_GAME stops the aliased stream and re-JOIN_GAME works', async () => {
    const gameId = 'g-alias-leave';
    const { ws, gameEvents } = connectAndCollect();
    await waitConnected(ws);

    ws.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { gameId } }));
    await waitFor(() => h.handler.getClientsInGame(gameId).length === 1);

    h.eventBus.publish(makeFakeGameEvent(gameId, 'PHASE_CHANGED'));
    const first = await waitFor(() => gameEvents.length >= 1);
    expect(first).toBe(true);

    ws.send(JSON.stringify({ type: 'LEAVE_GAME', payload: {} }));
    await waitFor(() => h.handler.getClientsInGame(gameId).length === 0);

    h.eventBus.publish(makeFakeGameEvent(gameId, 'VOTE_CAST'));
    const leaked = await waitFor(() => gameEvents.length >= 2, 500);
    expect(leaked).toBe(false);

    // Real JOIN_GAME still works on the same connection.
    ws.send(JSON.stringify({ type: 'JOIN_GAME', payload: { gameId } }));
    await waitFor(() => h.handler.getClientsInGame(gameId).length === 1);

    h.eventBus.publish(makeFakeGameEvent(gameId, 'GAME_ENDED'));
    const rejoined = await waitFor(() => gameEvents.length >= 2);
    expect(rejoined).toBe(true);
    expect((gameEvents[1] as { type?: string }).type).toBe('GAME_ENDED');
  });
});