/**
 * Tests for RunGameCommand
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunGameCommand } from '../commands/run-game.js';

describe('RunGameCommand', () => {
  let cmd: RunGameCommand;

  beforeEach(() => {
    cmd = new RunGameCommand();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is instantiable with expected name', () => {
    expect(cmd).toBeDefined();
    expect(cmd.name()).toBe('run-game');
  });

  it('has a description', () => {
    expect(cmd.description()).toBeTruthy();
    expect(typeof cmd.description()).toBe('string');
  });

  it('has expected options', () => {
    const optFlags = cmd.options.map((o: { flags: string }) => o.flags);
    expect(optFlags.some((f: string) => f.includes('config'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('players'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('provider'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('model'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('auto'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('watch'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('server'))).toBe(true);
  });

  it('starts a game with --auto flag via POST /api/v1/games', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ success: true, data: { gameId: 'game-456', status: 'setup' } }),
      text: async () => '',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await cmd.parseAsync(['node', 'test', '--auto']);

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = (fetch as any).mock.calls[0][0];
    expect(url).toContain('/api/v1/games');
    expect((fetch as any).mock.calls[0][1].method).toBe('POST');
  });

  it('starts a game with --yes flag (alias for --auto) via POST /api/v1/games', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ success: true, data: { gameId: 'game-789', status: 'setup' } }),
      text: async () => '',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await cmd.parseAsync(['node', 'test', '--yes']);

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = (fetch as any).mock.calls[0][0];
    expect(url).toContain('/api/v1/games');
    expect((fetch as any).mock.calls[0][1].method).toBe('POST');
  });

  it('exits with code 1 on server connection error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    await cmd.parseAsync(['node', 'test', '--auto']);

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits with code 1 on API error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Server Error',
    }));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    await cmd.parseAsync(['node', 'test', '--auto']);

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('provides default game config', () => {
    const config = cmd['getDefaultGameConfig']();
    expect(config).toBeDefined();
    expect(config.numPlayers).toBe(10);
    expect(config.llmProvider).toBe('openai');
    expect(config.llmModel).toBe('openai/gpt-4o-mini');
    expect(config.nightDuration).toBe(60);
    expect(config.dayDuration).toBe(120);
    expect(config.votingDuration).toBe(30);
    expect(config.roles).toHaveLength(5);
  });
});
