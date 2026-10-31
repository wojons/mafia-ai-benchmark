import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// React 18 act() companion flag for the client-render wiring test.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Provide localStorage on globalThis before any module imports so zustand's
// persist middleware (uiStore) can initialize in the node test environment.
const { localStore } = vi.hoisted(() => {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { Object.keys(store).forEach(k => { delete store[k]; }); },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    },
    configurable: true,
    writable: true,
  });
  return { localStore: store };
});

vi.mock('../services/api', () => ({
  api: {
    games: {
      getAll: vi.fn().mockResolvedValue([]),
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
    stats: {
      getGameStats: vi.fn().mockResolvedValue(null),
    },
  },
}));

import GameCard, { getStatusPhaseLabel } from '../components/GameCard';
import GameList from '../components/GameList';
import { useGameStore } from '../stores/gameStore';
import { api } from '../services/api';

// The verified GET /api/v1/games list-row shape (DF-MAFIA-AI-BENCHMARK-13,
// live-probed 2026-09-25): players is a NUMBER, there is NO currentState.
const LIST_ROW = {
  id: 'game-abc12345-6789',
  createdAt: new Date().toISOString(),
  players: 10,
  status: 'IN_PROGRESS',
  config: { numPlayers: 10 },
};

function renderPageAt(path: string): string {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<GameList />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('GameCard render vs real list payload (DF-MAFIA-AI-BENCHMARK-13)', () => {
  beforeAll(() => {
    // React 18's SSR useSyncExternalStore path warns; keep output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders the numeric player count from the list row', () => {
    const html = renderToString(
      <GameCard game={LIST_ROW} onOpen={() => undefined} onWatch={() => undefined} />
    );
    // Player count straight from the numeric `players` field — not
    // game.players.length (undefined) on the verified payload shape.
    expect(html).toMatch(/class="count">10<\/span>/);
    expect(html).toContain('Players');
  });

  it('renders a real phase label from the row status — never N/A', () => {
    const html = renderToString(
      <GameCard game={LIST_ROW} onOpen={() => undefined} onWatch={() => undefined} />
    );
    // A real phase/status label mapped from the row's own status — never
    // 'Phase: N/A' (list rows carry no currentState).
    expect(html).toContain('In Progress');
    expect(html).not.toContain('N/A');
  });

  it('maps every GameStatus to a real label, unknown falls back to the raw status', () => {
    expect(getStatusPhaseLabel('SETUP')).toBe('Setup');
    expect(getStatusPhaseLabel('IN_PROGRESS')).toBe('In Progress');
    expect(getStatusPhaseLabel('PAUSED')).toBe('Paused');
    expect(getStatusPhaseLabel('ENDED')).toBe('Game Over');
    expect(getStatusPhaseLabel('CANCELLED')).toBe('Cancelled');
    expect(getStatusPhaseLabel('SOMETHING_ELSE')).toBe('SOMETHING ELSE');
  });

  it('shows the Watch button for IN_PROGRESS rows', () => {
    const html = renderToString(
      <GameCard game={LIST_ROW} onOpen={() => undefined} onWatch={() => undefined} />
    );
    expect(html).toContain('Watch');
  });
});

describe('GameList ?action=new opens the create modal (DF-MAFIA-AI-BENCHMARK-13)', () => {
  it('mounting the Games page with ?action=new opens the create-game modal', () => {
    const html = renderPageAt('/?action=new');

    // The existing create-game modal (title "Create New Game") must be open —
    // no second modal, same one the header button opens.
    expect(html).toContain('Create New Game');
  });

  it('does NOT open the modal without the action=new param', () => {
    const html = renderPageAt('/');
    expect(html).not.toContain('Create New Game');
  });
});

// ============================================================================
// Games-tab headline counts come from /stats, not the games page
// (DF-MAFIA-AI-BENCHMARK-32).
//
// Before this task the stats bar rendered games.length and per-status tallies
// of the 50-row GET /api/v1/games?limit=50 page, so with a real 4007-game DB
// the Games tab read "Total Games: 50, Completed: 49" while the Stats tab
// (GET /api/v1/stats) showed 4007/3884 — two contradicting sources of truth.
// The headline bar must render the /stats totals; the page window's rows only
// drive the grid.
//
// NOTE: these tests use CLIENT rendering (createRoot + act), not
// renderToString — under SSR zustand's useSyncExternalStore serves
// getInitialState(), so current store state is invisible there, and the
// headline numbers arrive via effect-time fetches anyway (the real flow).
// ============================================================================
const STATS_TOTALS = {
  totalGames: 4007,
  activeGames: 7,
  completedGames: 3884,
};

const PAGE_ROWS = Array.from({ length: 50 }, (_, i) => ({
  id: `page-row-${i}`,
  createdAt: new Date().toISOString(),
  players: 10,
  status: i === 0 ? 'SETUP' : 'IN_PROGRESS',
  config: { numPlayers: 10 },
}));

// Mount GameList as a real client root and flush the mount effects (the
// games-window fetch and the /stats headline fetch) to completion.
async function renderClient(path: string): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<GameList />} />
        </Routes>
      </MemoryRouter>
    );
  });
  return container;
}

function unmountClient(container: HTMLElement): void {
  const root = (container as { _reactRootContainer?: unknown; __reactContainer$?: unknown })._reactRootContainer
    ? (container as unknown as { _reactRootContainer: { unmount: () => void } })
    : null;
  // React 18 exposes the root only internally; keep a module-level handle.
  void root;
  clientRoots.get(container)?.unmount();
  container.remove();
  clientRoots.delete(container);
}

const clientRoots = new Map<HTMLElement, ReturnType<typeof createRoot>>();

describe('GameList headline counts from /stats (DF-MAFIA-AI-BENCHMARK-32)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGameStore.setState({
      games: [],
      headlineStats: null,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders Total/Completed/Active headline values from the /stats totals, not the games page', async () => {
    (api.games.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(PAGE_ROWS);
    (api.stats.getGameStats as ReturnType<typeof vi.fn>).mockResolvedValue(STATS_TOTALS);

    const container = await renderClient('/');
    try {
      const html = container.innerHTML;

      // Headlines carry the /stats numbers.
      expect(html).toMatch(/class="stat-value">4007</);
      expect(html).toMatch(/class="stat-value">3884</);
      expect(html).toMatch(/class="stat-value green">7</);
      // The 50-row page window is NOT presented as a total.
      expect(html).not.toMatch(/class="stat-value">50</);
      expect(html).not.toMatch(/class="stat-value">49</);
    } finally {
      unmountClient(container);
    }
  });

  it('still renders all 50 page rows in the grid while headlines show /stats totals', async () => {
    (api.games.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(PAGE_ROWS);
    (api.stats.getGameStats as ReturnType<typeof vi.fn>).mockResolvedValue(STATS_TOTALS);

    const container = await renderClient('/');
    try {
      const html = container.innerHTML;

      // Page rows drive the grid (one game-id per row), never the headlines.
      expect((html.match(/class="game-id"/g) ?? []).length).toBe(50);
      expect(html).toMatch(/class="stat-value">4007</);
      expect(html).toMatch(/class="stat-value">3884</);
    } finally {
      unmountClient(container);
    }
  });

  it('renders — placeholders while /stats has not resolved (no fallback to page counts)', async () => {
    (api.games.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(PAGE_ROWS);
    let resolveStats!: (v: unknown) => void;
    (api.stats.getGameStats as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => { resolveStats = resolve; })
    );

    const container = await renderClient('/');
    try {
      // Pending /stats: placeholders instead of page-window numbers, but the
      // games grid still shows the fetched page window.
      expect(container.innerHTML).toMatch(/class="stat-value">—</);
      expect(container.innerHTML).not.toMatch(/class="stat-value">50</);
      expect(container.innerHTML).not.toMatch(/class="stat-value">49</);
      expect((container.innerHTML.match(/class="game-id"/g) ?? []).length).toBe(50);

      // And once /stats resolves, the true totals take over.
      await act(async () => {
        resolveStats(STATS_TOTALS);
      });
      expect(container.innerHTML).toMatch(/class="stat-value">4007</);
      expect(container.innerHTML).toMatch(/class="stat-value">3884</);
    } finally {
      unmountClient(container);
    }
  });

  it('keeps placeholders when /stats fails — page rows still never become totals', async () => {
    (api.games.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(PAGE_ROWS);
    (api.stats.getGameStats as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('HTTP 500')
    );

    const container = await renderClient('/');
    try {
      expect(container.innerHTML).toMatch(/class="stat-value">—</);
      expect(container.innerHTML).not.toMatch(/class="stat-value">50</);
      expect(container.innerHTML).toContain('Total Games');
      expect(container.innerHTML).toContain('Completed');
    } finally {
      unmountClient(container);
    }
  });

  it('fetches /stats headline totals when the Games tab mounts and stores them', async () => {
    (api.games.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(PAGE_ROWS);
    (api.stats.getGameStats as ReturnType<typeof vi.fn>).mockResolvedValue(STATS_TOTALS);

    const container = await renderClient('/');
    try {
      expect(api.stats.getGameStats).toHaveBeenCalledTimes(1);
      expect(useGameStore.getState().headlineStats).toEqual({
        totalGames: 4007,
        activeGames: 7,
        completedGames: 3884,
      });
    } finally {
      unmountClient(container);
    }
  });
});

// localStore referenced so the hoisted shim is not tree-shaken by lint.
void localStore;