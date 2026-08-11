/**
 * Game detail per-player model attribution — MAF-GAP-029.
 *
 * Mounts the real games router on an ephemeral Express app backed by an
 * in-memory SQLite repository (production schema) and asserts that
 * GET /api/v1/games/:id enriches players with provider/model/tokensUsed/
 * apiCalls from real assignment + usage rows:
 *
 *  (a) completed legacy game, distinct model per role -> role-unique
 *      players carry provider/model and tokensUsed > 0; the two VILLAGERs
 *      share one model, so their per-model aggregate cannot be split and
 *      honestly reports 0 (documented ambiguity rule)
 *  (b) UNASSIGNED player / no assignment rows -> no fabricated attribution
 *  (c) whole game on one shared model -> provider/model set, tokens 0
 *  (d) in-progress game -> provider/model only, no token fields
 *  (e) native game with real player_id assignment + usage rows, incl.
 *      name-keyed assignment and direct usage without any assignment
 *  (f) pure legacy-adapter path (game row absent from the repository)
 *  (g) no assignments but per-player usage rows (the MAF-GAP-029 write
 *      path) -> provider/model from the rows AND tokensUsed/apiCalls > 0
 *  (h) no assignments, exactly one model in the 'ALL' rows -> every player
 *      attributed, tokens honestly 0 (the reopened PM case)
 *  (i) no assignments, several models in the 'ALL' rows -> no fabricated
 *      attribution
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createGamesRouter } from '../../routes/games.js';
import { createSqliteBackedRepository, createFakeEventBus } from './mocks.js';
import type { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';

type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

/** Insert a player_model_assignments row (role- or player-keyed). */
function insertAssignment(
  repo: FakeRepo,
  opts: {
    gameId: string;
    playerId?: string;
    playerName?: string | null;
    role?: string | null;
    provider: string;
    model: string;
  },
): void {
  repo.db
    .prepare(
      `INSERT INTO player_model_assignments
         (id, game_id, player_id, player_name, role, provider, model, temperature, max_tokens, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `pma-${Math.random().toString(36).slice(2, 10)}`,
      opts.gameId,
      opts.playerId ?? 'ALL',
      opts.playerName ?? null,
      opts.role ?? null,
      opts.provider,
      opts.model,
      0.7,
      500,
      0,
      Date.now(),
    );
}

/** Insert an event row without requiring a games row (pure-legacy path). */
function insertEvent(
  repo: FakeRepo,
  gameId: string,
  seq: number,
  type: string,
  data: unknown,
  actorId?: string,
): void {
  repo.db
    .prepare(
      `INSERT INTO events (id, game_id, type, timestamp, visibility, actor_id, target_id, data, turn_number, day_number, phase, sequence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `evt-${gameId}-${seq}`,
      gameId,
      type,
      Date.now(),
      'PUBLIC',
      actorId ?? null,
      null,
      JSON.stringify(data ?? {}),
      1,
      1,
      'SETUP',
      seq,
    );
}

const ROLES_EVENT = {
  type: 'ROLES_ASSIGNED',
  data: {
    assignments: [
      { playerId: 'p1', role: 'MAFIA' },
      { playerId: 'p2', role: 'DOCTOR' },
      { playerId: 'p3', role: 'SHERIFF' },
      { playerId: 'p4', role: 'VILLAGER' },
      { playerId: 'p5', role: 'VILLAGER' },
    ],
    mafiaTeam: ['p1'],
  },
};

/** Minimal legacy adapter reporting the given states by game id. */
function createLegacyAdapterWithStates(
  states: Record<string, { status: string }>,
): LegacyGameAdapter {
  return {
    getActiveGames: () => Object.keys(states),
    getGameState: (gameId: string) =>
      states[gameId]
        ? {
            gameId,
            status: states[gameId].status,
            startedAt: new Date(),
            eventCount: 0,
            players: [],
          }
        : undefined,
  } as unknown as LegacyGameAdapter;
}

describe('GET /api/v1/games/:id per-player model attribution (MAF-GAP-029)', () => {
  let repo: FakeRepo;
  let server: Server;
  let baseUrl: string;

  async function mount(adapter?: LegacyGameAdapter): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createGamesRouter(
        { gameEngine: {}, gameRepository: repo, eventBus: createFakeEventBus() } as any,
        adapter ?? null,
      ),
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async function getPlayers(gameId: string): Promise<any[]> {
    const response = await fetch(`${baseUrl}/api/v1/games/${gameId}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    return body.data.players;
  }

  beforeEach(async () => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('(a) completed legacy game: role-unique models attribute real tokens; shared VILLAGER model reports 0', async () => {
    repo.seedGame({ id: 'g-clean', status: 'ENDED', events: [ROLES_EVENT] });
    insertAssignment(repo, { gameId: 'g-clean', role: 'MAFIA', provider: 'provA', model: 'modelA' });
    insertAssignment(repo, { gameId: 'g-clean', role: 'DOCTOR', provider: 'provB', model: 'modelB' });
    insertAssignment(repo, { gameId: 'g-clean', role: 'SHERIFF', provider: 'provC', model: 'modelC' });
    insertAssignment(repo, { gameId: 'g-clean', role: 'VILLAGER', provider: 'provD', model: 'modelD' });
    // Legacy per-model usage rows (player_id sentinel 'ALL').
    repo.insertTokenUsage({ gameId: 'g-clean', playerId: 'ALL', turnNumber: 0, provider: 'provA', model: 'modelA', promptTokens: 700, completionTokens: 300, totalTokens: 1000, cost: 0.01 });
    repo.insertTokenUsage({ gameId: 'g-clean', playerId: 'ALL', turnNumber: 0, provider: 'provB', model: 'modelB', promptTokens: 1400, completionTokens: 600, totalTokens: 2000, cost: 0.02 });
    repo.insertTokenUsage({ gameId: 'g-clean', playerId: 'ALL', turnNumber: 0, provider: 'provC', model: 'modelC', promptTokens: 2100, completionTokens: 900, totalTokens: 3000, cost: 0.03 });
    repo.insertTokenUsage({ gameId: 'g-clean', playerId: 'ALL', turnNumber: 0, provider: 'provD', model: 'modelD', promptTokens: 2800, completionTokens: 1200, totalTokens: 4000, cost: 0.04 });
    repo.insertApiCall({ gameId: 'g-clean', playerId: 'ALL', provider: 'provA', model: 'modelA', endpoint: 'legacy-engine', latency: 120 });
    repo.insertApiCall({ gameId: 'g-clean', playerId: 'ALL', provider: 'provB', model: 'modelB', endpoint: 'legacy-engine', latency: 130 });

    await mount();
    const players = await getPlayers('g-clean');
    const byId = new Map(players.map((p) => [p.id, p]));

    // Unique model per role -> full attribution with real recorded tokens.
    expect(byId.get('p1')).toMatchObject({ role: 'MAFIA', provider: 'provA', model: 'modelA', tokensUsed: 1000, apiCalls: 1 });
    expect(byId.get('p2')).toMatchObject({ role: 'DOCTOR', provider: 'provB', model: 'modelB', tokensUsed: 2000, apiCalls: 1 });
    expect(byId.get('p3')).toMatchObject({ role: 'SHERIFF', provider: 'provC', model: 'modelC', tokensUsed: 3000, apiCalls: 0 });

    // Both villagers share modelD: the per-model aggregate cannot be split
    // honestly, so tokens report 0 while provider/model stay truthful.
    for (const vid of ['p4', 'p5']) {
      expect(byId.get(vid)).toMatchObject({ role: 'VILLAGER', provider: 'provD', model: 'modelD', tokensUsed: 0, apiCalls: 0 });
    }

    // Existing fields unchanged (backward compatible).
    expect(byId.get('p1').isMafia).toBe(true);
    expect(byId.get('p1').isAlive).toBe(true);
    expect(typeof byId.get('p1').joinOrder).toBe('number');
  });

  it('(b) UNASSIGNED player and games without assignments get no fabricated attribution', async () => {
    repo.seedGame({
      id: 'g-unknown',
      status: 'ENDED',
      events: [
        ROLES_EVENT,
        // An actor whose role is never revealed anywhere.
        { type: 'AGENT_SAYS_BROADCASTED', actorId: 'px', data: { playerName: 'Mystery' } },
      ],
    });
    // Assignments exist for some roles but not for px; usage rows exist.
    insertAssignment(repo, { gameId: 'g-unknown', role: 'MAFIA', provider: 'provA', model: 'modelA' });
    repo.insertTokenUsage({ gameId: 'g-unknown', playerId: 'ALL', turnNumber: 0, provider: 'provA', model: 'modelA', promptTokens: 1, completionTokens: 1, totalTokens: 500, cost: 0.001 });

    await mount();
    const players = await getPlayers('g-unknown');
    const byId = new Map(players.map((p) => [p.id, p]));

    const mystery = byId.get('px');
    expect(mystery.role).toBe('UNASSIGNED');
    expect(mystery.provider).toBeUndefined();
    expect(mystery.model).toBeUndefined();
    expect(mystery.tokensUsed).toBe(0);
    expect(mystery.apiCalls).toBe(0);

    // Roles without assignment rows (DOCTOR/SHERIFF/VILLAGER here) also
    // stay un-attributed rather than borrowing another role's model.
    expect(byId.get('p2').provider).toBeUndefined();
    expect(byId.get('p2').tokensUsed).toBe(0);

    // p1 resolves to modelA, but px's model is unknown — the per-model
    // aggregate may include px's usage, so it cannot be pinned on p1.
    expect(byId.get('p1')).toMatchObject({ provider: 'provA', model: 'modelA', tokensUsed: 0, apiCalls: 0 });
  });

  it('(c) whole game on one shared model: provider/model set everywhere, tokens 0 (unsplittable aggregate)', async () => {
    repo.seedGame({ id: 'g-shared', status: 'ENDED', events: [ROLES_EVENT] });
    // Benchmark-runner style rows: town core recorded under the 'TOWN' key,
    // which the legacy engine runs as VILLAGER (ROLE_ENV_MAP alias).
    insertAssignment(repo, { gameId: 'g-shared', role: 'MAFIA', provider: 'CUSTOM', model: 'openai' });
    insertAssignment(repo, { gameId: 'g-shared', role: 'DOCTOR', provider: 'CUSTOM', model: 'openai' });
    insertAssignment(repo, { gameId: 'g-shared', role: 'SHERIFF', provider: 'CUSTOM', model: 'openai' });
    insertAssignment(repo, { gameId: 'g-shared', role: 'TOWN', provider: 'CUSTOM', model: 'openai' });
    repo.insertTokenUsage({ gameId: 'g-shared', playerId: 'ALL', turnNumber: 0, provider: 'CUSTOM', model: 'openai', promptTokens: 5000, completionTokens: 2000, totalTokens: 7000, cost: 0.07 });

    await mount();
    const players = await getPlayers('g-shared');
    expect(players).toHaveLength(5);
    for (const p of players) {
      expect(p.provider).toBe('CUSTOM');
      expect(p.model).toBe('openai');
      expect(p.tokensUsed).toBe(0);
      expect(p.apiCalls).toBe(0);
    }
  });

  it('(d) in-progress game: provider/model from assignments, token fields omitted', async () => {
    repo.seedGame({ id: 'g-live', status: 'IN_PROGRESS', events: [ROLES_EVENT] });
    insertAssignment(repo, { gameId: 'g-live', role: 'MAFIA', provider: 'provA', model: 'modelA' });
    // Even if partial usage rows exist mid-game, they are not reported.
    repo.insertTokenUsage({ gameId: 'g-live', playerId: 'ALL', turnNumber: 0, provider: 'provA', model: 'modelA', promptTokens: 5, completionTokens: 5, totalTokens: 10, cost: 0 });

    await mount();
    const players = await getPlayers('g-live');
    const byId = new Map(players.map((p) => [p.id, p]));

    expect(byId.get('p1')).toMatchObject({ provider: 'provA', model: 'modelA' });
    expect('tokensUsed' in byId.get('p1')).toBe(false);
    expect('apiCalls' in byId.get('p1')).toBe(false);
    // No assignment for DOCTOR here -> nothing fabricated mid-game either.
    expect(byId.get('p2').provider).toBeUndefined();
    expect('tokensUsed' in byId.get('p2')).toBe(false);
  });

  it('(e) native game: per-player assignment + direct usage rows attribute exactly', async () => {
    repo.seedGame({
      id: 'g-native',
      status: 'ENDED',
      players: [
        { id: 'np1', name: 'Alice', role: 'MAFIA', isMafia: true, joinOrder: 0 },
        { id: 'np2', name: 'Bob', role: 'DOCTOR', joinOrder: 1 },
        { id: 'np3', name: 'Carol', role: 'SHERIFF', joinOrder: 2 },
      ],
    });
    insertAssignment(repo, { gameId: 'g-native', playerId: 'np1', playerName: 'Alice', role: null, provider: 'provN', model: 'modelN1' });
    // Name-keyed assignment (player_id sentinel present but not matching).
    insertAssignment(repo, { gameId: 'g-native', playerId: 'ALL', playerName: 'Bob', role: null, provider: 'provN', model: 'modelN2' });
    // Carol has no assignment row at all.
    repo.insertTokenUsage({ gameId: 'g-native', playerId: 'np1', turnNumber: 1, provider: 'provN', model: 'modelN1', promptTokens: 300, completionTokens: 200, totalTokens: 500, cost: 0.005 });
    repo.insertTokenUsage({ gameId: 'g-native', playerId: 'np2', turnNumber: 1, provider: 'provN', model: 'modelN2', promptTokens: 400, completionTokens: 300, totalTokens: 700, cost: 0.007 });
    repo.insertTokenUsage({ gameId: 'g-native', playerId: 'np3', turnNumber: 1, provider: 'provN', model: 'modelN3', promptTokens: 100, completionTokens: 50, totalTokens: 150, cost: 0.001 });
    repo.insertApiCall({ gameId: 'g-native', playerId: 'np1', provider: 'provN', model: 'modelN1', endpoint: '/chat/completions', latency: 90 });
    repo.insertApiCall({ gameId: 'g-native', playerId: 'np1', provider: 'provN', model: 'modelN1', endpoint: '/chat/completions', latency: 110 });
    repo.insertApiCall({ gameId: 'g-native', playerId: 'np2', provider: 'provN', model: 'modelN2', endpoint: '/chat/completions', latency: 100 });

    await mount();
    const players = await getPlayers('g-native');
    const byId = new Map(players.map((p) => [p.id, p]));

    // player_id-keyed assignment + direct rows.
    expect(byId.get('np1')).toMatchObject({ provider: 'provN', model: 'modelN1', tokensUsed: 500, apiCalls: 2 });
    // player_name-keyed assignment + direct rows.
    expect(byId.get('np2')).toMatchObject({ provider: 'provN', model: 'modelN2', tokensUsed: 700, apiCalls: 1 });
    // No assignment: real per-player tokens still reported, model not
    // fabricated.
    expect(byId.get('np3').provider).toBeUndefined();
    expect(byId.get('np3').model).toBeUndefined();
    expect(byId.get('np3').tokensUsed).toBe(150);
    expect(byId.get('np3').apiCalls).toBe(0);
  });

  it('(f) legacy-adapter path (no games row): completed legacy game is enriched', async () => {
    // Seed events/assignments/usage WITHOUT a games row so the route takes
    // the legacyAdapter.getGameState branch. The production repository
    // enables FK enforcement, so seeding a game-less legacy game requires
    // relaxing it (test fixture only — mirrors how legacy games exist in
    // the adapter before/without a repository row).
    repo.db.pragma('foreign_keys = OFF');
    insertEvent(repo, 'g-legacy', 1, 'ROLES_ASSIGNED', ROLES_EVENT.data);
    insertAssignment(repo, { gameId: 'g-legacy', role: 'MAFIA', provider: 'provA', model: 'modelA' });
    insertAssignment(repo, { gameId: 'g-legacy', role: 'DOCTOR', provider: 'provB', model: 'modelB' });
    // SHERIFF/VILLAGER assignments exist (distinct models) but recorded no
    // usage — every player resolves, keeping per-model splits sound.
    insertAssignment(repo, { gameId: 'g-legacy', role: 'SHERIFF', provider: 'provC', model: 'modelC' });
    insertAssignment(repo, { gameId: 'g-legacy', role: 'VILLAGER', provider: 'provD', model: 'modelD' });
    repo.insertTokenUsage({ gameId: 'g-legacy', playerId: 'ALL', turnNumber: 0, provider: 'provA', model: 'modelA', promptTokens: 800, completionTokens: 200, totalTokens: 1000, cost: 0.01 });
    repo.insertTokenUsage({ gameId: 'g-legacy', playerId: 'ALL', turnNumber: 0, provider: 'provB', model: 'modelB', promptTokens: 1600, completionTokens: 400, totalTokens: 2000, cost: 0.02 });

    insertEvent(repo, 'g-legacy-live', 1, 'ROLES_ASSIGNED', ROLES_EVENT.data);
    insertAssignment(repo, { gameId: 'g-legacy-live', role: 'MAFIA', provider: 'provA', model: 'modelA' });

    await mount(
      createLegacyAdapterWithStates({
        'g-legacy': { status: 'COMPLETED' },
        'g-legacy-live': { status: 'RUNNING' },
      }),
    );

    // Completed legacy game -> full enrichment on unique models.
    const done = await getPlayers('g-legacy');
    const doneById = new Map(done.map((p) => [p.id, p]));
    expect(doneById.get('p1')).toMatchObject({ provider: 'provA', model: 'modelA', tokensUsed: 1000 });
    expect(doneById.get('p2')).toMatchObject({ provider: 'provB', model: 'modelB', tokensUsed: 2000 });
    // SHERIFF has an assignment but no recorded usage -> honest 0, and the
    // two VILLAGERs share modelD so their aggregate stays unsplit (0).
    expect(doneById.get('p3')).toMatchObject({ provider: 'provC', model: 'modelC', tokensUsed: 0, apiCalls: 0 });
    expect(doneById.get('p4')).toMatchObject({ provider: 'provD', model: 'modelD', tokensUsed: 0 });

    // Running legacy game -> IN_PROGRESS, assignments visible, no tokens.
    const liveResponse = await fetch(`${baseUrl}/api/v1/games/g-legacy-live`);
    const liveBody = await liveResponse.json();
    expect(liveBody.data.status).toBe('IN_PROGRESS');
    const liveP1 = liveBody.data.players.find((p: any) => p.id === 'p1');
    expect(liveP1).toMatchObject({ provider: 'provA', model: 'modelA' });
    expect('tokensUsed' in liveP1).toBe(false);
  });

  it('(g) no assignments but per-player usage rows: provider/model from the rows, tokensUsed/apiCalls > 0 (PASS criterion)', async () => {
    // A roleModels-less legacy game played AFTER the MAF-GAP-029 write
    // path: real per-player token_usage/api_calls rows exist alongside the
    // per-model 'ALL' aggregates the stats pipeline keeps.
    repo.seedGame({ id: 'g-perplayer', status: 'ENDED', events: [ROLES_EVENT] });
    repo.insertTokenUsage({ gameId: 'g-perplayer', playerId: 'p1', turnNumber: 0, provider: 'openai', model: 'gpt-4o-mini', promptTokens: 2000, completionTokens: 1000, totalTokens: 3000, cost: 0.0024 });
    repo.insertTokenUsage({ gameId: 'g-perplayer', playerId: 'p2', turnNumber: 0, provider: 'openai', model: 'gpt-4o-mini', promptTokens: 1400, completionTokens: 600, totalTokens: 2000, cost: 0.0016 });
    repo.insertApiCall({ gameId: 'g-perplayer', playerId: 'p1', provider: 'openai', model: 'gpt-4o-mini', endpoint: 'legacy-engine', latency: 800 });
    repo.insertApiCall({ gameId: 'g-perplayer', playerId: 'p2', provider: 'openai', model: 'gpt-4o-mini', endpoint: 'legacy-engine', latency: 1000 });
    // The 'ALL' aggregate exists too — it must not double-count into the
    // per-player numbers (Branch 1 reads only real player_id rows).
    repo.insertTokenUsage({ gameId: 'g-perplayer', playerId: 'ALL', turnNumber: 0, provider: 'openai', model: 'gpt-4o-mini', promptTokens: 3400, completionTokens: 1600, totalTokens: 5000, cost: 0.004 });
    repo.insertApiCall({ gameId: 'g-perplayer', playerId: 'ALL', provider: 'openai', model: 'gpt-4o-mini', endpoint: 'legacy-engine', latency: 900 });

    await mount();
    const players = await getPlayers('g-perplayer');
    const byId = new Map(players.map((p) => [p.id, p]));

    // The PASS criterion: real provider/model AND tokensUsed > 0 AND
    // apiCalls > 0 per player with recorded rows.
    expect(byId.get('p1')).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini', tokensUsed: 3000, apiCalls: 1 });
    expect(byId.get('p2')).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini', tokensUsed: 2000, apiCalls: 1 });

    // Players without recorded rows honestly report the game's single
    // recorded model (fallback 5) with unsplittable 0 usage.
    for (const rest of ['p3', 'p4', 'p5']) {
      expect(byId.get(rest)).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini', tokensUsed: 0, apiCalls: 0 });
    }
  });

  it('(h) no assignments and one model in the ALL rows: every player attributed, tokens honestly 0 (the reopened PM case)', async () => {
    // Mirrors the 3 reopened games (6cad2f3a, 280bb2b2, 6e9bc047): no
    // player_model_assignments rows, only per-model 'ALL' aggregates with
    // a single distinct model.
    repo.seedGame({ id: 'g-pm', status: 'ENDED', events: [ROLES_EVENT] });
    repo.insertTokenUsage({ gameId: 'g-pm', playerId: 'ALL', turnNumber: 0, provider: 'openai', model: 'gpt-4o-mini', promptTokens: 24000, completionTokens: 12000, totalTokens: 36000, cost: 0.036 });
    repo.insertApiCall({ gameId: 'g-pm', playerId: 'ALL', provider: 'openai', model: 'gpt-4o-mini', endpoint: 'legacy-engine', latency: 900 });

    await mount();
    const players = await getPlayers('g-pm');
    expect(players).toHaveLength(5);
    for (const p of players) {
      expect(p.provider).toBe('openai');
      expect(p.model).toBe('gpt-4o-mini');
      // The per-model aggregate sums every player and cannot be split.
      expect(p.tokensUsed).toBe(0);
      expect(p.apiCalls).toBe(0);
    }
  });

  it('(i) no assignments but several models in the ALL rows: no fabricated attribution', async () => {
    repo.seedGame({ id: 'g-multi', status: 'ENDED', events: [ROLES_EVENT] });
    repo.insertTokenUsage({ gameId: 'g-multi', playerId: 'ALL', turnNumber: 0, provider: 'provA', model: 'modelA', promptTokens: 700, completionTokens: 300, totalTokens: 1000, cost: 0.01 });
    repo.insertTokenUsage({ gameId: 'g-multi', playerId: 'ALL', turnNumber: 0, provider: 'provB', model: 'modelB', promptTokens: 1400, completionTokens: 600, totalTokens: 2000, cost: 0.02 });

    await mount();
    const players = await getPlayers('g-multi');
    expect(players).toHaveLength(5);
    for (const p of players) {
      expect(p.provider).toBeUndefined();
      expect(p.model).toBeUndefined();
      expect(p.tokensUsed).toBe(0);
      expect(p.apiCalls).toBe(0);
    }
  });
});
