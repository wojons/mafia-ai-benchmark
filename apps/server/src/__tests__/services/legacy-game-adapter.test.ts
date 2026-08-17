import { describe, it, expect, beforeEach } from 'vitest';
import { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';
import { createFakeEventBus, createFakeGameRepository, createSqliteBackedRepository } from './mocks.js';
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
  // translateAndPublishEvent — statement normalization (MAF-GAP-004)
  // ==========================================================================

  describe('translateAndPublishEvent() statement normalization', () => {
    function legacyMessageEvent(content: Record<string, unknown>) {
      return {
        eventType: 'MESSAGE',
        playerId: 'p1',
        playerName: 'Alice',
        visibility: 'PUBLIC',
        phase: 'DAY_DISCUSSION',
        content,
        round: 1,
        timestamp: new Date().toISOString(),
      };
    }

    it('maps DAY_DISCUSSION `message` content to statement/says (no more empty UI says)', () => {
      eventBus.reset();
      (adapter as any).translateAndPublishEvent('g1', legacyMessageEvent({ message: 'I think Alice is mafia.' }), 1);

      const published = eventBus.published.find(e => e.type === 'AGENT_SAYS_BROADCASTED');
      expect(published).toBeDefined();
      expect((published!.data as any).statement).toBe('I think Alice is mafia.');
      expect((published!.data as any).says).toBe('I think Alice is mafia.');
    });

    it('maps MAFIA_CHAT `says` content to statement/says', () => {
      eventBus.reset();
      const event = legacyMessageEvent({ think: '[Private] plan', says: 'Let us target the doctor.' });
      event.phase = 'MAFIA_CHAT';
      (adapter as any).translateAndPublishEvent('g1', event, 2);

      const published = eventBus.published.find(e => e.type === 'AGENT_SAYS_BROADCASTED');
      expect((published!.data as any).statement).toBe('Let us target the doctor.');
      expect((published!.data as any).says).toBe('Let us target the doctor.');
    });

    it('keeps an existing statement key untouched', () => {
      eventBus.reset();
      (adapter as any).translateAndPublishEvent(
        'g1',
        legacyMessageEvent({ statement: 'Already normalized.', message: 'Legacy key.' }),
        3,
      );

      const published = eventBus.published.find(e => e.type === 'AGENT_SAYS_BROADCASTED');
      expect((published!.data as any).statement).toBe('Already normalized.');
      expect((published!.data as any).says).toBe('Already normalized.');
    });

    it('does not inject statement keys on non-broadcast events', () => {
      eventBus.reset();
      (adapter as any).translateAndPublishEvent(
        'g1',
        {
          eventType: 'STATE_CHANGE',
          playerId: 'system',
          playerName: 'System',
          visibility: 'PUBLIC',
          phase: 'SETUP',
          content: { status: 'IN_PROGRESS' },
          round: 0,
          timestamp: new Date().toISOString(),
        },
        0,
      );

      const published = eventBus.published.find(e => e.type === 'GAME_STARTED');
      expect(published).toBeDefined();
      expect((published!.data as any).statement).toBeUndefined();
    });
  });

  // ==========================================================================
  // translateAndPublishEvent — terminal STATE_CHANGE mapping (MAF-GAP-005)
  // ==========================================================================

  describe('translateAndPublishEvent() terminal STATE_CHANGE mapping', () => {
    function legacyStateChange(overrides: Record<string, unknown> = {}) {
      return {
        eventType: 'STATE_CHANGE',
        playerId: 'system',
        playerName: 'System',
        visibility: 'PUBLIC',
        phase: 'SETUP',
        content: { status: 'IN_PROGRESS' },
        round: 1,
        timestamp: new Date().toISOString(),
        ...overrides,
      };
    }

    it('maps terminal STATE_CHANGE (phase GAME_OVER) to GAME_ENDED with winner data', () => {
      eventBus.reset();
      (adapter as any).translateAndPublishEvent('g1', legacyStateChange({
        phase: 'GAME_OVER',
        content: { winner: 'MAFIA', mafiaAlive: [true], townAlive: [false, false, false] },
      }), 61);

      const terminal = eventBus.published.find(e => e.type === 'GAME_ENDED');
      expect(terminal).toBeDefined();
      expect((terminal!.data as any).winner).toBe('MAFIA');
      expect((terminal!.data as any).mafiaAlive).toEqual([true]);
      expect((terminal!.data as any).townAlive).toEqual([false, false, false]);
      expect((terminal!.data as any).legacyType).toBe('STATE_CHANGE');
      expect(terminal!.metadata.phase).toBe('GAME_OVER');

      // The terminal transition must NOT be labeled as a game start
      expect(eventBus.published.find(e => e.type === 'GAME_STARTED')).toBeUndefined();
    });

    it('maps terminal STATE_CHANGE with winner in content to GAME_ENDED even without GAME_OVER phase', () => {
      eventBus.reset();
      (adapter as any).translateAndPublishEvent('g1', legacyStateChange({
        phase: 'DAY_VOTING',
        content: { winner: 'TOWN', mafiaAlive: [false], townAlive: [true, true] },
      }), 62);

      const terminal = eventBus.published.find(e => e.type === 'GAME_ENDED');
      expect(terminal).toBeDefined();
      expect((terminal!.data as any).winner).toBe('TOWN');
      expect(eventBus.published.find(e => e.type === 'GAME_STARTED')).toBeUndefined();
    });

    it('keeps non-terminal STATE_CHANGE events mapped to GAME_STARTED', () => {
      eventBus.reset();
      (adapter as any).translateAndPublishEvent('g1', legacyStateChange({
        phase: 'SETUP',
        content: { status: 'IN_PROGRESS' },
      }), 0);

      const started = eventBus.published.find(e => e.type === 'GAME_STARTED');
      expect(started).toBeDefined();
      expect((started!.data as any).status).toBe('IN_PROGRESS');
      expect(eventBus.published.find(e => e.type === 'GAME_ENDED')).toBeUndefined();
    });

    it('does not remap non-STATE_CHANGE events that merely carry a winner field', () => {
      eventBus.reset();
      (adapter as any).translateAndPublishEvent('g1', {
        eventType: 'REVEAL',
        playerId: 'p1',
        playerName: 'Alice',
        visibility: 'PUBLIC',
        phase: 'MORNING_REVEAL',
        content: { winner: 'MAFIA' },
        round: 2,
        timestamp: new Date().toISOString(),
      }, 3);

      const reveal = eventBus.published.find(e => e.type === 'MORNING_REVEAL');
      expect(reveal).toBeDefined();
      expect((reveal!.data as any).winner).toBe('MAFIA');
      expect(eventBus.published.find(e => e.type === 'GAME_ENDED')).toBeUndefined();
    });
  });

  // ==========================================================================
  // translateAndPublishEvent — per-death elimination events (MAF-GAP-044)
  // ==========================================================================

  describe('translateAndPublishEvent() PLAYER_LYNCHED death events', () => {
    it('maps legacy PLAYER_LYNCHED events to PLAYER_LYNCHED with deaths preserved', () => {
      eventBus.reset();
      (adapter as any).translateAndPublishEvent('g1', {
        eventType: 'PLAYER_LYNCHED',
        playerId: null,
        playerName: null,
        visibility: 'PUBLIC',
        phase: 'VOTING',
        content: {
          deaths: [
            { id: 'p4', name: 'Dana', role: 'SHERIFF', isMafia: false, isAlive: false },
          ],
        },
        round: 2,
        timestamp: new Date().toISOString(),
      }, 8);

      const published = eventBus.published.find(e => e.type === 'PLAYER_LYNCHED');
      expect(published).toBeDefined();
      expect(published!.metadata.phase).toBe('DAY_VOTING');
      expect((published!.data as any).legacyType).toBe('PLAYER_LYNCHED');
      expect((published!.data as any).deaths).toHaveLength(1);
      expect((published!.data as any).deaths[0]).toMatchObject({
        id: 'p4',
        role: 'SHERIFF',
        isAlive: false,
      });
    });

    it('does not remap PLAYER_LYNCHED events to GAME_ENDED when they carry a winner field', () => {
      eventBus.reset();
      (adapter as any).translateAndPublishEvent('g1', {
        eventType: 'PLAYER_LYNCHED',
        playerId: null,
        playerName: null,
        visibility: 'PUBLIC',
        phase: 'VOTING',
        content: { deaths: [], winner: 'TOWN' },
        round: 2,
        timestamp: new Date().toISOString(),
      }, 9);

      expect(eventBus.published.find(e => e.type === 'PLAYER_LYNCHED')).toBeDefined();
      expect(eventBus.published.find(e => e.type === 'GAME_ENDED')).toBeUndefined();
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

    it('marks PLAYER_LYNCHED deaths dead (MAF-GAP-044)', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'ROLES_ASSIGNED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          data: {
            assignments: [
              { playerId: 'p1', role: 'MAFIA' },
              { playerId: 'p2', role: 'DOCTOR' },
            ],
          },
          metadata: { turnNumber: 0, dayNumber: 0, phase: 'SETUP', sequence: 0 },
        },
        {
          id: 'e2',
          gameId: 'g1',
          type: 'PLAYER_LYNCHED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          data: {
            legacyType: 'PLAYER_LYNCHED',
            deaths: [
              { id: 'p2', name: 'Bob', role: 'DOCTOR', isMafia: false, isAlive: false },
            ],
          },
          metadata: { turnNumber: 3, dayNumber: 2, phase: 'DAY_VOTING', sequence: 3 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      expect(players).toHaveLength(2);
      const lynched = players.find(p => p.id === 'p2')!;
      expect(lynched.role).toBe('DOCTOR');
      expect(lynched.isAlive).toBe(false);
      expect(lynched.name).toBe('Bob');
      // The surviving player is unaffected
      expect(players.find(p => p.id === 'p1')!.isAlive).toBe(true);
    });

    it('marks PLAYER_ELIMINATED and PLAYER_KILLED deaths dead (MAF-GAP-044)', () => {
      const events: GameEvent[] = [
        {
          id: 'e1',
          gameId: 'g1',
          type: 'PLAYER_ELIMINATED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          data: {
            deaths: [{ id: 'p1', name: 'Alice', role: 'VILLAGER', isMafia: false, isAlive: false }],
          },
          metadata: { turnNumber: 1, dayNumber: 1, phase: 'RESOLUTION', sequence: 1 },
        },
        {
          id: 'e2',
          gameId: 'g1',
          type: 'PLAYER_KILLED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          data: {
            deaths: [{ id: 'p2', name: 'Bob', role: 'MAFIA', isMafia: true, isAlive: false }],
          },
          metadata: { turnNumber: 2, dayNumber: 1, phase: 'MORNING_REVEAL', sequence: 2 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      expect(players.find(p => p.id === 'p1')!.isAlive).toBe(false);
      expect(players.find(p => p.id === 'p1')!.role).toBe('VILLAGER');
      expect(players.find(p => p.id === 'p2')!.isAlive).toBe(false);
      expect(players.find(p => p.id === 'p2')!.role).toBe('MAFIA');
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

    it('late ROLES_ASSIGNED fills only UNASSIGNED gaps (MAF-GAP-013 bridge roster event)', () => {
      // Simulates the legacy bridge's synthetic end-of-game ROLES_ASSIGNED
      // event: roles already inferred from play (mafia chat, doctor action)
      // must NOT be overwritten, while plain villagers who never acted and
      // never died get their canonical role from the roster.
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
          type: 'NIGHT_ACTION_SUBMITTED',
          timestamp: new Date(),
          visibility: 'ADMIN',
          actorId: 'p2',
          data: { legacyType: 'ACTION', targetId: 'p3', targetName: 'Carol', reason: 'Strategic' },
          metadata: { turnNumber: 1, dayNumber: 1, phase: 'NIGHT_ACTIONS', sequence: 2 },
        },
        {
          id: 'e3',
          gameId: 'g1',
          type: 'ROLES_ASSIGNED',
          timestamp: new Date(),
          visibility: 'ADMIN',
          data: {
            legacyType: 'ROLES_ASSIGNED',
            assignments: [
              { playerId: 'p1', role: 'MAFIA', isMafia: true },
              { playerId: 'p2', role: 'DOCTOR', isMafia: false },
              { playerId: 'p3', role: 'VILLAGER', isMafia: false },
              { playerId: 'p4', role: 'SHERIFF', isMafia: false },
              { playerId: 'p5', role: 'VILLAGER', isMafia: false },
            ],
          },
          metadata: { turnNumber: 0, dayNumber: 0, phase: 'GAME_OVER', sequence: 3 },
        },
      ];

      const players = LegacyGameAdapter.extractPlayersFromEvents(events);
      expect(players).toHaveLength(5);

      // Inferred roles survive (first-write-wins)
      expect(players.find(p => p.id === 'p1')!.role).toBe('MAFIA');
      expect(players.find(p => p.id === 'p1')!.isMafia).toBe(true);
      expect(players.find(p => p.id === 'p2')!.role).toBe('DOCTOR');
      expect(players.find(p => p.id === 'p2')!.isMafia).toBe(false);

      // Plain villagers who never acted/died get their canonical role
      expect(players.find(p => p.id === 'p3')!.role).toBe('VILLAGER');
      expect(players.find(p => p.id === 'p3')!.isMafia).toBe(false);
      expect(players.find(p => p.id === 'p4')!.role).toBe('SHERIFF');
      expect(players.find(p => p.id === 'p4')!.isMafia).toBe(false);
      expect(players.find(p => p.id === 'p5')!.role).toBe('VILLAGER');
      expect(players.find(p => p.id === 'p5')!.isMafia).toBe(false);

      // Zero UNASSIGNED after the roster event
      expect(players.filter(p => p.role === 'UNASSIGNED')).toHaveLength(0);
    });

    it('bridge-emitted ROLES_ASSIGNED flows through translateAndPublishEvent into extraction (MAF-GAP-013)', () => {
      // Full pipeline proof: the legacy bridge emits a synthetic ROLES_ASSIGNED
      // event with the exact shape added in legacy-bridge.js; the adapter
      // translates + stores it; extractPlayersFromEvents then resolves every
      // player's role — including plain villagers who never acted or died.
      eventBus.reset();
      (adapter as any).translateAndPublishEvent('g1', {
        eventType: 'ROLES_ASSIGNED',
        playerId: null,
        playerName: null,
        visibility: 'ADMIN_ONLY',
        phase: 'GAME_OVER',
        content: {
          assignments: [
            { playerId: 'p1', role: 'MAFIA', isMafia: true },
            { playerId: 'p2', role: 'DOCTOR', isMafia: false },
            { playerId: 'p3', role: 'SHERIFF', isMafia: false },
            { playerId: 'p4', role: 'VIGILANTE', isMafia: false },
            { playerId: 'p5', role: 'VILLAGER', isMafia: false },
          ],
        },
        round: 0,
        timestamp: new Date().toISOString(),
      }, 1);

      const published = eventBus.published.find(e => e.type === 'ROLES_ASSIGNED');
      expect(published).toBeDefined();
      // normalizeStatementData must not clobber assignments on this path
      expect(Array.isArray((published!.data as any).assignments)).toBe(true);

      const stored = repo.getEvents('g1');
      expect(stored).toHaveLength(1);
      expect(stored[0].type).toBe('ROLES_ASSIGNED');

      const players = LegacyGameAdapter.extractPlayersFromEvents(stored);
      expect(players).toHaveLength(5);
      expect(players.filter(p => p.role === 'UNASSIGNED')).toHaveLength(0);
      expect(players.find(p => p.id === 'p5')!.role).toBe('VILLAGER');
      expect(players.find(p => p.id === 'p1')!.isMafia).toBe(true);
    });
  });

  // ==========================================================================
  // persistUsage — bridge USAGE line persistence (MAF-GAP-012)
  // ==========================================================================

  describe('persistUsage()', () => {
    it('persists token_usage / api_calls / player_game_stats rows from a bridge usage aggregate', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-usage', status: 'IN_PROGRESS' });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);

      (sqliteAdapter as any).persistUsage('g-usage', [
        {
          provider: 'providerA',
          model: 'modelA',
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
          cost: 0.0015,
          apiCalls: 12,
          latencyMs: 800,
        },
        {
          provider: 'providerB',
          model: 'modelB',
          promptTokens: 2000,
          completionTokens: 1000,
          totalTokens: 3000,
          cost: 0.003,
          apiCalls: 20,
          latencyMs: 1200,
        },
      ]);

      const tu = sqliteRepo.db.prepare(
        'SELECT * FROM token_usage WHERE game_id = ? ORDER BY provider'
      ).all('g-usage') as Array<Record<string, unknown>>;
      expect(tu).toHaveLength(2);
      expect(tu[0].provider).toBe('providerA');
      expect(tu[0].model).toBe('modelA');
      expect(tu[0].total_tokens).toBe(1500);
      expect(tu[0].cost).toBeCloseTo(0.0015, 6);
      expect(tu[0].player_id).toBe('ALL');

      const ac = sqliteRepo.db.prepare(
        'SELECT * FROM api_calls WHERE game_id = ?'
      ).all('g-usage') as Array<Record<string, unknown>>;
      expect(ac).toHaveLength(2);
      expect(ac[0].endpoint).toBe('legacy-engine');

      const pgs = sqliteRepo.db.prepare(
        'SELECT * FROM player_game_stats WHERE game_id = ?'
      ).all('g-usage') as Array<Record<string, unknown>>;
      expect(pgs).toHaveLength(2);
      expect(pgs[0].tokens_used).toBe(1500);
      expect(pgs[0].api_calls).toBe(12);
    });

    it('is a no-op when no usage is reported', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-nousage', status: 'IN_PROGRESS' });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);

      (sqliteAdapter as any).persistUsage('g-nousage', undefined);
      (sqliteAdapter as any).persistUsage('g-nousage', []);

      expect(sqliteRepo.db.prepare('SELECT COUNT(*) as c FROM token_usage WHERE game_id = ?').get('g-nousage')).toEqual({ c: 0 });
      expect(sqliteRepo.db.prepare('SELECT COUNT(*) as c FROM api_calls WHERE game_id = ?').get('g-nousage')).toEqual({ c: 0 });
      expect(sqliteRepo.db.prepare('SELECT COUNT(*) as c FROM player_game_stats WHERE game_id = ?').get('g-nousage')).toEqual({ c: 0 });
    });

    it('attributes role from player_model_assignments when present', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-role', status: 'IN_PROGRESS' });
      sqliteRepo.db.prepare(`
        INSERT INTO player_model_assignments
          (id, game_id, player_id, role, provider, model, temperature, max_tokens, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('pma1', 'g-role', 'ALL', 'MAFIA', 'providerA', 'modelA', 0.7, 500, 0, Date.now());
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);

      (sqliteAdapter as any).persistUsage('g-role', [
        {
          provider: 'providerA',
          model: 'modelA',
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          cost: 0.0001,
          apiCalls: 2,
          latencyMs: 100,
        },
      ]);

      const pgs = sqliteRepo.db.prepare(
        'SELECT * FROM player_game_stats WHERE game_id = ?'
      ).get('g-role') as Record<string, unknown>;
      expect(pgs.role).toBe('MAFIA');
    });

    it('persists usage end-to-end when the bridge done message arrives (MAF-GAP-018)', () => {
      // Full path: bridge emits 'done' with usage aggregates collected from
      // the engine's real trackers -> handleBridgeMessage -> persistUsage ->
      // token_usage/api_calls/player_game_stats rows for the model played.
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-done', status: 'IN_PROGRESS' });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);
      (sqliteAdapter as any).activeGames.set('g-done', {
        gameId: 'g-done',
        process: null,
        eventCount: 3,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5000),
      });

      (sqliteAdapter as any).handleBridgeMessage('g-done', {
        type: 'done',
        winner: 'TOWN',
        totalEvents: 3,
        dayCount: 2,
        usage: [
          {
            provider: 'openai',
            model: 'gpt-4o-mini',
            promptTokens: 3000,
            completionTokens: 1500,
            totalTokens: 4500,
            cost: 0.0036,
            apiCalls: 12,
            latencyMs: 1840,
          },
        ],
      });

      const tu = sqliteRepo.db.prepare(
        'SELECT * FROM token_usage WHERE game_id = ?'
      ).get('g-done') as Record<string, unknown>;
      expect(tu).toBeDefined();
      expect(tu.provider).toBe('openai');
      expect(tu.model).toBe('gpt-4o-mini');
      expect(tu.total_tokens).toBe(4500);
      expect(tu.cost).toBeCloseTo(0.0036, 6);

      const ac = sqliteRepo.db.prepare(
        'SELECT * FROM api_calls WHERE game_id = ?'
      ).get('g-done') as Record<string, unknown>;
      expect(ac).toBeDefined();
      expect(ac.latency).toBe(1840);

      const state = (sqliteAdapter as any).activeGames.get('g-done');
      expect(state.status).toBe('COMPLETED');
    });

    it('persists players.won (1 winning side / 0 losing side) when the done message carries a winner (MAF-GAP-043)', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({
        id: 'g-done-won',
        status: 'IN_PROGRESS',
        players: [
          { id: 'p-maf', name: 'Maf', role: 'MAFIA', isMafia: true, joinOrder: 0, provider: 'openai', model: 'gpt-4o-mini' },
          { id: 'p-town', name: 'Town', role: 'VILLAGER', isMafia: false, joinOrder: 1, provider: 'openai', model: 'gpt-4o' },
        ],
      });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);
      (sqliteAdapter as any).activeGames.set('g-done-won', {
        gameId: 'g-done-won',
        process: null,
        eventCount: 2,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5000),
      });

      (sqliteAdapter as any).handleBridgeMessage('g-done-won', {
        type: 'done',
        winner: 'TOWN',
        totalEvents: 2,
        dayCount: 1,
        usage: [],
      });

      const rows = sqliteRepo.db.prepare(
        'SELECT id, is_mafia, won FROM players WHERE game_id = ? ORDER BY join_order'
      ).all('g-done-won') as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      // TOWN won: the town player's side won (1), the mafia player lost (0).
      expect(rows[0]).toMatchObject({ id: 'p-maf', is_mafia: 1, won: 0 });
      expect(rows[1]).toMatchObject({ id: 'p-town', is_mafia: 0, won: 1 });
    });

    it('does not touch players.won when the done message has no real winner (MAF-GAP-043)', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({
        id: 'g-done-nowin',
        status: 'IN_PROGRESS',
        players: [
          { id: 'p1', name: 'P1', role: 'MAFIA', isMafia: true, joinOrder: 0 },
          { id: 'p2', name: 'P2', role: 'VILLAGER', isMafia: false, joinOrder: 1 },
        ],
      });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);
      (sqliteAdapter as any).activeGames.set('g-done-nowin', {
        gameId: 'g-done-nowin',
        process: null,
        eventCount: 1,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5000),
      });

      (sqliteAdapter as any).handleBridgeMessage('g-done-nowin', {
        type: 'done',
        winner: null,
        totalEvents: 1,
        dayCount: 1,
        usage: [],
      });

      const rows = sqliteRepo.db.prepare(
        'SELECT won FROM players WHERE game_id = ? ORDER BY join_order'
      ).all('g-done-nowin') as Array<{ won: number | null }>;
      expect(rows.map(r => r.won)).toEqual([null, null]);
    });

    it('persists per-player token_usage/api_calls rows with real player_id AND keeps the ALL rows (MAF-GAP-029)', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-perplayer', status: 'IN_PROGRESS' });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);

      (sqliteAdapter as any).persistUsage(
        'g-perplayer',
        [
          {
            provider: 'openai',
            model: 'gpt-4o-mini',
            promptTokens: 3400,
            completionTokens: 1600,
            totalTokens: 5000,
            cost: 0.004,
            apiCalls: 20,
            latencyMs: 900,
          },
        ],
        [
          {
            playerId: 'p17863974617470',
            playerName: 'Alice',
            provider: 'openai',
            model: 'gpt-4o-mini',
            promptTokens: 2000,
            completionTokens: 1000,
            totalTokens: 3000,
            cost: 0.0024,
            apiCalls: 12,
            latencyMs: 800,
          },
          {
            playerId: 'p17863974617471',
            playerName: 'Bob',
            provider: 'openai',
            model: 'gpt-4o-mini',
            promptTokens: 1400,
            completionTokens: 600,
            totalTokens: 2000,
            cost: 0.0016,
            apiCalls: 8,
            latencyMs: 1000,
          },
        ],
      );

      // The per-model 'ALL' rows are kept (stats pipeline depends on them).
      const allTokens = sqliteRepo.db.prepare(
        "SELECT * FROM token_usage WHERE game_id = ? AND player_id = 'ALL'"
      ).all('g-perplayer') as Array<Record<string, unknown>>;
      expect(allTokens).toHaveLength(1);
      expect(allTokens[0].total_tokens).toBe(5000);
      const allCalls = sqliteRepo.db.prepare(
        "SELECT * FROM api_calls WHERE game_id = ? AND player_id = 'ALL'"
      ).all('g-perplayer') as Array<Record<string, unknown>>;
      expect(allCalls).toHaveLength(1);

      // Per-player rows carry the real engine player ids.
      const playerTokens = sqliteRepo.db.prepare(
        "SELECT * FROM token_usage WHERE game_id = ? AND player_id != 'ALL' ORDER BY player_id"
      ).all('g-perplayer') as Array<Record<string, unknown>>;
      expect(playerTokens).toHaveLength(2);
      expect(playerTokens[0].player_id).toBe('p17863974617470');
      expect(playerTokens[0].provider).toBe('openai');
      expect(playerTokens[0].model).toBe('gpt-4o-mini');
      expect(playerTokens[0].total_tokens).toBe(3000);
      expect(playerTokens[0].cost).toBeCloseTo(0.0024, 6);
      expect(playerTokens[1].player_id).toBe('p17863974617471');
      expect(playerTokens[1].total_tokens).toBe(2000);

      const playerCalls = sqliteRepo.db.prepare(
        "SELECT * FROM api_calls WHERE game_id = ? AND player_id != 'ALL' ORDER BY player_id"
      ).all('g-perplayer') as Array<Record<string, unknown>>;
      expect(playerCalls).toHaveLength(2);
      expect(playerCalls[0].player_id).toBe('p17863974617470');
      expect(playerCalls[0].endpoint).toBe('legacy-engine');
      expect(playerCalls[0].latency).toBe(800);
      expect(playerCalls[1].latency).toBe(1000);
    });

    it('persists per-player rows end-to-end when the bridge done message carries usageByPlayer (MAF-GAP-029)', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-done-pp', status: 'IN_PROGRESS' });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);
      (sqliteAdapter as any).activeGames.set('g-done-pp', {
        gameId: 'g-done-pp',
        process: null,
        eventCount: 3,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5000),
      });

      (sqliteAdapter as any).handleBridgeMessage('g-done-pp', {
        type: 'done',
        winner: 'TOWN',
        totalEvents: 3,
        dayCount: 2,
        usage: [
          {
            provider: 'openai',
            model: 'gpt-4o-mini',
            promptTokens: 3400,
            completionTokens: 1600,
            totalTokens: 5000,
            cost: 0.004,
            apiCalls: 20,
            latencyMs: 900,
          },
        ],
        usageByPlayer: [
          {
            playerId: 'p1',
            provider: 'openai',
            model: 'gpt-4o-mini',
            promptTokens: 2000,
            completionTokens: 1000,
            totalTokens: 3000,
            cost: 0.0024,
            apiCalls: 12,
            latencyMs: 800,
          },
        ],
      });

      const tu = sqliteRepo.db.prepare(
        "SELECT * FROM token_usage WHERE game_id = ? AND player_id = 'p1'"
      ).get('g-done-pp') as Record<string, unknown>;
      expect(tu).toBeDefined();
      expect(tu.total_tokens).toBe(3000);
      const ac = sqliteRepo.db.prepare(
        "SELECT * FROM api_calls WHERE game_id = ? AND player_id = 'p1'"
      ).get('g-done-pp') as Record<string, unknown>;
      expect(ac).toBeDefined();
      expect(ac.endpoint).toBe('legacy-engine');
    });
  });

  // ==========================================================================
  // persistPlayers — players rows from ROLES_ASSIGNED (MAF-GAP-043B)
  // ==========================================================================

  describe('persistPlayers() from ROLES_ASSIGNED', () => {
    function rolesAssignedEvent(content: Record<string, unknown>) {
      return {
        eventType: 'ROLES_ASSIGNED',
        playerId: null,
        playerName: null,
        visibility: 'ADMIN_ONLY',
        phase: 'GAME_OVER',
        content,
        round: 0,
        timestamp: new Date().toISOString(),
      };
    }

    it('persists one players row per assignment with role/is_mafia/provider/model', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-roster', status: 'IN_PROGRESS' });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);
      // The benchmark runner's per-role split: model A for MAFIA, model B
      // for the town core (keyed 'TOWN' — the legacy engine resolves town
      // players via VILLAGER_MODEL).
      (sqliteAdapter as any).gameConfigs.set('g-roster', {
        numPlayers: 3,
        roleModels: {
          MAFIA: 'openai/gpt-4o-mini',
          TOWN: 'anthropic/claude-3',
        },
      });

      (sqliteAdapter as any).translateAndPublishEvent(
        'g-roster',
        rolesAssignedEvent({
          assignments: [
            { playerId: 'p1', name: 'Alice', role: 'MAFIA', isMafia: true },
            { playerId: 'p2', name: 'Bob', role: 'SHERIFF', isMafia: false },
            { playerId: 'p3', name: 'Carol', role: 'VILLAGER', isMafia: false },
          ],
        }),
        61,
      );

      const rows = sqliteRepo.db.prepare(
        'SELECT * FROM players WHERE game_id = ? ORDER BY join_order'
      ).all('g-roster') as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(3);
      // Row ids match the assignment ids (the event stream's actorIds) so
      // event-derived players and table rows stay consistent.
      expect(rows[0]).toMatchObject({
        id: 'p1', name: 'Alice', role: 'MAFIA', is_mafia: 1, join_order: 0,
        provider: 'openai', model: 'gpt-4o-mini', is_alive: 1,
      });
      // SHERIFF has no roleModels entry: model comes from the TOWN spec
      // only for VILLAGER-role players; SHERIFF stays NULL (honest — the
      // runner maps SHERIFF to model A, but a bare TOWN-keyed config does
      // not name it; the done-time usage backfill covers the real model).
      expect(rows[1]).toMatchObject({
        id: 'p2', name: 'Bob', role: 'SHERIFF', is_mafia: 0, join_order: 1,
        provider: null, model: null,
      });
      // VILLAGER assignment matches the TOWN config key (TOWN<->VILLAGER).
      expect(rows[2]).toMatchObject({
        id: 'p3', name: 'Carol', role: 'VILLAGER', is_mafia: 0, join_order: 2,
        provider: 'anthropic', model: 'claude-3',
      });
      // won stays NULL at creation — setPlayersWon fills it at game end.
      expect(rows.every(r => r.won === null)).toBe(true);
    });

    it('falls back to role/mafiaTeam for is_mafia when assignments lack the boolean', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-roster2', status: 'IN_PROGRESS' });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);
      (sqliteAdapter as any).gameConfigs.set('g-roster2', { numPlayers: 3 });

      // Engine-native shape: no isMafia on assignments, mafia ids in
      // mafiaTeam (the extractPlayersFromEvents contract).
      (sqliteAdapter as any).translateAndPublishEvent(
        'g-roster2',
        rolesAssignedEvent({
          assignments: [
            { playerId: 'p1', role: 'MAFIA' },
            { playerId: 'p2', role: 'DOCTOR' },
            { playerId: 'p3', role: 'VILLAGER' },
          ],
          mafiaTeam: ['p1', 'p2'],
        }),
        1,
      );

      const rows = sqliteRepo.db.prepare(
        'SELECT id, role, is_mafia FROM players WHERE game_id = ? ORDER BY join_order'
      ).all('g-roster2') as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(3);
      // p1: role === 'MAFIA'. p2: mafiaTeam membership wins over a non-mafia
      // display role (multi-role mafia-doctor). p3: neither.
      expect(rows[0]).toMatchObject({ id: 'p1', is_mafia: 1 });
      expect(rows[1]).toMatchObject({ id: 'p2', is_mafia: 1 });
      expect(rows[2]).toMatchObject({ id: 'p3', is_mafia: 0 });
    });

    it('uses gameConfig llmProvider/llmModel for single-model CLI games', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-cli', status: 'IN_PROGRESS' });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);
      // CLI run-game posts { config, numPlayers } — no roleModels; the
      // GameConfig carries the one model the whole game runs on.
      (sqliteAdapter as any).gameConfigs.set('g-cli', {
        numPlayers: 2,
        gameConfig: {
          numPlayers: 2,
          llmProvider: 'openai',
          llmModel: 'openai/gpt-4o-mini',
          roles: [],
        },
      });

      (sqliteAdapter as any).translateAndPublishEvent(
        'g-cli',
        rolesAssignedEvent({
          assignments: [
            { playerId: 'p1', name: 'Alice', role: 'MAFIA', isMafia: true },
            { playerId: 'p2', name: 'Bob', role: 'VILLAGER', isMafia: false },
          ],
        }),
        1,
      );

      const rows = sqliteRepo.db.prepare(
        'SELECT id, provider, model FROM players WHERE game_id = ? ORDER BY join_order'
      ).all('g-cli') as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.provider).toBe('openai');
        expect(row.model).toBe('gpt-4o-mini');
      }
    });

    it('is a no-op for events without assignments and never breaks the event flow', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-noroster', status: 'IN_PROGRESS' });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);

      expect(() => {
        (sqliteAdapter as any).translateAndPublishEvent(
          'g-noroster',
          rolesAssignedEvent({ assignments: [] }),
          1,
        );
        (sqliteAdapter as any).translateAndPublishEvent(
          'g-noroster',
          { eventType: 'STATE_CHANGE', playerId: 'system', playerName: 'System', visibility: 'PUBLIC', phase: 'SETUP', content: { status: 'IN_PROGRESS' }, round: 0, timestamp: new Date().toISOString() },
          2,
        );
      }).not.toThrow();

      const count = sqliteRepo.db.prepare(
        'SELECT COUNT(*) as c FROM players WHERE game_id = ?'
      ).get('g-noroster') as { c: number };
      expect(count.c).toBe(0);
      // The ROLES_ASSIGNED event itself is still persisted as an event.
      const evCount = sqliteRepo.db.prepare(
        'SELECT COUNT(*) as c FROM events WHERE game_id = ?'
      ).get('g-noroster') as { c: number };
      expect(evCount.c).toBe(2);
    });

    it('persists players and attributes won end-to-end through the done handler (MAF-GAP-043B)', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-e2e', status: 'IN_PROGRESS' });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);
      (sqliteAdapter as any).gameConfigs.set('g-e2e', {
        numPlayers: 4,
        roleModels: {
          MAFIA: 'openai/gpt-4o-mini',
          TOWN: 'anthropic/claude-3',
        },
      });
      (sqliteAdapter as any).activeGames.set('g-e2e', {
        gameId: 'g-e2e',
        process: null,
        eventCount: 1,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5000),
      });

      // Game start -> ROLES_ASSIGNED roster -> done(winner=TOWN).
      (sqliteAdapter as any).translateAndPublishEvent(
        'g-e2e',
        rolesAssignedEvent({
          assignments: [
            { playerId: 'p1', name: 'Maf', role: 'MAFIA', isMafia: true },
            { playerId: 'p2', name: 'Doc', role: 'DOCTOR', isMafia: false },
            { playerId: 'p3', name: 'She', role: 'SHERIFF', isMafia: false },
            { playerId: 'p4', name: 'Vil', role: 'VILLAGER', isMafia: false },
          ],
        }),
        1,
      );
      (sqliteAdapter as any).handleBridgeMessage('g-e2e', {
        type: 'done',
        winner: 'TOWN',
        totalEvents: 1,
        dayCount: 1,
        usage: [],
      });

      const rows = sqliteRepo.db.prepare(
        'SELECT id, is_mafia, provider, model, won FROM players WHERE game_id = ? ORDER BY join_order'
      ).all('g-e2e') as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(4);
      // MAFIA side lost: won=0. Town side won: won=1.
      expect(rows[0]).toMatchObject({ id: 'p1', is_mafia: 1, won: 0, provider: 'openai', model: 'gpt-4o-mini' });
      for (const row of rows.slice(1)) {
        expect(row.won).toBe(1);
        // DOCTOR/SHERIFF have no roleModels entry here (only MAFIA+TOWN);
        // VILLAGER resolves through the TOWN key.
        if (row.id === 'p4') {
          expect(row.provider).toBe('anthropic');
          expect(row.model).toBe('claude-3');
        }
      }
    });

    it('backfills provider/model from the engine real per-player usage at done', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-backfill', status: 'IN_PROGRESS' });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);
      // Bare POST /api/v1/games: no roleModels, no llmModel — the engine
      // picks its own model, only observable in usageByPlayer at done.
      (sqliteAdapter as any).gameConfigs.set('g-backfill', { numPlayers: 2 });
      (sqliteAdapter as any).activeGames.set('g-backfill', {
        gameId: 'g-backfill',
        process: null,
        eventCount: 1,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5000),
      });

      (sqliteAdapter as any).translateAndPublishEvent(
        'g-backfill',
        rolesAssignedEvent({
          assignments: [
            { playerId: 'p1', name: 'Alice', role: 'MAFIA', isMafia: true },
            { playerId: 'p2', name: 'Bob', role: 'VILLAGER', isMafia: false },
          ],
        }),
        1,
      );
      // Before done: rows exist with NULL provider/model.
      const before = sqliteRepo.db.prepare(
        'SELECT provider, model FROM players WHERE game_id = ?'
      ).all('g-backfill') as Array<Record<string, unknown>>;
      expect(before.every(r => r.provider === null && r.model === null)).toBe(true);

      (sqliteAdapter as any).handleBridgeMessage('g-backfill', {
        type: 'done',
        winner: 'TOWN',
        totalEvents: 1,
        dayCount: 1,
        usage: [],
        usageByPlayer: [
          { playerId: 'p1', provider: 'deepseek', model: 'deepseek-v4-flash', promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0, apiCalls: 1, latencyMs: 100 },
          { playerId: 'p2', provider: 'deepseek', model: 'deepseek-v4-flash', promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0, apiCalls: 1, latencyMs: 100 },
        ],
      });

      const after = sqliteRepo.db.prepare(
        'SELECT provider, model, won FROM players WHERE game_id = ? ORDER BY join_order'
      ).all('g-backfill') as Array<Record<string, unknown>>;
      for (const row of after) {
        expect(row.provider).toBe('deepseek');
        expect(row.model).toBe('deepseek-v4-flash');
      }
      // TOWN won: mafia lost (0), villager won (1).
      expect(after[0].won).toBe(0);
      expect(after[1].won).toBe(1);
    });

    it('does not overwrite config-derived provider/model with usageByPlayer', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-noclobber', status: 'IN_PROGRESS' });
      const sqliteAdapter = new LegacyGameAdapter(eventBus, sqliteRepo as any);
      (sqliteAdapter as any).gameConfigs.set('g-noclobber', {
        numPlayers: 1,
        roleModels: { MAFIA: 'openai/gpt-4o-mini' },
      });
      (sqliteAdapter as any).activeGames.set('g-noclobber', {
        gameId: 'g-noclobber',
        process: null,
        eventCount: 1,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5000),
      });

      (sqliteAdapter as any).translateAndPublishEvent(
        'g-noclobber',
        rolesAssignedEvent({
          assignments: [{ playerId: 'p1', name: 'Alice', role: 'MAFIA', isMafia: true }],
        }),
        1,
      );
      (sqliteAdapter as any).handleBridgeMessage('g-noclobber', {
        type: 'done',
        winner: 'MAFIA',
        totalEvents: 1,
        dayCount: 1,
        usage: [],
        usageByPlayer: [
          { playerId: 'p1', provider: 'other', model: 'other-model', promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0, apiCalls: 1, latencyMs: 100 },
        ],
      });

      const row = sqliteRepo.db.prepare(
        'SELECT provider, model, won FROM players WHERE game_id = ?'
      ).get('g-noclobber') as Record<string, unknown>;
      expect(row.provider).toBe('openai');
      expect(row.model).toBe('gpt-4o-mini');
      expect(row.won).toBe(1);
    });
  });

  // ==========================================================================
  // handleBridgeMessage — non-string .type defense (MAF-GAP-042)
  // ==========================================================================

  describe('handleBridgeMessage() non-string .type defense', () => {
    it('skips parsed stdout lines without a string .type (no event count, no spam)', () => {
      (adapter as any).activeGames.set('g-noise', {
        gameId: 'g-noise',
        process: null,
        eventCount: 0,
        status: 'RUNNING',
        startedAt: new Date(),
      });

      // pino JSON lines / engine chatter that slips onto stdout parse as
      // JSON but carry no string .type — each used to hit the default case
      // ("Unknown message type: undefined" spam). None may crash or count.
      (adapter as any).handleBridgeMessage('g-noise', { level: 30, msg: 'banner' });
      (adapter as any).handleBridgeMessage('g-noise', {});
      (adapter as any).handleBridgeMessage('g-noise', { type: undefined });
      (adapter as any).handleBridgeMessage('g-noise', { type: 42 });

      const state = (adapter as any).activeGames.get('g-noise');
      expect(state.eventCount).toBe(0); // never treated as an 'event'
      expect(state.status).toBe('RUNNING'); // never treated as 'done'
    });

    it('still processes messages with a valid string .type after a noise line', () => {
      (adapter as any).activeGames.set('g-clean', {
        gameId: 'g-clean',
        process: null,
        eventCount: 0,
        status: 'RUNNING',
        startedAt: new Date(),
      });

      (adapter as any).handleBridgeMessage('g-clean', { level: 30, msg: 'chatter' });
      (adapter as any).handleBridgeMessage('g-clean', {
        type: 'event',
        eventType: 'MESSAGE',
        round: 1,
        phase: 'DAY_DISCUSSION',
        playerId: 'p1',
        playerName: 'Alice',
        timestamp: new Date().toISOString(),
        content: { message: 'hi' },
        visibility: 'PUBLIC',
      });

      const state = (adapter as any).activeGames.get('g-clean');
      expect(state.eventCount).toBe(1);
    });
  });
});
