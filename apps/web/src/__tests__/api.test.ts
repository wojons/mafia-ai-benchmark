import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

import { gamesAPI, statsAPI } from '../services/api';

describe('API Service', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns parsed JSON on successful response', async () => {
    const gameData = { id: '1', status: 'SETUP', config: {} };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(gameData)),
    });

    const result = await gamesAPI.get('1');
    expect(result).toEqual(gameData);
  });

  it('throws error with message and code on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: 'Game not found', code: 'NOT_FOUND' }),
    });

    await expect(gamesAPI.get('1')).rejects.toMatchObject({
      message: 'Game not found',
      code: 'NOT_FOUND',
      statusCode: 404,
      name: 'APIError',
    });
  });

  it('returns null for empty response body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(''),
    });

    const result = await gamesAPI.get('1');
    expect(result).toBeNull();
  });

  it('gamesAPI.getAll passes query parameters to URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify([])),
    });

    await gamesAPI.getAll({ status: 'IN_PROGRESS', limit: 5 });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('status=IN_PROGRESS');
    expect(url).toContain('limit=5');
  });

  it('gamesAPI.create sends POST with Content-Type JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ id: '2', status: 'SETUP', config: {} })),
    });

    await gamesAPI.create({ numPlayers: 5 });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual({ numPlayers: 5 });
  });

  it('statsAPI.getGameStats fetches from /stats endpoint', async () => {
    const stats = {
      totalGames: 10,
      activeGames: 3,
      completedGames: 7,
      avgDuration: 120,
      mafiaWins: 4,
      townWins: 6,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(stats)),
    });

    const result = await statsAPI.getGameStats();
    expect(result).toEqual(stats);
    expect((mockFetch.mock.calls[0][0] as string)).toContain('/stats');
  });
});
