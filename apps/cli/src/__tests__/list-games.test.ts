/**
 * Tests for ListGamesCommand
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ListGamesCommand } from '../commands/list-games.js';

describe('ListGamesCommand', () => {
  let cmd: ListGamesCommand;

  beforeEach(() => {
    cmd = new ListGamesCommand();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is instantiable with expected name', () => {
    expect(cmd).toBeDefined();
    expect(cmd.name()).toBe('list-games');
  });

  it('has a description', () => {
    expect(cmd.description()).toBeTruthy();
    expect(typeof cmd.description()).toBe('string');
  });

  it('has expected options', () => {
    const optFlags = cmd.options.map((o: { flags: string }) => o.flags);
    expect(optFlags.some((f: string) => f.includes('status'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('limit'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('json'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('server'))).toBe(true);
  });

  it('fetches games and displays table', async () => {
    const mockGames = [
      { id: 'game-1', status: 'IN_PROGRESS', players: 8, createdAt: '2026-07-20' },
      { id: 'game-2', status: 'ENDED', players: 10, createdAt: '2026-07-19' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: mockGames }),
      text: async () => '',
    }));

    cmd.parse(['node', 'test']);
    await cmd.run();

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = (fetch as any).mock.calls[0][0];
    expect(url).toContain('/api/v1/games');
  });

  it('outputs JSON with --json flag', async () => {
    const mockGames = [
      { id: 'game-1', status: 'SETUP', players: 6, createdAt: 1721400000000 },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: mockGames }),
      text: async () => '',
    }));

    cmd.parse(['node', 'test', '--json']);
    await cmd.run();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('displays empty message when no games found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [] }),
      text: async () => '',
    }));

    cmd.parse(['node', 'test']);
    await cmd.run();

    expect(console.log).toHaveBeenCalled();
  });

  it('logs error on fetch failure instead of calling process.exit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));

    cmd.parse(['node', 'test']);
    await cmd.run();

    expect(console.error).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('getStatusColor returns appropriate chalk function', () => {
    const blue = cmd['getStatusColor']('SETUP');
    const green = cmd['getStatusColor']('IN_PROGRESS');
    const gray = cmd['getStatusColor']('ENDED');
    const white = cmd['getStatusColor']('UNKNOWN');

    expect(typeof blue).toBe('function');
    expect(typeof green).toBe('function');
    expect(typeof gray).toBe('function');
    expect(typeof white).toBe('function');
  });
});
