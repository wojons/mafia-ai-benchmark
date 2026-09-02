import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseMigrator } from '../../db/migrate.js';
import { GameRepository } from '../../db/repository.js';
import type { GameConfig, GamePhase } from '@mafia/shared/types';

/**
 * DF-MAFIA-AI-BENCHMARK-4: getGame() reported currentState.phase = SETUP
 * for every non-ENDED game — the phase was hardcoded and never advanced, so
 * live game state stayed frozen at SETUP for the whole game (misleading the
 * watch-game CLI and the web dashboard). The read side now derives
 * phase/dayNumber/turnNumber from the last persisted event's metadata:
 * addEvent() writes metadata.phase/dayNumber/turnNumber into the events
 * columns and getEvents() returns rows ORDER BY sequence, so the last event
 * is the most recent phase transition. The ENDED -> GAME_OVER status guard
 * is preserved, and a zero-event IN_PROGRESS game falls back to SETUP with
 * day/turn 1. This is read-side reporting only — no schema/engine change.
 */
describe('GameRepository.getGame — live phase derivation (DF-MAFIA-AI-BENCHMARK-4)', () => {
  let repo: GameRepository;

  function minimalConfig(): GameConfig {
    return {
      numPlayers: 6,
      roles: [],
      nightPhaseDuration: 60,
      dayPhaseDuration: 60,
      votingDuration: 30,
      maxPlayers: 10,
      minPlayers: 2,
      allowSelfVote: true,
      tieBreaker: 'RANDOM',
      enable3D: false,
      enableVoice: false,
      logLevel: 'INFO',
    };
  }

  beforeEach(() => {
    const migrator = new DatabaseMigrator(':memory:');
    migrator.initialize();
    repo = new GameRepository(migrator.getDatabase());
  });

  it('reports the last event phase (DAY_DISCUSSION), never SETUP, for an IN_PROGRESS game', () => {
    const game = repo.createGame(minimalConfig());
    repo.updateGameStatus(game.id, 'IN_PROGRESS');

    repo.addEvent(game.id, {
      type: 'ROLES_ASSIGNED',
      visibility: 'PUBLIC',
      data: { assignments: [] },
      metadata: { turnNumber: 1, dayNumber: 1, phase: 'SETUP', sequence: 1 },
    });
    repo.addEvent(game.id, {
      type: 'PHASE_CHANGED',
      visibility: 'PUBLIC',
      data: { from: 'SETUP', to: 'DAY_DISCUSSION' },
      metadata: { turnNumber: 5, dayNumber: 2, phase: 'DAY_DISCUSSION', sequence: 2 },
    });

    const loaded = repo.getGame(game.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe('IN_PROGRESS');
    expect(loaded!.currentState.phase).toBe('DAY_DISCUSSION');
    // dayNumber/turnNumber derive from the same last event's metadata.
    expect(loaded!.currentState.dayNumber).toBe(2);
    expect(loaded!.currentState.turnNumber).toBe(5);
  });

  it('keeps reporting GAME_OVER for an ENDED game (status guard preserved)', () => {
    const game = repo.createGame(minimalConfig());
    repo.updateGameStatus(game.id, 'IN_PROGRESS');

    repo.addEvent(game.id, {
      type: 'PHASE_CHANGED',
      visibility: 'PUBLIC',
      data: { from: 'SETUP', to: 'DAY_DISCUSSION' },
      metadata: { turnNumber: 1, dayNumber: 1, phase: 'DAY_DISCUSSION', sequence: 1 },
    });
    repo.updateGameStatus(game.id, 'ENDED');

    const loaded = repo.getGame(game.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe('ENDED');
    // Even though the last event carries DAY_DISCUSSION, an ENDED game
    // reports GAME_OVER.
    expect(loaded!.currentState.phase).toBe('GAME_OVER');
  });

  it('falls back to SETUP with day/turn 1 when an IN_PROGRESS game has no events', () => {
    const game = repo.createGame(minimalConfig());
    repo.updateGameStatus(game.id, 'IN_PROGRESS');

    const loaded = repo.getGame(game.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe('IN_PROGRESS');
    expect(loaded!.events).toHaveLength(0);
    expect(loaded!.currentState.phase).toBe('SETUP');
    expect(loaded!.currentState.dayNumber).toBe(1);
    expect(loaded!.currentState.turnNumber).toBe(1);
  });

  it('uses the most recent event when events advance through several phases', () => {
    const game = repo.createGame(minimalConfig());
    repo.updateGameStatus(game.id, 'IN_PROGRESS');

    const phases: Array<{ turn: number; day: number; phase: GamePhase }> = [
      { turn: 1, day: 1, phase: 'NIGHT_ACTIONS' },
      { turn: 2, day: 1, phase: 'MORNING_REVEAL' },
      { turn: 3, day: 1, phase: 'DAY_DISCUSSION' },
      { turn: 6, day: 2, phase: 'DAY_VOTING' },
    ];
    phases.forEach((p, i) => {
      repo.addEvent(game.id, {
        type: 'PHASE_CHANGED',
        visibility: 'PUBLIC',
        data: { to: p.phase },
        metadata: { turnNumber: p.turn, dayNumber: p.day, phase: p.phase, sequence: i + 1 },
      });
    });

    const loaded = repo.getGame(game.id);
    expect(loaded!.currentState.phase).toBe('DAY_VOTING');
    expect(loaded!.currentState.dayNumber).toBe(2);
    expect(loaded!.currentState.turnNumber).toBe(6);
  });
});
