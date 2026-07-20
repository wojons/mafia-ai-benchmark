import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies used by gameStore async actions
vi.mock('../services/api', () => ({
  api: {
    games: {
      getAll: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      join: vi.fn(),
      start: vi.fn(),
      submitNightAction: vi.fn(),
      submitVote: vi.fn(),
      makeAccusation: vi.fn(),
      claimRole: vi.fn(),
      getState: vi.fn(),
      getPlayers: vi.fn(),
      getEvents: vi.fn(),
    },
    agents: { getAll: vi.fn(), register: vi.fn(), getStats: vi.fn() },
    stats: { getGameStats: vi.fn(), getModelComparison: vi.fn(), getMatchups: vi.fn(), generateReport: vi.fn() },
    benchmark: { run: vi.fn() },
  },
}));

vi.mock('../services/websocket', () => ({
  websocket: {
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    send: vi.fn(),
    on: vi.fn(() => vi.fn()),
    off: vi.fn(),
  },
}));

import { useGameStore } from '../stores/gameStore';
import type { GameState, GameEvent } from '@mafia/shared/types';

const stateInitial = {
  connected: false,
  connecting: false,
  games: [],
  selectedGameId: null,
  currentGame: null,
  gameState: null,
  players: [],
  events: [],
  playerStats: new Map(),
  stats: {
    totalGames: 0,
    activeGames: 0,
    mafiaWins: 0,
    townWins: 0,
  },
};

describe('GameStore', () => {
  beforeEach(() => {
    useGameStore.setState(stateInitial);
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const state = useGameStore.getState();
    expect(state.connected).toBe(false);
    expect(state.games).toEqual([]);
    expect(state.currentGame).toBeNull();
    expect(state.gameState).toBeNull();
    expect(state.players).toEqual([]);
    expect(state.events).toEqual([]);
    expect(state.stats).toEqual({ totalGames: 0, activeGames: 0, mafiaWins: 0, townWins: 0 });
  });

  it('updateGameState sets gameState on the store', () => {
    const gameState: GameState = {
      phase: 'NIGHT_ACTIONS',
      dayNumber: 1,
      turnNumber: 1,
      timeRemaining: 30,
      activePlayers: ['p1', 'p2'],
      eliminatedPlayers: [],
      votes: [],
      nightActions: [],
    };

    useGameStore.getState().updateGameState(gameState);
    expect(useGameStore.getState().gameState).toEqual(gameState);
  });

  it('updatePlayers sets players on the store', () => {
    const players = [
      { id: 'p1', name: 'Alice', role: 'VILLAGER' as const, isAlive: true, isMafia: false, joinOrder: 1 },
      { id: 'p2', name: 'Bob', role: 'MAFIA' as const, isAlive: true, isMafia: true, joinOrder: 2 },
    ];

    useGameStore.getState().updatePlayers(players);
    expect(useGameStore.getState().players).toEqual(players);
  });

  it('addEvent appends event to events array', () => {
    const event: GameEvent = {
      id: 'e1',
      gameId: 'g1',
      type: 'PLAYER_JOINED',
      timestamp: new Date('2026-01-01'),
      visibility: 'PUBLIC',
      actorId: 'p1',
      data: {},
      metadata: { turnNumber: 1, dayNumber: 1, phase: 'SETUP', sequence: 1 },
    };

    useGameStore.getState().addEvent(event);
    expect(useGameStore.getState().events).toHaveLength(1);
    expect(useGameStore.getState().events[0]).toEqual(event);
  });

  it('addEvent with PHASE_CHANGED updates gameState phase', () => {
    // First set a known game state
    useGameStore.getState().updateGameState({
      phase: 'NIGHT_ACTIONS',
      dayNumber: 1,
      turnNumber: 1,
      timeRemaining: 30,
      activePlayers: ['p1'],
      eliminatedPlayers: [],
      votes: [],
      nightActions: [],
    });

    const phaseEvent: GameEvent = {
      id: 'e2',
      gameId: 'g1',
      type: 'PHASE_CHANGED',
      timestamp: new Date('2026-01-01'),
      visibility: 'PUBLIC',
      data: { toPhase: 'DAY_DISCUSSION' },
      metadata: { turnNumber: 2, dayNumber: 1, phase: 'DAY_DISCUSSION', sequence: 2 },
    };

    useGameStore.getState().addEvent(phaseEvent);
    expect(useGameStore.getState().gameState?.phase).toBe('DAY_DISCUSSION');
  });

  it('clearCurrentGame resets game-related state to null/empty', () => {
    // Set up some game state
    useGameStore.getState().updateGameState({
      phase: 'NIGHT_ACTIONS',
      dayNumber: 1,
      turnNumber: 1,
      timeRemaining: 30,
      activePlayers: [],
      eliminatedPlayers: [],
      votes: [],
      nightActions: [],
    });
    useGameStore.getState().updatePlayers([{ id: 'p1', name: 'Alice', role: 'VILLAGER', isAlive: true, isMafia: false, joinOrder: 1 }]);

    useGameStore.getState().clearCurrentGame();

    const state = useGameStore.getState();
    expect(state.currentGame).toBeNull();
    expect(state.gameState).toBeNull();
    expect(state.players).toEqual([]);
    expect(state.events).toEqual([]);
    expect(state.selectedGameId).toBeNull();
  });

  it('updateStats sets stats on the store', () => {
    const stats = { totalGames: 5, activeGames: 2, mafiaWins: 3, townWins: 2 };

    useGameStore.getState().updateStats(stats);
    expect(useGameStore.getState().stats).toEqual(stats);
  });
});
