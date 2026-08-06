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

    it('maps role/isMafia/isAlive from MORNING_REVEAL deaths', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'MORNING_REVEAL',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          data: {
            legacyType: 'REVEAL',
            deaths: [
              { id: 'p1', name: 'Alice', role: 'MAFIA', isMafia: true, isAlive: false },
              { id: 'p2', name: 'Bob', role: 'DOCTOR', isMafia: false, isAlive: false },
            ],
          },
          metadata: { turnNumber: 1, dayNumber: 1, phase: 'MORNING_REVEAL', sequence: 1 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      expect(players).toHaveLength(2);
      const alice = players.find(p => p.id === 'p1')!;
      expect(alice.role).toBe('MAFIA');
      expect(alice.isMafia).toBe(true);
      expect(alice.isAlive).toBe(false);
      expect(alice.name).toBe('Alice');
      const bob = players.find(p => p.id === 'p2')!;
      expect(bob.role).toBe('DOCTOR');
      expect(bob.isMafia).toBe(false);
      expect(bob.isAlive).toBe(false);
    });

    it('maps target roles from sheriff investigation events', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'NIGHT_ACTION_SUBMITTED',
          timestamp: new Date(),
          visibility: 'ADMIN',
          actorId: 'p3',
          data: {
            legacyType: 'ACTION',
            targetId: 'p1',
            targetName: 'Alice',
            result: 'MAFIA',
            targetRoles: ['MAFIA'],
          },
          metadata: { turnNumber: 1, dayNumber: 1, phase: 'NIGHT_ACTIONS', sequence: 1 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      expect(players).toHaveLength(2);
      const target = players.find(p => p.id === 'p1')!;
      expect(target.role).toBe('MAFIA');
      expect(target.isMafia).toBe(true);
      // The acting player is the sheriff
      const sheriff = players.find(p => p.id === 'p3')!;
      expect(sheriff.role).toBe('SHERIFF');
      expect(sheriff.isMafia).toBe(false);
    });

    it('infers DOCTOR from protection actions and VIGILANTE from shots', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'NIGHT_ACTION_SUBMITTED',
          timestamp: new Date(),
          visibility: 'ADMIN',
          actorId: 'p1',
          data: { legacyType: 'ACTION', targetId: 'p2', targetName: 'Bob', reason: 'Strategic' },
          metadata: { turnNumber: 1, dayNumber: 1, phase: 'NIGHT_ACTIONS', sequence: 1 },
        },
        {
          id: 'e2',
          gameId: 'g1',
          type: 'NIGHT_ACTION_SUBMITTED',
          timestamp: new Date(),
          visibility: 'ADMIN',
          actorId: 'p3',
          data: { legacyType: 'ACTION', action: 'SHOOT', targetId: 'p4', targetName: 'Dan' },
          metadata: { turnNumber: 1, dayNumber: 1, phase: 'NIGHT_ACTIONS', sequence: 2 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      expect(players.find(p => p.id === 'p1')!.role).toBe('DOCTOR');
      expect(players.find(p => p.id === 'p3')!.role).toBe('VIGILANTE');
    });

    it('marks PRIVATE mafia-chat participants as MAFIA', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'AGENT_SAYS_BROADCASTED',
          timestamp: new Date(),
          visibility: 'PRIVATE',
          actorId: 'p1',
          data: { legacyType: 'MESSAGE', playerName: 'Alice', says: 'kill Bob' },
          metadata: { turnNumber: 1, dayNumber: 1, phase: 'NIGHT_ACTIONS', sequence: 1 },
        },
        {
          id: 'e2',
          gameId: 'g1',
          type: 'AGENT_SAYS_BROADCASTED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          actorId: 'p2',
          data: { legacyType: 'MESSAGE', playerName: 'Bob', message: 'hello' },
          metadata: { turnNumber: 1, dayNumber: 1, phase: 'DAY_DISCUSSION', sequence: 2 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      expect(players.find(p => p.id === 'p1')!.role).toBe('MAFIA');
      expect(players.find(p => p.id === 'p1')!.isMafia).toBe(true);
      // Public day discussion must NOT be treated as mafia chat
      expect(players.find(p => p.id === 'p2')!.role).toBe('UNASSIGNED');
      expect(players.find(p => p.id === 'p2')!.isMafia).toBe(false);
    });

    it('maps full assignments from ROLES_ASSIGNED events', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'ROLES_ASSIGNED',
          timestamp: new Date(),
          visibility: 'PRIVATE',
          data: {
            assignments: [
              { playerId: 'p1', role: 'MAFIA' },
              { playerId: 'p2', role: 'SHERIFF' },
              { playerId: 'p3', role: 'VILLAGER' },
            ],
            mafiaTeam: ['p1'],
          },
          metadata: { turnNumber: 0, dayNumber: 0, phase: 'SETUP', sequence: 0 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      expect(players).toHaveLength(3);
      expect(players.find(p => p.id === 'p1')!.role).toBe('MAFIA');
      expect(players.find(p => p.id === 'p1')!.isMafia).toBe(true);
      expect(players.find(p => p.id === 'p2')!.role).toBe('SHERIFF');
      expect(players.find(p => p.id === 'p2')!.isMafia).toBe(false);
      expect(players.find(p => p.id === 'p3')!.role).toBe('VILLAGER');
    });

    it('maps generic role payloads (PLAYER_LYNCHED with playerId+role)', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'PLAYER_LYNCHED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          data: { playerId: 'p1', role: 'MAFIA', votes: 3, totalVotes: 5, dayNumber: 2, tied: false },
          metadata: { turnNumber: 5, dayNumber: 2, phase: 'RESOLUTION', sequence: 5 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      expect(players.find(p => p.id === 'p1')!.role).toBe('MAFIA');
      expect(players.find(p => p.id === 'p1')!.isMafia).toBe(false);
    });

    it('keeps UNASSIGNED only for players whose role is never revealed', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'AGENT_SAYS_BROADCASTED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          actorId: 'p1',
          data: { legacyType: 'MESSAGE', playerName: 'Alice', message: 'hello' },
          metadata: { turnNumber: 1, dayNumber: 1, phase: 'DAY_DISCUSSION', sequence: 1 },
        },
        {
          id: 'e2',
          gameId: 'g1',
          type: 'MORNING_REVEAL',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          data: {
            legacyType: 'REVEAL',
            deaths: [{ id: 'p2', name: 'Bob', role: 'VILLAGER', isMafia: false, isAlive: false }],
          },
          metadata: { turnNumber: 2, dayNumber: 1, phase: 'MORNING_REVEAL', sequence: 2 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      expect(players.find(p => p.id === 'p1')!.role).toBe('UNASSIGNED');
      expect(players.find(p => p.id === 'p1')!.isMafia).toBe(false);
      expect(players.find(p => p.id === 'p1')!.isAlive).toBe(true);
      expect(players.find(p => p.id === 'p2')!.role).toBe('VILLAGER');
      expect(players.find(p => p.id === 'p2')!.isAlive).toBe(false);
    });

    it('does not overwrite a role once revealed (first known value wins)', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'AGENT_SAYS_BROADCASTED',
          timestamp: new Date(),
          visibility: 'PRIVATE',
          actorId: 'p1',
          data: { legacyType: 'MESSAGE', playerName: 'Alice', says: 'kill Bob' },
          metadata: { turnNumber: 1, dayNumber: 1, phase: 'NIGHT_ACTIONS', sequence: 1 },
        },
        {
          id: 'e2',
          gameId: 'g1',
          type: 'MORNING_REVEAL',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          data: {
            legacyType: 'REVEAL',
            deaths: [{ id: 'p1', name: 'Alice', role: 'MAFIA', isMafia: true, isAlive: false }],
          },
          metadata: { turnNumber: 2, dayNumber: 1, phase: 'MORNING_REVEAL', sequence: 2 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      const alice = players.find(p => p.id === 'p1')!;
      expect(alice.role).toBe('MAFIA');
      expect(alice.isMafia).toBe(true);
      expect(alice.isAlive).toBe(false);
    });
  });
});
