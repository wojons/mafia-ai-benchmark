import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

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

import GameCard, { getStatusPhaseLabel } from '../components/GameCard';
import GameList from '../components/GameList';

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

// localStore referenced so the hoisted shim is not tree-shaken by lint.
void localStore;