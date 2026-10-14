/**
 * WS connection watchdog tests (DF-MAFIA-AI-BENCHMARK-31).
 *
 * The blank watch view failure was a half-open socket: readyState OPEN, no
 * inbound frames, onclose never fired, UI frozen with zero output. These
 * tests pin the service-level watchdog on a REAL WebSocketService over an
 * injected fake WebSocket transport:
 *  - inbound frames restart the idle window;
 *  - silence past the window fires STALE_CONNECTION + closes + reconnects;
 *  - a normal server close emits DISCONNECTED then RECONNECTING;
 *  - disconnect() clears the watchdog without emitting STALE_CONNECTION.
 * And the hook surface (useConnectionWatchdog) via an inline render harness
 * (no @testing-library dependency — the repo deliberately has none):
 *  - stale/reconnecting mirror into React state, onStale fires once per
 *    episode;
 *  - CONNECTED recovery clears the state;
 *  - the hook is inert without a gameId.
 */
import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { WebSocketService, defaultWebsocketFactory, websocket } from '../services/websocket';
import { useConnectionWatchdog } from '../hooks/useConnectionWatchdog';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- fake WebSocket transport -------------------------------------------------

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState: number = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    // Real sockets fire onclose after close(); the watchdog relies on this.
    this.onclose?.({ code: 1006, reason: '' });
    this.onclose = null;
  }

  // Test drivers
  serverOpen() {
    this.onopen?.();
  }
  serverFrame(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  serverClose(code = 1006, reason = '') {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code, reason });
    this.onclose = null;
  }
}

let factory: (url: string) => WebSocket = defaultWebsocketFactory;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  factory = (url: string) => new FakeWebSocket(url) as unknown as WebSocket;
  FakeWebSocket.instances = [];
  // Clean the shared singleton between hook tests.
  websocket.disconnect();
  websocket.off('CONNECTED');
  websocket.off('DISCONNECTED');
  websocket.off('STALE_CONNECTION');
  websocket.off('RECONNECTING');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function lastWs(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

// Advance fake timers; returns a promise so awaiting keeps the act-free
// service tests deterministic.
async function advance(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
}

function makeService(): WebSocketService {
  return new WebSocketService('ws://test/ws', { wsFactory: factory, watchdogIdleMs: 1000 });
}

// ---- service-level watchdog ---------------------------------------------------

describe('WebSocketService connection watchdog (DF-MAFIA-AI-BENCHMARK-31)', () => {
  it('idle socket past watchdogIdleMs fires STALE_CONNECTION, closes and reconnects', async () => {
    const service = makeService();
    const staleHandler = vi.fn();
    const reconnectingHandler = vi.fn();
    const disconnectedHandler = vi.fn();
    service.on('STALE_CONNECTION', staleHandler);
    service.on('RECONNECTING', reconnectingHandler);
    service.on('DISCONNECTED', disconnectedHandler);

    const connectPromise = service.connect();
    const first = lastWs();
    first.serverOpen();
    await connectPromise;

    // Silence past the 1000ms idle window: stale is announced, the dead
    // socket is force-closed, and onclose performs the reconnect handshake.
    await advance(1100);

    expect(staleHandler).toHaveBeenCalledTimes(1);
    expect(disconnectedHandler).toHaveBeenCalledTimes(1);
    expect(first.closed).toBe(true);
    expect(reconnectingHandler).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1 }),
    );

    // The scheduled reconnect timer creates the replacement socket.
    await advance(1000);
    expect(FakeWebSocket.instances.length).toBe(2);
    service.disconnect();
  });

  it('inbound frames restart the idle window — an active feed never goes stale', async () => {
    const service = makeService();
    const staleHandler = vi.fn();
    service.on('STALE_CONNECTION', staleHandler);

    const connectPromise = service.connect();
    const ws = lastWs();
    ws.serverOpen();
    await connectPromise;

    // Dribble frames every 500ms for 5s (idle window is 1s) — never stale.
    for (let i = 0; i < 10; i++) {
      await advance(500);
      ws.serverFrame({ type: 'GAME_EVENT', payload: { n: i } });
    }
    expect(staleHandler).not.toHaveBeenCalled();
    // No reconnect attempts happened either.
    expect(FakeWebSocket.instances.length).toBe(1);
    service.disconnect();
  });

  it('boundary: a frame at 800ms is fine; silence past the restarted window goes stale', async () => {
    const service = makeService();
    const staleHandler = vi.fn();
    service.on('STALE_CONNECTION', staleHandler);

    const connectPromise = service.connect();
    const ws = lastWs();
    ws.serverOpen();
    await connectPromise;

    await advance(800);
    ws.serverFrame({ type: 'PONG', payload: {} }); // window restarts
    await advance(800); // t=1600, only 800ms since the last frame — fine
    expect(staleHandler).not.toHaveBeenCalled();

    await advance(1100); // t=2700, 1900ms since last frame -> stale at 1800
    expect(staleHandler).toHaveBeenCalledTimes(1);
    service.disconnect();
  });

  it('server close emits DISCONNECTED then RECONNECTING with attempt metadata', async () => {
    const service = makeService();
    const disconnected = vi.fn();
    const reconnecting = vi.fn();
    service.on('DISCONNECTED', disconnected);
    service.on('RECONNECTING', reconnecting);

    const connectPromise = service.connect();
    const ws = lastWs();
    ws.serverOpen();
    await connectPromise;

    ws.serverClose(1006, 'boom');
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(reconnecting).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, maxAttempts: 5 }),
    );
    await advance(1000);
    expect(FakeWebSocket.instances.length).toBe(2);
    service.disconnect();
  });

  it('disconnect() clears the watchdog — no STALE_CONNECTION after explicit close', async () => {
    const service = makeService();
    const staleHandler = vi.fn();
    service.on('STALE_CONNECTION', staleHandler);

    const connectPromise = service.connect();
    const ws = lastWs();
    ws.serverOpen();
    await connectPromise;

    service.disconnect();
    await advance(5000);
    expect(staleHandler).not.toHaveBeenCalled();
  });
});

// ---- hook surface (inline harness — no @testing-library dep) -------------------

describe('useConnectionWatchdog (DF-MAFIA-AI-BENCHMARK-31)', () => {
  type WatchdogState = ReturnType<typeof useConnectionWatchdog>;

  function renderWatchdog(gameId: string | null, onStale?: () => void) {
    const result: { current: WatchdogState | null } = { current: null };
    function Probe() {
      result.current = useConnectionWatchdog(gameId, onStale);
      return null;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => {
      root.render(<Probe />);
    });
    return {
      result,
      unmount: () =>
        act(() => {
          root.unmount();
        }),
    };
  }

  it('mirrors stale + reconnecting state and fires onStale exactly once per episode', async () => {
    const onStale = vi.fn();
    const { result, unmount } = renderWatchdog('game-1', onStale);
    expect(result.current?.stale).toBe(false);

    // Simulate the service announcing staleness (the service tests above pin
    // the trigger; here we pin the hook's REACTION through the singleton's
    // public emit — the same path the internal watchdog uses).
    act(() => {
      websocket.emit('STALE_CONNECTION', { idleMs: 45000 });
    });
    expect(result.current?.stale).toBe(true);
    expect(result.current?.reconnecting).toBe(true);
    expect(onStale).toHaveBeenCalledTimes(1);

    // A duplicate announce within the same episode must not double-fire
    // onStale (a mid-game re-fetch loop is what we are guarding against).
    act(() => {
      websocket.emit('STALE_CONNECTION', { idleMs: 45000 });
    });
    expect(onStale).toHaveBeenCalledTimes(1);

    // Recovery (fresh CONNECTED) clears the state and closes the episode.
    act(() => {
      websocket.emit('CONNECTED', { timestamp: new Date().toISOString() });
    });
    expect(result.current?.stale).toBe(false);
    expect(result.current?.reconnecting).toBe(false);

    // A second stale episode fires onStale again — exactly once.
    act(() => {
      websocket.emit('STALE_CONNECTION', { idleMs: 45000 });
    });
    expect(onStale).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('DISCONNECTED alone shows the reconnecting indicator (no stale)', async () => {
    const { result, unmount } = renderWatchdog('game-1');
    act(() => {
      websocket.emit('DISCONNECTED', { code: 1006, reason: '' });
    });
    expect(result.current?.reconnecting).toBe(true);
    expect(result.current?.stale).toBe(false);
    unmount();
  });

  it('CONNECTED clears the reconnecting indicator', async () => {
    const { result, unmount } = renderWatchdog('game-1');
    act(() => {
      websocket.emit('DISCONNECTED', { code: 1006, reason: '' });
    });
    expect(result.current?.reconnecting).toBe(true);
    act(() => {
      websocket.emit('CONNECTED', { timestamp: new Date().toISOString() });
    });
    expect(result.current?.reconnecting).toBe(false);
    unmount();
  });

  it('is inert without a gameId', () => {
    const { result, unmount } = renderWatchdog(null);
    act(() => {
      websocket.emit('STALE_CONNECTION', { idleMs: 45000 });
      websocket.emit('DISCONNECTED', { code: 1006, reason: '' });
    });
    expect(result.current?.stale).toBe(false);
    expect(result.current?.reconnecting).toBe(false);
    unmount();
  });
});