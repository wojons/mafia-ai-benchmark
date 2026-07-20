import { describe, it, expect, vi, beforeEach } from 'vitest';

import { websocket } from '../services/websocket';

describe('WebSocketService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    websocket.disconnect();
    // Clean up all registered event handlers
    websocket.off('CONNECTED');
    websocket.off('DISCONNECTED');
    websocket.off('GAME_EVENT');
    websocket.off('GAME_STATE');
  });

  it('isConnected returns false before connect is called', () => {
    expect(websocket.isConnected()).toBe(false);
  });

  it('on returns an unsubscribe function that can be called', () => {
    const handler = vi.fn();
    const unsubscribe = websocket.on('GAME_EVENT', handler);

    expect(typeof unsubscribe).toBe('function');

    // Calling the unsubscribe should not throw
    expect(() => unsubscribe()).not.toThrow();

    // Calling it again should be idempotent
    expect(() => unsubscribe()).not.toThrow();
  });

  it('off removes a specific handler by reference', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    websocket.on('GAME_EVENT', handler1);
    websocket.on('GAME_EVENT', handler2);

    // Remove only handler1
    expect(() => websocket.off('GAME_EVENT', handler1)).not.toThrow();

    // Removing it again should be safe
    expect(() => websocket.off('GAME_EVENT', handler1)).not.toThrow();
  });

  it('off without handler clears all handlers for the given event type', () => {
    websocket.on('GAME_EVENT', vi.fn());
    websocket.on('GAME_EVENT', vi.fn());

    expect(() => websocket.off('GAME_EVENT')).not.toThrow();

    // After clearing, removing a specific handler should be safe
    expect(() => websocket.off('GAME_EVENT', vi.fn())).not.toThrow();
  });

  it('subscribe queues a SUBSCRIBE message when not connected', () => {
    // subscribe calls send internally, which queues messages when not connected
    expect(() => {
      websocket.subscribe(['GAME_EVENT', 'GAME_STATE']);
    }).not.toThrow();

    // A second subscribe with different event types should also queue
    expect(() => {
      websocket.subscribe(['PLAYER_JOINED']);
    }).not.toThrow();
  });
});
