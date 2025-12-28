/**
 * EventBus Unit Tests
 * 
 * Tests for the EventBus publish/subscribe mechanism.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../../services/event-bus';
import { GameEvent } from '@mafia/shared/types';

// Mock GameEvent factory
function createMockEvent(type: string, data: Record<string, unknown> = {}): GameEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: type as GameEvent['type'],
    gameId: data.gameId as string || 'game-test',
    visibility: 'PUBLIC',
    data,
    timestamp: new Date(),
    metadata: {
      turnNumber: 1,
      dayNumber: 1,
      phase: 'SETUP',
      sequence: 1,
    },
  };
}

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus(100);
  });

  describe('Subscription', () => {
    it('should subscribe to a single event type', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribe('GAME_CREATED', handler);

      expect(unsubscribe).toBeDefined();
      expect(typeof unsubscribe).toBe('function');
    });

    it('should subscribe to multiple event types', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribe(['GAME_CREATED', 'PLAYER_JOINED'], handler);

      expect(unsubscribe).toBeDefined();
    });

    it('should subscribe to all events (wildcard)', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribeAll(handler);

      expect(unsubscribe).toBeDefined();
    });

    it('should subscribe once for a single event', () => {
      const handler = vi.fn();
      eventBus.once('GAME_CREATED', handler);

      const event = createMockEvent('GAME_CREATED');
      eventBus.publish(event);
      eventBus.publish(event);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should support event filters', () => {
      const handler = vi.fn();
      const filter = (event: GameEvent) => event.metadata.dayNumber === 1;
      
      eventBus.subscribe('PHASE_CHANGED', handler, { filter });

      const day1Event = createMockEvent('PHASE_CHANGED', { dayNumber: 1 });
      const day2Event = createMockEvent('PHASE_CHANGED', { dayNumber: 2 });

      eventBus.publish(day1Event);
      eventBus.publish(day2Event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(day1Event);
    });

    it('should return unsubscribe function that works', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribe('GAME_CREATED', handler);

      const event = createMockEvent('GAME_CREATED');
      eventBus.publish(event);
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      eventBus.publish(event);
      expect(handler).toHaveBeenCalledTimes(1); // Should still be 1
    });
  });

  describe('Publishing', () => {
    it('should publish event to subscribed handlers', () => {
      const handler = vi.fn();
      eventBus.subscribe('GAME_CREATED', handler);

      const event = createMockEvent('GAME_CREATED');
      eventBus.publish(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should publish to multiple subscribers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.subscribe('GAME_CREATED', handler1);
      eventBus.subscribe('GAME_CREATED', handler2);

      const event = createMockEvent('GAME_CREATED');
      eventBus.publish(event);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should publish to wildcard subscribers', () => {
      const wildcardHandler = vi.fn();
      const specificHandler = vi.fn();
      
      eventBus.subscribeAll(wildcardHandler);
      eventBus.subscribe('GAME_CREATED', specificHandler);

      const event = createMockEvent('GAME_CREATED');
      eventBus.publish(event);

      expect(wildcardHandler).toHaveBeenCalledTimes(1);
      expect(specificHandler).toHaveBeenCalledTimes(1);
    });

    it('should publish to array-subscribed handlers', () => {
      const handler = vi.fn();
      eventBus.subscribe(['GAME_CREATED', 'PLAYER_JOINED'], handler);

      const event1 = createMockEvent('GAME_CREATED');
      const event2 = createMockEvent('PLAYER_JOINED');

      eventBus.publish(event1);
      eventBus.publish(event2);

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should continue publishing even if handler throws', () => {
      const badHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const goodHandler = vi.fn();
      
      eventBus.subscribe('GAME_CREATED', badHandler);
      eventBus.subscribe('GAME_CREATED', goodHandler);

      const event = createMockEvent('GAME_CREATED');
      
      // Should not throw
      expect(() => eventBus.publish(event)).not.toThrow();
      
      expect(badHandler).toHaveBeenCalledTimes(1);
      expect(goodHandler).toHaveBeenCalledTimes(1);
    });

    it('should not call handlers after unsubscribe', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribe('GAME_CREATED', handler);

      const event = createMockEvent('GAME_CREATED');
      eventBus.publish(event);
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();
      eventBus.publish(event);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Event History', () => {
    it('should store events in history', () => {
      const event = createMockEvent('GAME_CREATED');
      eventBus.publish(event);

      const history = eventBus.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].id).toBe(event.id);
    });

    it('should limit history size', () => {
      // Create bus with max 3 events
      const smallBus = new EventBus(3);
      
      for (let i = 0; i < 5; i++) {
        smallBus.publish(createMockEvent('GAME_CREATED'));
      }

      const history = smallBus.getHistory();
      expect(history.length).toBe(3);
    });

    it('should filter history by event type', () => {
      eventBus.publish(createMockEvent('GAME_CREATED'));
      eventBus.publish(createMockEvent('PLAYER_JOINED'));
      eventBus.publish(createMockEvent('GAME_CREATED'));

      const history = eventBus.getHistory({ eventType: 'GAME_CREATED' });
      expect(history.length).toBe(2);
      expect(history.every(e => e.type === 'GAME_CREATED')).toBe(true);
    });

    it('should filter history by game ID', () => {
      const event1 = createMockEvent('GAME_CREATED', { gameId: 'game-1' });
      const event2 = createMockEvent('GAME_CREATED', { gameId: 'game-2' });
      
      eventBus.publish(event1);
      eventBus.publish(event2);

      const history = eventBus.getHistory({ gameId: 'game-1' });
      expect(history.length).toBe(1);
      expect(history[0].data.gameId).toBe('game-1');
    });

    it('should limit history results', () => {
      for (let i = 0; i < 10; i++) {
        eventBus.publish(createMockEvent('GAME_CREATED'));
      }

      const history = eventBus.getHistory({ limit: 5 });
      expect(history.length).toBe(5);
    });

    it('should clear history', () => {
      eventBus.publish(createMockEvent('GAME_CREATED'));
      eventBus.publish(createMockEvent('PLAYER_JOINED'));

      expect(eventBus.getHistory().length).toBe(2);

      eventBus.clearHistory();

      expect(eventBus.getHistory().length).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should track total events', () => {
      eventBus.publish(createMockEvent('GAME_CREATED'));
      eventBus.publish(createMockEvent('PLAYER_JOINED'));
      eventBus.publish(createMockEvent('GAME_CREATED'));

      const stats = eventBus.getStats();
      expect(stats.totalEvents).toBe(3);
    });

    it('should track events by type', () => {
      eventBus.publish(createMockEvent('GAME_CREATED'));
      eventBus.publish(createMockEvent('GAME_CREATED'));
      eventBus.publish(createMockEvent('PLAYER_JOINED'));

      const stats = eventBus.getStats();
      expect(stats.eventsByType.get('GAME_CREATED')).toBe(2);
      expect(stats.eventsByType.get('PLAYER_JOINED')).toBe(1);
    });

    it('should track total subscriptions', () => {
      eventBus.subscribe('GAME_CREATED', vi.fn());
      eventBus.subscribe('PLAYER_JOINED', vi.fn());
      eventBus.subscribeAll(vi.fn());

      const stats = eventBus.getStats();
      expect(stats.totalSubscriptions).toBe(3);
    });
  });

  describe('Clear All', () => {
    it('should clear all subscriptions', () => {
      eventBus.subscribe('GAME_CREATED', vi.fn());
      eventBus.subscribeAll(vi.fn());

      eventBus.clearAll();

      const stats = eventBus.getStats();
      expect(stats.totalSubscriptions).toBe(0);
    });

    it('should clear event history', () => {
      eventBus.publish(createMockEvent('GAME_CREATED'));
      eventBus.publish(createMockEvent('PLAYER_JOINED'));

      eventBus.clearAll();

      expect(eventBus.getHistory().length).toBe(0);
    });

    it('should reset stats', () => {
      eventBus.publish(createMockEvent('GAME_CREATED'));
      eventBus.publish(createMockEvent('PLAYER_JOINED'));

      eventBus.clearAll();

      const stats = eventBus.getStats();
      expect(stats.totalEvents).toBe(0);
      expect(stats.eventsByType.size).toBe(0);
    });
  });

  describe('Get Game Events', () => {
    beforeEach(() => {
      eventBus.publish(createMockEvent('GAME_CREATED', { gameId: 'game-1' }));
      eventBus.publish(createMockEvent('PHASE_CHANGED', { gameId: 'game-1' }));
      eventBus.publish(createMockEvent('PLAYER_JOINED', { gameId: 'game-2' }));
      eventBus.publish(createMockEvent('PHASE_CHANGED', { gameId: 'game-1' }));
    });

    it('should get events for specific game', () => {
      const events = eventBus.getGameEvents('game-1');
      expect(events.length).toBe(3);
      expect(events.every(e => e.gameId === 'game-1')).toBe(true);
    });

    it('should filter by event type', () => {
      const events = eventBus.getGameEvents('game-1', { eventType: 'PHASE_CHANGED' });
      expect(events.length).toBe(2);
      expect(events.every(e => e.type === 'PHASE_CHANGED')).toBe(true);
    });

    it('should limit results', () => {
      const events = eventBus.getGameEvents('game-1', { limit: 2 });
      expect(events.length).toBe(2);
    });
  });

  describe('Unsubscribe', () => {
    it('should unsubscribe by ID', () => {
      const handler = vi.fn();
      const sub = eventBus.subscribe('GAME_CREATED', handler);
      
      const event = createMockEvent('GAME_CREATED');
      eventBus.publish(event);
      expect(handler).toHaveBeenCalledTimes(1);

      const result = eventBus.unsubscribe(sub.id);
      expect(result).toBe(true);

      eventBus.publish(event);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should return false for non-existent subscription', () => {
      const result = eventBus.unsubscribe('non-existent-id');
      expect(result).toBe(false);
    });

    it('should unsubscribe wildcard handlers', () => {
      const handler = vi.fn();
      const sub = eventBus.subscribeAll(handler);
      
      eventBus.publish(createMockEvent('GAME_CREATED'));
      expect(handler).toHaveBeenCalledTimes(1);

      eventBus.unsubscribe(sub.id);
      eventBus.publish(createMockEvent('PLAYER_JOINED'));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
