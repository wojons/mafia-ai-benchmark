import { describe, it, expect, beforeEach } from 'vitest';
import { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';
import { createFakeEventBus, createFakeGameRepository } from './mocks.js';
import type { GameEvent } from '@mafia/shared/events';

describe('LegacyGameAdapter', () => {
  let eventBus: ReturnType<typeof createFakeEventBus>;
  let repo: ReturnType<typeof createFakeGameRepository>;
  let adapter: LegacyGameAdapter;

  beforeEach(() => {
    eventBus = createFakeEventBus();
    repo = createFakeGameRepository();
    adapter = new LegacyGameAdapter(eventBus, repo as any);
  });

  // ==========================================================================
  // getActiveGames
  // ==========================================================================

  describe('getActiveGames()', () => {
    it('returns empty array when no games are active', () => {
      expect(adapter.getActiveGames()).toEqual([]);
    });
  });

  // ==========================================================================
  // getGameState
  // ==========================================================================

  describe('getGameState()', () => {
    it('returns undefined for unknown game ID', () => {
      expect(adapter.getGameState('no-such-game')).toBeUndefined();
    });
  });

  // ==========================================================================
  // stopGame
  // ==========================================================================

  describe('stopGame()', () => {
    it('returns false for unknown game ID', () => {
      expect(adapter.stopGame('no-such-game')).toBe(false);
    });
  });

  // ==========================================================================
  // stopAll
  // ==========================================================================

  describe('stopAll()', () => {
    it('does not throw when no games are active', () => {
      expect(() => adapter.stopAll()).not.toThrow();
    });
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe('getInstance()', () => {
    it('returns the same instance on repeated calls', () => {
      // Reset singleton for test isolation
      (LegacyGameAdapter as any).instance = null;
      const eb = createFakeEventBus();
      const r = createFakeGameRepository();
      const a1 = LegacyGameAdapter.getInstance(eb, r as any);
      const a2 = LegacyGameAdapter.getInstance(eb, r as any);
      expect(a1).toBe(a2);
    });
  });

  // ==========================================================================
  // extractPlayersFromEvents (static)
  // ==========================================================================

  describe('extractPlayersFromEvents()', () => {
    it('returns empty array for empty events list', () => {
      expect(LegacyGameAdapter.extractPlayersFromEvents([])).toEqual([]);
    });

    it('extracts unique players from AGENT_SAYS_BROADCASTED events', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'AGENT_SAYS_BROADCASTED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          actorId: 'p1',
          data: { playerName: 'Alice', statement: 'hello' },
          metadata: { turnNumber: 1, dayNumber: 1, phase: 'DAY_DISCUSSION', sequence: 1 },
        },
        {
          id: 'e2',
          gameId: 'g1',
          type: 'AGENT_SAYS_BROADCASTED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          actorId: 'p2',
          data: { playerName: 'Bob', statement: 'hi' },
          metadata: { turnNumber: 2, dayNumber: 1, phase: 'DAY_DISCUSSION', sequence: 2 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      expect(players).toHaveLength(2);
      expect(players.find(p => p.id === 'p1')?.name).toBe('Alice');
      expect(players.find(p => p.id === 'p2')?.name).toBe('Bob');
    });

    it('deduplicates players appearing in multiple events', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'AGENT_SAYS_BROADCASTED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          actorId: 'p1',
          data: { playerName: 'Alice', statement: 'hello' },
          metadata: { turnNumber: 1, dayNumber: 1, phase: 'DAY_DISCUSSION', sequence: 1 },
        },
        {
          id: 'e2',
          gameId: 'g1',
          type: 'AGENT_SAYS_BROADCASTED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          actorId: 'p1',
          data: { playerName: 'Alice', statement: 'again' },
          metadata: { turnNumber: 2, dayNumber: 1, phase: 'DAY_DISCUSSION', sequence: 2 },
        },
        {
          id: 'e3',
          gameId: 'g1',
          type: 'AGENT_SAYS_BROADCASTED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          actorId: 'p2',
          data: { playerName: 'Bob', statement: 'ok' },
          metadata: { turnNumber: 3, dayNumber: 1, phase: 'DAY_DISCUSSION', sequence: 3 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      expect(players).toHaveLength(2);
    });

    it('ignores events without actorId', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'GAME_CREATED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          data: { config: {} },
          metadata: { turnNumber: 0, dayNumber: 0, phase: 'SETUP', sequence: 0 },
        },
      ];

      expect(LegacyGameAdapter.extractPlayersFromEvents(events)).toEqual([]);
    });

    it('generates fallback names for players without SAYS events', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'VOTE_CAST',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          actorId: 'abc12345-1234',
          data: { targetId: 'p2' },
          metadata: { turnNumber: 1, dayNumber: 1, phase: 'DAY_VOTING', sequence: 1 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      expect(players).toHaveLength(1);
      expect(players[0].id).toBe('abc12345-1234');
      expect(players[0].name).toContain('Player abc1234');
    });
  });
});
