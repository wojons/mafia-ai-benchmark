/**
 * Tests for WatchGameCommand
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WatchGameCommand } from '../commands/watch-game.js';

describe('WatchGameCommand', () => {
  let cmd: WatchGameCommand;

  beforeEach(() => {
    cmd = new WatchGameCommand();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is instantiable with expected name', () => {
    expect(cmd).toBeDefined();
    expect(cmd.name()).toBe('watch-game');
  });

  it('has a description', () => {
    expect(cmd.description()).toBeTruthy();
    expect(typeof cmd.description()).toBe('string');
  });

  it('expects a <game-id> argument', () => {
    // Commander exposes registered arguments via args or the args method
    expect(cmd.args.length).toBe(0); // args not set until parse()
    const registeredArgs = (cmd as any)._args;
    expect(registeredArgs.length).toBeGreaterThanOrEqual(1);
    expect(registeredArgs[0].name()).toBe('game-id');
  });

  it('has server and no-color options', () => {
    const optFlags = cmd.options.map((o: { flags: string }) => o.flags);
    expect(optFlags.some((f: string) => f.includes('server'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('no-color'))).toBe(true);
  });

  it('displayMessage handles GAME_JOINED event', () => {
    cmd['displayMessage']({ type: 'GAME_JOINED' });
    expect(console.log).toHaveBeenCalled();
  });

  it('displayMessage handles GAME_STATE event', () => {
    const state = {
      phase: 'NIGHT',
      dayNumber: 2,
      turnNumber: 5,
      timeRemaining: 30,
      activePlayers: ['Alice', 'Bob', 'Charlie'],
    };
    cmd['displayMessage']({ type: 'GAME_STATE', payload: state });
    expect(console.log).toHaveBeenCalled();
  });

  it('displayMessage handles GAME_EVENT with PHASE_CHANGED', () => {
    cmd['displayMessage']({
      type: 'GAME_EVENT',
      payload: { type: 'PHASE_CHANGED', data: { fromPhase: 'NIGHT', toPhase: 'DAY' } },
    });
    expect(console.log).toHaveBeenCalled();
  });

  it('displayMessage handles GAME_EVENT with PLAYER_KILLED', () => {
    cmd['displayMessage']({
      type: 'GAME_EVENT',
      payload: { type: 'PLAYER_KILLED', data: { playerName: 'Bob', role: 'VILLAGER' } },
    });
    expect(console.log).toHaveBeenCalled();
  });

  it('displayMessage handles GAME_EVENT with WINNER_DETERMINED', () => {
    cmd['displayMessage']({
      type: 'GAME_EVENT',
      payload: { type: 'WINNER_DETERMINED', data: { winner: 'MAFIA', mafiaCount: 2, townCount: 1 } },
    });
    expect(console.log).toHaveBeenCalled();
  });

  it('displayMessage handles ERROR event', () => {
    cmd['displayMessage']({ type: 'ERROR', payload: { message: 'Game not found' } });
    expect(console.error).toHaveBeenCalled();
  });

  it('displayGameState shows player list when present', () => {
    const state = {
      phase: 'DAY',
      dayNumber: 1,
      turnNumber: 3,
      timeRemaining: 60,
      activePlayers: ['Alice', 'Bob'],
    };
    cmd['displayGameState'](state);
    expect(console.log).toHaveBeenCalled();
  });
});
