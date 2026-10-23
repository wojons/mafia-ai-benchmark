import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';

// React 18 act() companion flag for the client-render wiring test.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// PERF-MAFIA-4: the Stats tab used to fan out one GET /api/v1/games/:id per
// ENDED history row (39-43 extra requests, ~2020 ms aggregate cold) because
// the list payload carried no winner / endedAt / duration. These tests mount
// the real dashboard with the API module mocked and count the calls: the
// history table must render straight from the single list response.
const apiMocks = vi.hoisted(() => {
  const gamesAPI = {
    getAll: vi.fn(),
    get: vi.fn(),
  };
  const statsAPI = {
    getGameStats: vi.fn(),
    getMatchups: vi.fn(),
  };
  const benchmarkAPI = {
    compare: vi.fn(),
  };
  return { gamesAPI, statsAPI, benchmarkAPI };
});

vi.mock('../services/api', () => ({
  gamesAPI: apiMocks.gamesAPI,
  statsAPI: apiMocks.statsAPI,
  benchmarkAPI: apiMocks.benchmarkAPI,
  api: {
    games: apiMocks.gamesAPI,
    stats: apiMocks.statsAPI,
  },
}));

// chart.js cannot paint in this DOM; the dashboard only needs the charts to
// mount, not to draw.
vi.mock('react-chartjs-2', () => ({
  Doughnut: () => null,
  Line: () => null,
}));

vi.mock('chart.js', () => ({
  Chart: { register: () => undefined },
  ArcElement: {},
  Tooltip: {},
  Legend: {},
  CategoryScale: {},
  LinearScale: {},
  BarElement: {},
  PointElement: {},
  LineElement: {},
  Filler: {},
}));

import BenchmarkDashboard from '../components/BenchmarkDashboard';
import { gamesAPI, statsAPI, benchmarkAPI } from '../services/api';

/**
 * The list payload the fixed server serves (GET /api/v1/games?limit=50):
 * terminal state is on the row itself, so no detail call is required.
 */
const LIST_ROWS = [
  {
    id: 'ended-game-0001',
    status: 'ENDED',
    players: 6,
    createdAt: '2026-09-25T20:00:00.000Z',
    endedAt: '2026-09-25T20:14:30.000Z',
    winner: 'MAFIA',
    duration: 870_000,
    config: { numPlayers: 6 },
  },
  {
    id: 'ended-game-0002',
    status: 'ENDED',
    players: 5,
    createdAt: '2026-09-25T21:00:00.000Z',
    endedAt: '2026-09-25T21:02:00.000Z',
    winner: 'TOWN',
    duration: 120_000,
    config: { numPlayers: 5 },
  },
  {
    id: 'running-game-0003',
    status: 'IN_PROGRESS',
    players: 8,
    createdAt: '2026-09-25T22:00:00.000Z',
    endedAt: null,
    winner: null,
    duration: null,
    config: { numPlayers: 8 },
  },
];

const STATS = {
  totalGames: 40,
  activeGames: 1,
  completedGames: 39,
  avgDuration: 300_000,
  mafiaWins: 20,
  townWins: 19,
};

describe('Stats tab Game History needs no per-row detail fetch (PERF-MAFIA-4)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.statsAPI.getGameStats.mockResolvedValue({ data: STATS });
    apiMocks.statsAPI.getMatchups.mockResolvedValue({ data: [] });
    apiMocks.benchmarkAPI.compare.mockResolvedValue({ models: [] });
    apiMocks.gamesAPI.getAll.mockResolvedValue({ data: LIST_ROWS });
    apiMocks.gamesAPI.get.mockImplementation(() => {
      throw new Error('per-row detail fetch — the N+1 this task removes');
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
  });

  it('renders winner and duration from the single list response', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<BenchmarkDashboard />);
    });

    const text = container.textContent ?? '';
    // Winner column came from the list row's decoded winner field.
    expect(text).toContain('Mafia');
    expect(text).toContain('Town');
    // Duration column: endedAt - createdAt, straight from the list row.
    expect(text).toContain('14m 30s');
    expect(text).toContain('2m 0s');
  });

  it('issues ONE games request (no per-row GET /api/v1/games/:id)', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<BenchmarkDashboard />);
    });

    expect(apiMocks.gamesAPI.getAll).toHaveBeenCalledTimes(1);
    expect(apiMocks.gamesAPI.getAll).toHaveBeenCalledWith({ limit: 50 });
    // The N+1: one detail request per ENDED row.
    expect(apiMocks.gamesAPI.get).not.toHaveBeenCalled();
  });

  it('keeps the whole cold load within the 5-request budget', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<BenchmarkDashboard />);
    });

    const statsCalls = apiMocks.statsAPI.getGameStats.mock.calls.length;
    const matchupCalls = apiMocks.statsAPI.getMatchups.mock.calls.length;
    const compareCalls = apiMocks.benchmarkAPI.compare.mock.calls.length;
    const listCalls = apiMocks.gamesAPI.getAll.mock.calls.length;
    const detailCalls = apiMocks.gamesAPI.get.mock.calls.length;

    expect(statsCalls).toBe(1);
    expect(matchupCalls).toBe(1);
    expect(compareCalls).toBe(1);
    expect(listCalls).toBe(1);
    // AC: at most 5 requests total on a cold /stats load.
    expect(statsCalls + matchupCalls + compareCalls + listCalls + detailCalls).toBeLessThanOrEqual(5);
  });
});
