/**
 * DF-MAFIA-AI-BENCHMARK-30: UI-created (legacy adapter) games served a dead
 * state projection. The legacy bridge persists players-table rows ONLY at
 * ROLES_ASSIGNED — its FINAL event at game end — so a LIVE adapter game kept
 * an empty players table for its entire lifetime, and:
 *
 *  - GET /api/v1/games/:gameId/state and the detail currentState built
 *    activePlayers from the table only -> activePlayers: [] mid-game,
 *  - the adapter's phase mapping fell through to SETUP for the engine's
 *    real phase slots (NIGHT_STARTED, MAFIA_CHAT, DAY_STARTED, ...) ->
 *    phase frozen at SETUP mid-game,
 *  - while GET /api/v1/games counted event-stream actorIds and listed the
 *    same game IN_PROGRESS/players:N. The two endpoints contradicted.
 *
 * These tests mount the real games router over the sqlite-backed repository
 * and seed exactly what the bridge produces mid-game (IN_PROGRESS row +
 * events, NO player rows). Every failing assertion here failed with the
 * defect in place and passes after the fix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createGamesRouter } from '../../routes/games.js';
import { createSqliteBackedRepository, createFakeEventBus } from '../services/mocks.js';
import type { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';

type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

function createStubLegacyAdapter(): LegacyGameAdapter {
  return {
    startGame: () => ({
      gameId: 'stub-legacy-game',
      status: 'RUNNING',
      startedAt: new Date(),
      players: [],
      eventCount: 0,
    }),
    getActiveGames: () => [],
    getGameState: () => undefined,
  } as unknown as LegacyGameAdapter;
}

interface StateBody {
  success: boolean;
  data?: {
    phase: string;
    dayNumber: number;
    turnNumber: number;
    activePlayers: string[];
    eliminatedPlayers: string[];
  };
}

interface ListBody {
  success: boolean;
  data?: Array<{ id: string; status: string; players: number }>;
}

async function bootGamesRouter(): Promise<{ server: Server; baseUrl: string; repo: FakeRepo }> {
  const repo = createSqliteBackedRepository() as unknown as FakeRepo;
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createGamesRouter(
      // gameEngine: the real GameEngine.getGameState delegates to
      // gameRepository.getGame(gameId).currentState — mirror that so the
      // route exercises the repository's projection (the defect surface).
      {
        gameEngine: {
          getGameState: (gameId: string) =>
            (repo as unknown as { getGame: (id: string) => { currentState: StateBody['data'] } | null }).getGame(gameId)?.currentState ?? null,
        },
        gameRepository: repo, eventBus: createFakeEventBus() } as never,
      createStubLegacyAdapter(),
    ),
  );
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address() as { port: number };
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, repo };
}

/**
 * Seed an adapter-style LIVE game: IN_PROGRESS row + event stream with
 * actors but NO players rows (the bridge persists those only at game end).
 * Turn numbers advance across events, phases advance into night/day.
 */
function seedLiveAdapterGame(repo: FakeRepo, gameId: string): void {
  repo.seedGame({
    id: gameId,
    status: 'IN_PROGRESS',
    events: [
      {
        type: 'GAME_STARTED',
        actorId: undefined,
        data: { legacyType: 'STATE_CHANGE', status: 'STARTED', playerCount: 5 },
        phase: 'SETUP',
        dayNumber: 0,
        turnNumber: 1,
      },
      {
        type: 'NIGHT_STARTED',
        data: { legacyType: 'NIGHT_STARTED', aliveCount: 5, mafiaCount: 2 },
        // The engine's NIGHT_STARTED slot was previously UNMAPPED and
        // persisted as SETUP — proven by the phase-derivation test below.
        phase: 'NIGHT_ACTIONS',
        dayNumber: 1,
        turnNumber: 2,
      },
      {
        type: 'AGENT_SAYS_BROADCASTED',
        actorId: 'p-alice',
        data: { legacyType: 'MESSAGE', statement: 'Who is mafia?', says: 'Who is mafia?', playerName: 'Alice' },
        phase: 'DAY_DISCUSSION',
        dayNumber: 1,
        turnNumber: 3,
      },
      {
        type: 'AGENT_SAYS_BROADCASTED',
        actorId: 'p-bob',
        data: { legacyType: 'MESSAGE', statement: 'Not me.', says: 'Not me.', playerName: 'Bob' },
        phase: 'DAY_DISCUSSION',
        dayNumber: 1,
        turnNumber: 4,
      },
    ],
  });
}

describe('GET /api/v1/games/:gameId/state — adapter live state (DF-MAFIA-AI-BENCHMARK-30)', () => {
  let server: Server;
  let baseUrl: string;
  let repo: FakeRepo;
  const GAME_ID = 'adapter-live-game';

  beforeEach(async () => {
    ({ server, baseUrl, repo } = await bootGamesRouter());
    seedLiveAdapterGame(repo, GAME_ID);
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('returns populated activePlayers for a live adapter game (never dead [])', async () => {
    const response = await fetch(`${baseUrl}/api/v1/games/${GAME_ID}/state`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as StateBody;

    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    // The state endpoint must agree with the list endpoint's actor count:
    // both derive from the same event stream.
    expect(body.data!.activePlayers.sort()).toEqual(['p-alice', 'p-bob']);
    expect(body.data!.eliminatedPlayers).toEqual([]);
  });

  it('reports the engine-phase of the LAST event, never frozen SETUP', async () => {
    const response = await fetch(`${baseUrl}/api/v1/games/${GAME_ID}/state`);
    const body = (await response.json()) as StateBody;

    expect(body.data!.phase).toBe('DAY_DISCUSSION');
    expect(body.data!.dayNumber).toBe(1);
    expect(body.data!.turnNumber).toBe(4);
  });

  it('keeps phase/turn consistent with the event stream as it advances', async () => {
    // Advance the game: one more event, deeper turn, new phase.
    const events = repo.getEvents(GAME_ID);
    const last = events[events.length - 1];
    repo.addEvent(GAME_ID, {
      type: 'VOTE_CAST',
      visibility: 'PUBLIC',
      actorId: 'p-alice',
      targetId: 'p-bob',
      data: { legacyType: 'VOTE', targetId: 'p-bob' },
      metadata: { turnNumber: last!.metadata.turnNumber + 1, dayNumber: 1, phase: 'DAY_VOTING', sequence: last!.metadata.sequence + 1 },
    });

    const response = await fetch(`${baseUrl}/api/v1/games/${GAME_ID}/state`);
    const body = (await response.json()) as StateBody;

    expect(body.data!.phase).toBe('DAY_VOTING');
    expect(body.data!.turnNumber).toBe(5);
  });

  it('does not contradict the games list endpoint (actor counts agree)', async () => {
    const [stateResp, listResp, detailResp] = await Promise.all([
      fetch(`${baseUrl}/api/v1/games/${GAME_ID}/state`),
      fetch(`${baseUrl}/api/v1/games?status=IN_PROGRESS&limit=50`),
      fetch(`${baseUrl}/api/v1/games/${GAME_ID}`),
    ]);
    const state = (await stateResp.json()) as StateBody;
    const list = (await listResp.json()) as ListBody;
    const detail = (await detailResp.json()) as { data: { currentState: StateBody['data']; players: Array<{ id: string; isAlive: boolean }> } };

    const listed = list.data!.find((g) => g.id === GAME_ID);
    expect(listed).toBeDefined();
    expect(listed!.status).toBe('IN_PROGRESS');
    // List counts event actors (2). The state/detail projections must now
    // derive the SAME set — previously they served [] while the list said 2.
    expect(state.data!.activePlayers.sort()).toEqual(['p-alice', 'p-bob']);
    expect(state.data!.activePlayers.length).toBe(listed!.players);
    expect(detail.data!.currentState.activePlayers.sort()).toEqual(['p-alice', 'p-bob']);
    expect(detail.data!.players.map((p) => p.id).sort()).toEqual(['p-alice', 'p-bob']);
  });

  it('keeps the ENDED path intact: real players rows stay authoritative', async () => {
    // Once the bridge emits its final ROLES_ASSIGNED the players table is
    // populated; table rows (with the death overlay) must win over the
    // event-derived view.
    repo.seedGame({
      id: 'adapter-ended-game',
      status: 'ENDED',
      winner: 'TOWN',
      players: [
        { id: 'p-alice', name: 'Alice', role: 'MAFIA', isMafia: true, joinOrder: 0, isAlive: 0 },
        { id: 'p-bob', name: 'Bob', role: 'VILLAGER', isMafia: false, joinOrder: 1, isAlive: 1 },
      ],
      events: [
        {
          // The bridge records night deaths as MORNING_REVEAL death events —
          // eliminatedPlayers derives from these (MAF-GAP-044), not from the
          // is_alive column.
          type: 'MORNING_REVEAL',
          data: { legacyType: 'REVEAL', deaths: [{ id: 'p-alice', name: 'Alice', role: 'MAFIA', isMafia: true, isAlive: false }] },
          phase: 'MORNING_REVEAL',
          dayNumber: 3,
          turnNumber: 39,
        },
        {
          type: 'GAME_ENDED',
          data: { legacyType: 'STATE_CHANGE', winner: 'TOWN' },
          phase: 'GAME_OVER',
          dayNumber: 3,
          turnNumber: 40,
        },
      ],
    });

    const response = await fetch(`${baseUrl}/api/v1/games/adapter-ended-game/state`);
    const body = (await response.json()) as StateBody;

    expect(body.data!.phase).toBe('GAME_OVER');
    expect(body.data!.activePlayers).toEqual(['p-bob']);
    expect(body.data!.eliminatedPlayers).toEqual(['p-alice']);
  });
});

describe('LegacyGameAdapter phase mapping (DF-MAFIA-AI-BENCHMARK-30)', () => {
  // Static extractor tests stay in legacy-game-adapter.test.ts; this block
  // covers the phase-slot mapping through the translation path. The adapter
  // under test here is the REAL class (no vi.mock child_process needed —
  // translateAndPublishEvent is exercised directly).
  it('maps the engine sub-phase slots to their server phases', async () => {
    const mod = await import('../../services/legacy-game-adapter.js');
    const { LegacyGameAdapter: Adapter } = mod;
    const { createFakeEventBus } = await import('../services/mocks.js');
    const eventBus = createFakeEventBus();
    const { createFakeGameRepository } = await import('../services/mocks.js');
    const adapter = new Adapter(eventBus, createFakeGameRepository() as never);

    const cases: Array<{ phase: string; expected: string }> = [
      { phase: 'NIGHT_STARTED', expected: 'NIGHT_ACTIONS' },
      { phase: 'MAFIA_CHAT', expected: 'NIGHT_ACTIONS' },
      { phase: 'MAFIA_KILL_VOTE', expected: 'NIGHT_ACTIONS' },
      { phase: 'MAFIA_PERSUADE', expected: 'NIGHT_ACTIONS' },
      { phase: 'DOCTOR_ACTION', expected: 'NIGHT_ACTIONS' },
      { phase: 'SHERIFF_INVESTIGATION', expected: 'NIGHT_ACTIONS' },
      { phase: 'VIGILANTE_ACTION', expected: 'NIGHT_ACTIONS' },
      { phase: 'DAY_STARTED', expected: 'DAY_DISCUSSION' },
      { phase: 'DAY_VOTE', expected: 'DAY_VOTING' },
      { phase: 'GAME_CREATED', expected: 'SETUP' },
      // Previously these fell through to SETUP — the frozen-SETUP defect.
      { phase: 'MAFIA_KILL_TARGET', expected: 'NIGHT_ACTIONS' },
    ];
    cases.forEach(({ phase, expected }, i) => {
      eventBus.reset();
      (adapter as unknown as {
        translateAndPublishEvent: (gameId: string, event: Record<string, unknown>, seq: number) => void;
      }).translateAndPublishEvent('g-phase', {
        eventType: 'MESSAGE',
        playerId: 'p1',
        playerName: 'Alice',
        visibility: 'PUBLIC',
        phase,
        content: {},
        round: 1,
        timestamp: new Date().toISOString(),
      }, i + 1);

      const published = eventBus.published.find((e) => e.type === 'AGENT_SAYS_BROADCASTED');
      expect(published, `phase slot ${phase} must persist as ${expected}`).toBeDefined();
      expect(published!.metadata.phase, `phase slot ${phase} must persist as ${expected}`).toBe(expected);
    });
  });
});