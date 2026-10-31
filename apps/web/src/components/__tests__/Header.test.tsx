import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

// React act() companion flag for the client-render wiring tests.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../services/api', () => ({
  api: {
    games: { getAll: vi.fn().mockResolvedValue([]) },
    stats: { getGameStats: vi.fn().mockResolvedValue(null) },
  },
}));

import Header from '../Header';
import { useGameStore } from '../../stores/gameStore';
import { api } from '../../services/api';

// The verified GET /api/v1/stats totals shape. The two headline values are
// DELIBERATELY distinct (4007 total vs 7 active) so the assertions below
// would also catch the two counters being swapped or cross-wired, not just
// a missing wire.
const STATS_TOTALS = {
  totalGames: 4007,
  activeGames: 7,
  completedGames: 3884,
};

// DF-MAFIA-AI-BENCHMARK-32-R2: before the fix the Header read the never-
// populated `stats` slice (updateStats had ZERO production callers), so the
// chrome printed "0 games active / 0 games total" on every page. These tests
// render <Header/> against a populated store and fail against that dead wire
// (it renders 0/0) while passing with the headlineStats wiring. They pin the
// wiring, not hardcoded numbers on the component: the numbers only appear
// because they were written into the store slice and the component renders
// exactly that slice.

const renderedRoots = new Map<HTMLElement, Root>();

// Mount Header as a real client root and flush the mount effect (the
// /stats headline fetch) to completion. Client rendering is required:
// under renderToString zustand's useSyncExternalStore serves
// getInitialState(), so current store state is invisible there.
async function renderHeader(path: string): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  renderedRoots.set(container, root);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Header />
      </MemoryRouter>
    );
  });
  return container;
}

async function unmountHeader(container: HTMLElement): Promise<void> {
  const root = renderedRoots.get(container);
  if (!root) return;
  await act(async () => {
    root.unmount();
  });
  renderedRoots.delete(container);
  container.remove();
}

// React inserts comment nodes between adjacent JSX text children; strip them
// so assertions match the actual text content.
function textOf(container: HTMLElement): string {
  return container.innerHTML.replace(/<!--.*?-->/g, ' ');
}

describe('Header chrome counters track the /stats totals (DF-MAFIA-AI-BENCHMARK-32-R2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.stats.getGameStats as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    useGameStore.setState({ connected: true, games: [], headlineStats: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const container of Array.from(renderedRoots.keys())) {
      await unmountHeader(container);
    }
    vi.restoreAllMocks();
  });

  it('renders the populated total/active from the gameStore slice, never the dead 0/0 wire', async () => {
    useGameStore.setState({ headlineStats: { ...STATS_TOTALS } });

    const container = await renderHeader('/');
    try {
      const html = textOf(container);
      const summary = html.substring(html.indexOf('stats-summary'));

      // The chrome counters carry the store slice's values (wired, not 0/0,
      // not swapped: total renders 4007, active renders 7).
      expect(summary).toMatch(/📈\s*4007/);
      expect(summary).toMatch(/🎮\s*7\b/);
      expect(summary).not.toMatch(/📈\s*0\b/);
      expect(summary).not.toMatch(/🎮\s*0\b/);
      expect(summary).not.toMatch(/🎮\s*4007/);
    } finally {
      await unmountHeader(container);
    }
  });

  it('fetches /stats on mount and the chrome renders what the fetch stored', async () => {
    (api.stats.getGameStats as ReturnType<typeof vi.fn>).mockResolvedValue(STATS_TOTALS);

    const container = await renderHeader('/');
    try {
      // The Header itself drives the /stats fetch (persistent chrome on
      // every route — it cannot rely on the Games tab having mounted first).
      expect(api.stats.getGameStats).toHaveBeenCalledTimes(1);
      expect(useGameStore.getState().headlineStats).toEqual(STATS_TOTALS);

      const summary = textOf(container).substring(
        textOf(container).indexOf('stats-summary')
      );
      expect(summary).toMatch(/📈\s*4007/);
      expect(summary).toMatch(/🎮\s*7\b/);
    } finally {
      await unmountHeader(container);
    }
  });

  it('shows em-dash placeholders while /stats has not answered, never invented 0s', async () => {
    (api.stats.getGameStats as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('HTTP 500')
    );

    const container = await renderHeader('/');
    try {
      const summary = textOf(container).substring(
        textOf(container).indexOf('stats-summary')
      );

      expect(summary).toMatch(/—/);
      expect(summary).not.toMatch(/🎮\s*0\b/);
      expect(summary).not.toMatch(/📈\s*0\b/);
      expect(summary).not.toMatch(/4007/);
    } finally {
      await unmountHeader(container);
    }
  });
});