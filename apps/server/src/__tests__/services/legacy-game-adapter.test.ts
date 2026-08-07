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
  });
});
