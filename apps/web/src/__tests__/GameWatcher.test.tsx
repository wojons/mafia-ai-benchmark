/**
 * GameWatcher hydration tests (DF-MAFIA-AI-BENCHMARK-11).
 *
 * The watcher used to render placeholders for votes/discussion/events even
 * when GET /games/:id/events had recorded history, because it only ever
 * listened to the WS. These tests pin the hydration contract:
 *  (a) N recorded events render votes/discussion/recent-events (no placeholders)
 *  (b) a genuinely empty history still shows placeholders
 *  (c) a WS event repeating a hydrated row does not duplicate rows
 */
import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// React 18 expects this flag when act() is used outside react-dom/test-utils.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- mocked app dependencies -------------------------------------------------
// NOTE: vi.mock factories are hoisted above these const declarations, so each
// factory resolves its mock at call time via getters over lazily-evaluated
// holders (plain top-level references break with "before initialization").

const lazy = <T,>(get: () => T) => get;

const mockGetEvents = vi.fn();

vi.mock('../services/api', () => ({
  api: {
    games: {
      getEvents: (...args: unknown[]) => mockGetEvents(...args),
      get: vi.fn(),
      getAll: vi.fn(),
    },
    agents: {},
    stats: {},
    benchmark: {},
  },
}));

// The websocket singleton as GameWatcher consumes it: send() is fire-and-
// forget, on() registers handlers and returns an unsubscribe fn.
type WSHandler = (data: unknown) => void;
const wsHandlers = new Map<string, Set<WSHandler>>();

vi.mock('../services/websocket', async () => {
  const { vi } = await import('vitest');
  return {
    websocket: {
      on: (type: string, handler: WSHandler) => {
        if (!wsHandlers.has(type)) wsHandlers.set(type, new Set());
        wsHandlers.get(type)!.add(handler);
        return () => {
          wsHandlers.get(type)?.delete(handler);
        };
      },
      send: vi.fn(),
      connect: vi.fn(() => Promise.resolve()),
      disconnect: vi.fn(),
    },
  };
});

// GameWatcher reads currentGame/gameState/players via the zustand store.
// The component calls the hook with no selector, so a plain function
// returning the fixture object is a faithful mock (no real store needed).
const storeSelectGame = vi.fn();

vi.mock('../stores/gameStore', async () => {
  const { vi } = await import('vitest');
  const STORE_STATE = {
    currentGame: {
      id: 'a4a9d149-08b8-4888-adae-6e35669a4e02',
      createdAt: new Date('2026-09-25T10:00:00Z'),
      status: 'IN_PROGRESS',
      players: [
        { id: 'p-alice', name: 'Alice', role: 'VILLAGER', isAlive: true, isMafia: false, joinOrder: 1 },
        { id: 'p-bob', name: 'Bob', role: 'MAFIA', isAlive: true, isMafia: true, joinOrder: 2 },
        { id: 'p-carol', name: 'Carol', role: 'VILLAGER', isAlive: true, isMafia: false, joinOrder: 3 },
      ],
      config: {},
      currentState: {
        phase: 'DAY_VOTING',
        dayNumber: 1,
        turnNumber: 3,
        timeRemaining: 60,
        activePlayers: ['p-alice', 'p-bob', 'p-carol'],
        eliminatedPlayers: [],
        votes: [],
        nightActions: [],
      },
      events: [],
    },
    gameState: null as unknown,
    players: [] as Array<Record<string, unknown>>,
    selectGame: vi.fn(),
  };
  // gameState mirrors currentGame.currentState for the header widgets.
  STORE_STATE.gameState = (STORE_STATE.currentGame as { currentState: unknown }).currentState;
  const useGameStore = () => STORE_STATE;
  return { useGameStore };
});

import GameWatcher from '../components/GameWatcher';

// ---- helpers -----------------------------------------------------------------

interface EventRowOverrides {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  actorId?: string;
  targetId?: string;
  visibility?: string;
  sequence?: number;
  phase?: string;
  dayNumber?: number;
  timestamp?: string;
}

function makeEventRow(overrides: EventRowOverrides) {
  return {
    id: overrides.id,
    gameId: 'a4a9d149-08b8-4888-adae-6e35669a4e02',
    type: overrides.type,
    timestamp: overrides.timestamp ?? '2026-09-25T10:05:00.000Z',
    visibility: overrides.visibility ?? 'PUBLIC',
    actorId: overrides.actorId,
    targetId: overrides.targetId,
    data: overrides.data ?? {},
    metadata: {
      turnNumber: 1,
      dayNumber: overrides.dayNumber ?? 1,
      phase: overrides.phase ?? 'DAY_VOTING',
      sequence: overrides.sequence ?? 1,
    },
  };
}

const HISTORY: unknown[] = [
  makeEventRow({
    id: 'ev-1',
    type: 'GAME_STARTED',
    sequence: 1,
    phase: 'DAY_DISCUSSION',
    data: { dayNumber: 1 },
  }),
  makeEventRow({
    id: 'ev-2',
    type: 'AGENT_SAYS_BROADCASTED',
    sequence: 2,
    phase: 'DAY_DISCUSSION',
    actorId: 'p-alice',
    data: { playerName: 'Alice', statement: 'I think Bob is suspicious.' },
  }),
  makeEventRow({
    id: 'ev-3',
    type: 'VOTE_CAST',
    sequence: 3,
    phase: 'DAY_VOTING',
    actorId: 'p-alice',
    targetId: 'p-bob',
    data: { voterId: 'p-alice', targetId: 'p-bob' },
  }),
  makeEventRow({
    id: 'ev-4',
    type: 'PHASE_CHANGED',
    sequence: 4,
    phase: 'DAY_VOTING',
    data: { toPhase: 'DAY_VOTING' },
  }),
];

// Mount the watcher under its route (/watch/:gameId) and flush hydration.
async function mountWatcher(gameId: string): Promise<Root> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/watch/${gameId}`]}>
        <Routes>
          <Route path="/watch/:gameId" element={<GameWatcher />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  // second flush for the async getEvents promise
  await act(async () => {});
  return root;
}

function text() {
  return document.body.textContent ?? '';
}

beforeEach(() => {
  document.body.innerHTML = '';
  wsHandlers.clear();
  vi.clearAllMocks();
});

// ---- (a) hydrated history renders derived state -------------------------------

describe('GameWatcher history hydration (DF-MAFIA-AI-BENCHMARK-11)', () => {
  it('renders votes, discussion and recent events from recorded history with no placeholders', async () => {
    mockGetEvents.mockResolvedValueOnce(HISTORY);

    await mountWatcher('a4a9d149-08b8-4888-adae-6e35669a4e02');

    const body = text();
    // Vote from ev-3 rendered, not the placeholder.
    expect(body).toContain('p-alice voted for p-bob');
    expect(body).not.toContain('No votes cast yet');
    // Statement from ev-2 rendered.
    expect(body).toContain('I think Bob is suspicious.'.replace('suspicious', 'suspicious') === 'x' ? 'never' : 'I think Bob is suspicious.');
    expect(body).toContain('I think Bob is suspicious.');
    expect(body).not.toContain('No statements yet');
    // Timeline from ev-4 (PHASE_CHANGED) rendered.
    expect(body).toContain('Phase changed to DAY VOTING');
    expect(body).not.toContain('Waiting for game events...');
    // Fetch went through the existing helper with the API's visibility arg.
    expect(mockGetEvents).toHaveBeenCalledWith(
      'a4a9d149-08b8-4888-adae-6e35669a4e02',
      'all',
    );
  });

  it('empty history still shows placeholders', async () => {
    mockGetEvents.mockResolvedValueOnce([]);

    await mountWatcher('a4a9d149-08b8-4888-adae-6e35669a4e02');

    const body = text();
    expect(body).toContain('No votes cast yet');
    expect(body).toContain('No statements yet');
    expect(body).toContain('Waiting for game events...');
  });

  it('getEvents failure degrades to placeholders, not a crash', async () => {
    mockGetEvents.mockRejectedValueOnce(new Error('network down'));

    await mountWatcher('a4a9d149-08b8-4888-adae-6e35669a4e02');

    const body = text();
    expect(body).toContain('No votes cast yet');
    expect(body).toContain('No statements yet');
    expect(body).toContain('Waiting for game events...');
  });
});

// ---- (c) WS merge does not duplicate hydrated rows ----------------------------

describe('GameWatcher live WS merge', () => {
  it('a WS event repeating a hydrated id is deduplicated; new WS rows append', async () => {
    mockGetEvents.mockResolvedValueOnce(HISTORY);

    const gameId = 'a4a9d149-08b8-4888-adae-6e35669a4e02';
    await mountWatcher(gameId);

    // Fire the WS handler with (1) an exact repeat of hydrated ev-3 and
    // (2) a genuinely new live vote.
    await act(async () => {
      wsHandlers.get('GAME_EVENT')?.forEach((h) => {
        h({ type: 'GAME_EVENT', payload: HISTORY[2] }); // repeat ev-3
        h({
          type: 'GAME_EVENT',
          payload: makeEventRow({
            id: 'ev-3',
            type: 'VOTE_CAST',
            sequence: 3,
            actorId: 'p-alice',
            targetId: 'p-bob',
            data: { voterId: 'p-alice', targetId: 'p-bob' },
          }),
        });
        h({
          type: 'GAME_EVENT',
          payload: makeEventRow({
            id: 'ev-live-9',
            type: 'VOTE_CAST',
            sequence: 9,
            actorId: 'p-carol',
            targetId: 'p-bob',
            data: { voterId: 'p-carol', targetId: 'p-bob' },
          }),
        });
      });
    });

    const body = text();
    // Scope to the Votes section (.vote-line): the same vote also appears in
    // the Recent Events timeline by design, so a whole-body count of 2 is the
    // CORRECT rendering; the dedupe contract is one row per surface.
    const voteLines = Array.from(document.querySelectorAll('.vote-line .update-message'));
    const aliceVoteCount = voteLines.filter(
      (el) => el.textContent === 'p-alice voted for p-bob',
    ).length;
    const carolVoteCount = voteLines.filter(
      (el) => el.textContent === 'p-carol voted for p-bob',
    ).length;
    expect(aliceVoteCount).toBe(1);
    expect(carolVoteCount).toBe(1);
  });

  it('a live statement renders in the discussion panel after hydration', async () => {
    mockGetEvents.mockResolvedValueOnce([]);

    const gameId = 'a4a9d149-08b8-4888-adae-6e35669a4e02';
    await mountWatcher(gameId);

    await act(async () => {
      wsHandlers.get('GAME_EVENT')?.forEach((h) => {
        h({
          type: 'GAME_EVENT',
          payload: makeEventRow({
            id: 'ev-live-1',
            type: 'AGENT_SAYS_BROADCASTED',
            sequence: 1,
            phase: 'DAY_DISCUSSION',
            actorId: 'p-bob',
            data: { playerName: 'Bob', statement: 'It was not me!' },
          }),
        });
      });
    });

    const body = text();
    expect(body).toContain('It was not me!');
    expect(body).not.toContain('No statements yet');
  });
});