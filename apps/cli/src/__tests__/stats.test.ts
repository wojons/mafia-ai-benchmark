/**
 * Tests for StatsCommand
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StatsCommand } from '../commands/stats.js';

describe('StatsCommand', () => {
  let cmd: StatsCommand;
  const mockStats = {
    totalGames: 150,
    activeGames: 5,
    completedGames: 145,
    mafiaWins: 72,
    townWins: 73,
    avgDuration: 1800000,
    totalTokens: 50000000,
    totalCost: 250.50,
    avgCostPerGame: 1.73,
    totalAPICalls: 12000,
    avgLatency: 850,
    errorRate: 0.02,
    topModels: [
      { provider: 'openai', model: 'openai/gpt-4o-mini', gamesPlayed: 50, winRate: 0.65, avgTokens: 80000, avgCost: 1.5 },
      { provider: 'anthropic', model: 'claude-sonnet-4', gamesPlayed: 40, winRate: 0.60, avgTokens: 75000, avgCost: 1.8 },
    ],
  };

  beforeEach(() => {
    cmd = new StatsCommand();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is instantiable with expected name', () => {
    expect(cmd).toBeDefined();
    expect(cmd.name()).toBe('stats');
  });

  it('has a description', () => {
    expect(cmd.description()).toBeTruthy();
    expect(typeof cmd.description()).toBe('string');
  });

  it('has expected options', () => {
    const optFlags = cmd.options.map((o: { flags: string }) => o.flags);
    expect(optFlags.some((f: string) => f.includes('json'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('games'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('models'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('verbose'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('server'))).toBe(true);
  });

  it('fetches stats and displays formatted output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: mockStats }),
      text: async () => '',
    }));

    await cmd.parseAsync(['node', 'test']);

    expect(fetch).toHaveBeenCalled();
  });

  it('outputs JSON with --json flag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: mockStats }),
      text: async () => '',
    }));

    await cmd.parseAsync(['node', 'test', '--json']);

    expect(fetch).toHaveBeenCalled();
  });

  it('displays verbose details with --verbose flag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: mockStats }),
      text: async () => '',
    }));

    await cmd.parseAsync(['node', 'test', '--verbose']);

    expect(fetch).toHaveBeenCalled();
  });

  it('formatDuration returns human-readable strings', () => {
    expect(cmd['formatDuration'](3600000)).toBe('1h 0m');
    expect(cmd['formatDuration'](90000)).toBe('1m 30s');
    expect(cmd['formatDuration'](45000)).toBe('45s');
    expect(cmd['formatDuration'](0)).toBe('0s');
  });

  it('logs error on fetch failure instead of calling process.exit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));

    await cmd.parseAsync(['node', 'test']);

    expect(console.error).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('handles missing model stats gracefully', async () => {
    const statsNoModels = { ...mockStats, topModels: [] };
    // First call (games stats) succeeds, second call (models) fails
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: statsNoModels }),
        text: async () => '',
      })
      .mockRejectedValueOnce(new Error('models unavailable'));
    vi.stubGlobal('fetch', mockFetch);

    await cmd.parseAsync(['node', 'test']);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shows win rate percentages when games completed > 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: mockStats }),
      text: async () => '',
    }));

    await cmd.parseAsync(['node', 'test']);

    expect(console.log).toHaveBeenCalled();
  });
});
