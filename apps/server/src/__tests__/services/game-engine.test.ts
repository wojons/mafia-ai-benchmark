import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../services/game-engine.js';
import {
  createFakeGameRepository,
  createFakeEventBus,
  createFakeStatsCollector,
  makeTestConfig,
  makeTestGame,
  makeTestPlayer,
} from './mocks.js';
import type { Game } from '@mafia/shared/types';

describe('GameEngine', () => {
  let repo: ReturnType<typeof createFakeGameRepository>;
  let eventBus: ReturnType<typeof createFakeEventBus>;
  let stats: ReturnType<typeof createFakeStatsCollector>;
  let engine: GameEngine;

  beforeEach(() => {
    repo = createFakeGameRepository();
    eventBus = createFakeEventBus();
    stats = createFakeStatsCollector();
    engine = new GameEngine(repo, {} as any, eventBus, stats);
  });

  // ==========================================================================
  // createGame
  // ==========================================================================

  describe('createGame()', () => {
    it('creates a game with default config when called with no options', () => {
      const game = engine.createGame();

      expect(game).toBeDefined();
      expect(game.id).toBeTruthy();
      expect(game.status).toBe('SETUP');
      // Default numPlayers per source defaults
      expect(game.config.numPlayers).toBe(10);
      expect(game.config.minPlayers).toBe(5);
      expect(game.config.maxPlayers).toBe(12);
      expect(game.config.allowSelfVote).toBe(false);
      expect(game.config.tieBreaker).toBe('RANDOM');
    });

    it('merges partial config overrides into the game config', () => {
      const partial = { numPlayers: 7, minPlayers: 6, allowSelfVote: true };
      const game = engine.createGame({ config: partial });

      expect(game.config.numPlayers).toBe(7);
      expect(game.config.minPlayers).toBe(6);
      expect(game.config.allowSelfVote).toBe(true);
      // Untouched defaults survive
      expect(game.config.maxPlayers).toBe(12);
      expect(game.config.tieBreaker).toBe('RANDOM');
    });

    it('registers the new game with the repository', () => {
      const game = engine.createGame();
      const fetched = repo.getGame(game.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(game.id);
    });

    it('tracks the new game in activeGames', () => {
      const game = engine.createGame();
      expect(engine.getActiveGames()).toContain(game.id);
    });
  });

  // ==========================================================================
  // startGame
  // ==========================================================================

  describe('startGame()', () => {
    function gameWithPlayers(numPlayers: number): Game {
      const config = makeTestConfig({ numPlayers, minPlayers: Math.min(numPlayers, 5) });
      const players = Array.from({ length: numPlayers }, (_, i) =>
        makeTestPlayer({ id: `p${i}`, name: `P${i}`, joinOrder: i, role: 'UNASSIGNED' })
      );
      return makeTestGame({ id: 'g1', config, players, status: 'SETUP' });
    }

    it('transitions a fully-populated game to IN_PROGRESS', () => {
      const game = gameWithPlayers(5);
      repo.seedGame(game);

      const result = engine.startGame(game.id);

      expect(result.success).toBe(true);
      expect(result.event).toBeDefined();
      expect(result.event?.type).toBe('GAME_STARTED');
      expect(repo._state.games.get(game.id)?.status).toBe('IN_PROGRESS');
    });

    it('returns an error when the game does not exist', () => {
      const result = engine.startGame('does-not-exist');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Game not found');
    });

    it('rejects when the game is not in SETUP status', () => {
      const game = gameWithPlayers(5);
      game.status = 'IN_PROGRESS';
      repo.seedGame(game);

      const result = engine.startGame(game.id);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Game is already in progress');
    });

    it('rejects when fewer than minPlayers are alive', () => {
      const game = gameWithPlayers(5);
      game.config.minPlayers = 8;
      repo.seedGame(game);

      const result = engine.startGame(game.id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Not enough players/);
    });

    it('assigns roles to all joined players and emits ROLES_ASSIGNED', () => {
      const game = gameWithPlayers(5);
      repo.seedGame(game);

      const result = engine.startGame(game.id);
      expect(result.success).toBe(true);

      const allEvents = repo.getAllEvents();
      const rolesEvent = allEvents.find(e => e.type === 'ROLES_ASSIGNED');
      expect(rolesEvent).toBeDefined();
      const assignments = (rolesEvent?.data as any).assignments;
      expect(assignments).toHaveLength(5);

      // Every player now has a non-UNASSIGNED role.
      const players = repo.getPlayers(game.id);
      for (const p of players) {
        expect(['MAFIA', 'DOCTOR', 'SHERIFF', 'VIGILANTE', 'VILLAGER']).toContain(p.role);
      }
    });
  });

  // ==========================================================================
  // joinGame
  // ==========================================================================

  describe('joinGame()', () => {
    it('rejects join when the game does not exist', () => {
      const result = engine.joinGame('missing', 'Alice');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Game not found');
    });

    it('rejects duplicate player names', () => {
      const game = makeTestGame({
        id: 'g-dup',
        players: [makeTestPlayer({ id: 'p1', name: 'Alice' })],
      });
      repo.seedGame(game);

      const result = engine.joinGame('g-dup', 'Alice');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Player name already taken');
    });

    it('rejects when the game is full', () => {
      const players = Array.from({ length: 5 }, (_, i) =>
        makeTestPlayer({ id: `p${i}`, name: `P${i}` })
      );
      const game = makeTestGame({ id: 'g-full', players, config: makeTestConfig({ maxPlayers: 5 }) });
      repo.seedGame(game);

      const result = engine.joinGame('g-full', 'Newcomer');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Game is full');
    });

    it('adds a player and emits a PLAYER_JOINED event on success', () => {
      const game = makeTestGame({ id: 'g-ok', players: [] });
      repo.seedGame(game);

      const result = engine.joinGame('g-ok', 'Bob', { provider: 'OPENAI', model: 'gpt-4' });
      expect(result.success).toBe(true);
      expect(result.event?.type).toBe('PLAYER_JOINED');
      expect(repo.getPlayers('g-ok')).toHaveLength(1);
      expect(repo.getPlayers('g-ok')[0].name).toBe('Bob');
    });
  });

  // ==========================================================================
  // submitNightAction
  // ==========================================================================

  describe('submitNightAction()', () => {
    function nightGame(): Game {
      const players = [
        makeTestPlayer({ id: 'mafia', name: 'M', role: 'MAFIA', isMafia: true }),
        makeTestPlayer({ id: 'doc', name: 'D', role: 'DOCTOR' }),
        makeTestPlayer({ id: 'vic', name: 'V', role: 'VILLAGER' }),
      ];
      return makeTestGame({
        id: 'g-night',
        players,
        status: 'IN_PROGRESS',
        currentState: {
          phase: 'NIGHT_ACTIONS',
          dayNumber: 1,
          turnNumber: 1,
          timeRemaining: 60,
          activePlayers: players.map(p => p.id),
          eliminatedPlayers: [],
          votes: [],
          nightActions: [],
        },
      });
    }

    it('accepts a MAFIA_KILL action from the mafia', () => {
      const game = nightGame();
      repo.seedGame(game);

      const result = engine.submitNightAction('g-night', 'mafia', 'MAFIA_KILL', 'vic');
      expect(result.success).toBe(true);
      expect(result.event?.type).toBe('NIGHT_ACTION_SUBMITTED');
      expect((result.event?.data as any).action).toBe('MAFIA_KILL');
    });

    it('rejects when the game is not in NIGHT_ACTIONS phase', () => {
      const game = nightGame();
      game.currentState.phase = 'DAY_DISCUSSION';
      repo.seedGame(game);

      const result = engine.submitNightAction('g-night', 'mafia', 'MAFIA_KILL', 'vic');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not in night phase');
    });

    it('rejects an action from a dead player', () => {
      const game = nightGame();
      const mafia = game.players.find(p => p.id === 'mafia')!;
      mafia.isAlive = false;
      repo.seedGame(game);

      const result = engine.submitNightAction('g-night', 'mafia', 'MAFIA_KILL', 'vic');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Player is eliminated');
    });

    it('rejects when the player is not in the game', () => {
      const game = nightGame();
      repo.seedGame(game);

      const result = engine.submitNightAction('g-night', 'unknown-pid', 'MAFIA_KILL', 'vic');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Player not found');
    });
  });

  // ==========================================================================
  // submitVote
  // ==========================================================================

  describe('submitVote()', () => {
    function votingGame(): Game {
      const players = [
        makeTestPlayer({ id: 'a', name: 'A' }),
        makeTestPlayer({ id: 'b', name: 'B' }),
      ];
      return makeTestGame({
        id: 'g-vote',
        players,
        status: 'IN_PROGRESS',
        currentState: {
          phase: 'DAY_VOTING',
          dayNumber: 1,
          turnNumber: 1,
          timeRemaining: 30,
          activePlayers: players.map(p => p.id),
          eliminatedPlayers: [],
          votes: [],
          nightActions: [],
        },
      });
    }

    it('records a vote and increments voteNumber when accepted', () => {
      const game = votingGame();
      repo.seedGame(game);

      const result = engine.submitVote('g-vote', 'a', 'b');
      expect(result.success).toBe(true);
      expect(result.event?.type).toBe('VOTE_CAST');
      expect((result.event?.data as any).targetId).toBe('b');
      expect((result.event?.data as any).voteNumber).toBe(1);
      expect((result.event?.data as any).final).toBe(true);
    });

    it('rejects self-voting when allowSelfVote is false', () => {
      const game = votingGame();
      repo.seedGame(game);

      const result = engine.submitVote('g-vote', 'a', 'a');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Self-voting is not allowed');
    });

    it('permits self-voting when allowSelfVote is true', () => {
      const game = votingGame();
      game.config.allowSelfVote = true;
      repo.seedGame(game);

      const result = engine.submitVote('g-vote', 'a', 'a');
      expect(result.success).toBe(true);
    });

    it('rejects a vote from a dead voter', () => {
      const game = votingGame();
      const a = game.players.find(p => p.id === 'a')!;
      a.isAlive = false;
      repo.seedGame(game);

      const result = engine.submitVote('g-vote', 'a', 'b');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Voter is eliminated');
    });
  });

  // ==========================================================================
  // getGameState
  // ==========================================================================

  describe('getGameState()', () => {
    it('returns the current GameState for a known game', () => {
      const game = makeTestGame({
        id: 'g-state',
        currentState: {
          phase: 'DAY_VOTING',
          dayNumber: 3,
          turnNumber: 12,
          timeRemaining: 25,
          activePlayers: ['a', 'b'],
          eliminatedPlayers: ['c'],
          votes: [],
          nightActions: [],
        },
      });
      repo.seedGame(game);

      const state = engine.getGameState('g-state');
      expect(state).not.toBeNull();
      expect(state?.phase).toBe('DAY_VOTING');
      expect(state?.dayNumber).toBe(3);
      expect(state?.turnNumber).toBe(12);
      expect(state?.activePlayers).toEqual(['a', 'b']);
    });

    it('returns null when the game does not exist', () => {
      const state = engine.getGameState('missing');
      expect(state).toBeNull();
    });
  });

  // ==========================================================================
  // getActiveGames
  // ==========================================================================

  describe('getActiveGames()', () => {
    it('returns an array of active game IDs', () => {
      const g1 = engine.createGame();
      const g2 = engine.createGame();
      const active = engine.getActiveGames();
      expect(active).toContain(g1.id);
      expect(active).toContain(g2.id);
    });
  });

  // ==========================================================================
  // endGame / winner flow
  // ==========================================================================

  describe('endGame()', () => {
    it('marks the game ENDED, removes from active, and records winner', () => {
      const game = makeTestGame({
        id: 'g-end',
        status: 'IN_PROGRESS',
        players: [
          makeTestPlayer({ id: 'a', name: 'A', role: 'MAFIA', isMafia: true }),
          makeTestPlayer({ id: 'b', name: 'B', role: 'VILLAGER' }),
        ],
        startedAt: new Date(Date.now() - 5000),
        currentState: {
          phase: 'DAY_DISCUSSION',
          dayNumber: 2,
          turnNumber: 5,
          timeRemaining: 30,
          activePlayers: ['a', 'b'],
          eliminatedPlayers: [],
          votes: [],
          nightActions: [],
        },
      });
      repo.seedGame(game);

      engine.endGame('g-end', 'MAFIA');

      const fetched = repo.getGame('g-end');
      expect(fetched?.status).toBe('ENDED');
      expect(engine.getActiveGames()).not.toContain('g-end');

      const winnerEvent = repo.getAllEvents().find(e => e.type === 'WINNER_DETERMINED');
      expect(winnerEvent).toBeDefined();
      expect((winnerEvent?.data as any).winner).toBe('MAFIA');
    });

    it('persists won=1 for the winning side and won=0 for the losing side (MAF-GAP-043)', () => {
      const game = makeTestGame({
        id: 'g-won',
        status: 'IN_PROGRESS',
        players: [
          makeTestPlayer({ id: 'maf', name: 'Maf', role: 'MAFIA', isMafia: true }),
          makeTestPlayer({ id: 'town1', name: 'T1', role: 'VILLAGER' }),
          makeTestPlayer({ id: 'town2', name: 'T2', role: 'DOCTOR' }),
        ],
        startedAt: new Date(Date.now() - 5000),
        currentState: {
          phase: 'DAY_DISCUSSION',
          dayNumber: 2,
          turnNumber: 5,
          timeRemaining: 30,
          activePlayers: ['maf', 'town1', 'town2'],
          eliminatedPlayers: [],
          votes: [],
          nightActions: [],
        },
      });
      repo.seedGame(game);

      engine.endGame('g-won', 'MAFIA');

      const fetched = repo.getGame('g-won')!;
      expect(fetched.players.find(p => p.id === 'maf')).toMatchObject({ isMafia: true });
      expect((fetched.players.find(p => p.id === 'maf') as any).won).toBe(1);
      expect((fetched.players.find(p => p.id === 'town1') as any).won).toBe(0);
      expect((fetched.players.find(p => p.id === 'town2') as any).won).toBe(0);
    });

    it('is a no-op when the game does not exist', () => {
      // Should not throw.
      engine.endGame('does-not-exist', 'TOWN');
      expect(engine.getActiveGames()).not.toContain('does-not-exist');
    });
  });

  // ==========================================================================
  // claimRole / makeAccusation
  // ==========================================================================

  describe('claimRole() / makeAccusation()', () => {
    it('records a ROLE_CLAIMED event', () => {
      const game = makeTestGame({ id: 'g-claim' });
      repo.seedGame(game);

      const result = engine.claimRole('g-claim', 'p1', 'SHERIFF');
      expect(result.success).toBe(true);
      expect(result.event?.type).toBe('ROLE_CLAIMED');
      expect((result.event?.data as any).claimedRole).toBe('SHERIFF');
    });

    it('records an ACCUSATION_MADE event with evidence', () => {
      const game = makeTestGame({ id: 'g-acc' });
      repo.seedGame(game);

      const result = engine.makeAccusation('g-acc', 'p1', 'p2', 'mafia', 'low vote patterns');
      expect(result.success).toBe(true);
      expect(result.event?.type).toBe('ACCUSATION_MADE');
      const data = result.event?.data as any;
      expect(data.accusation).toBe('mafia');
      expect(data.evidence).toBe('low vote patterns');
    });
  });
});
