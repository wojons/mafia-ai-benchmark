/**
 * Game result exposure — MAF-GAP-056.
 *
 * GET /api/v1/games/:id must return the decided outcome: a top-level
 * `winner` (MAFIA|TOWN) and per-player `won` (1 winning side / 0 losing
 * side). Covers the repository read path (winner column + config fallback,
 * players.won mapping), the adapter write path (done handler persists the
 * games.winner column so summary mafiaWins+townWins reconcile with ENDED
 * games), and the route's legacy-fallback branch (GAME_ENDED-derived
 * winner + side-derived won, absent when nothing is known).
 */
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';
import { createGamesRouter } from '../../routes/games.js';
import {
  createSqliteBackedRepository,
  createFakeEventBus,
} from './mocks.js';
import type { LegacyGameAdapter as LegacyGameAdapterType } from '../../services/legacy-game-adapter.js';

const ROLES_EVENT = {
  type: 'ROLES_ASSIGNED',
  data: {
    assignments: [
      { playerId: 'p-maf', role: 'MAFIA' },
      { playerId: 'p-town', role: 'VILLAGER' },
    ],
    mafiaTeam: ['p-maf'],
  },
};

/** Minimal legacy adapter reporting the given states by game id. */
function createLegacyAdapterWithStates(
  states: Record<string, { status: string }>,
): LegacyGameAdapterType {
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
  } as unknown as LegacyGameAdapterType;
}

describe('MAF-GAP-056: game detail exposes winner + per-player won', () => {
  // ==========================================================================
  // Repository read path (getPlayers / getGame)
  // ==========================================================================

  describe('repository getPlayers()', () => {
    it('maps players.won (1/0) from the column', () => {
      const repo = createSqliteBackedRepository();
      repo.seedGame({
        id: 'g-won',
        status: 'ENDED',
        events: [ROLES_EVENT],
        players: [
          { id: 'p-maf', name: 'Maf', role: 'MAFIA', isMafia: true, joinOrder: 0 },
          { id: 'p-town', name: 'Town', role: 'VILLAGER', isMafia: false, joinOrder: 1 },
        ],
      });
      // Mirror setPlayersWon at game end for a TOWN win.
      repo.db
        .prepare('UPDATE players SET won = CASE WHEN is_mafia = 1 THEN 0 ELSE 1 END WHERE game_id = ?')
        .run('g-won');

      const players = repo.getPlayers('g-won');
      const byId = new Map(players.map((p) => [p.id, p]));
      expect(byId.get('p-maf')?.won).toBe(0);
      expect(byId.get('p-town')?.won).toBe(1);
    });

    it('omits won when the column is NULL (no decided outcome)', () => {
      const repo = createSqliteBackedRepository();
      repo.seedGame({
        id: 'g-nowon',
        status: 'IN_PROGRESS',
        events: [ROLES_EVENT],
        players: [
          { id: 'p-maf', name: 'Maf', role: 'MAFIA', isMafia: true, joinOrder: 0 },
          { id: 'p-town', name: 'Town', role: 'VILLAGER', isMafia: false, joinOrder: 1 },
        ],
      });

      const players = repo.getPlayers('g-nowon');
      for (const p of players) {
        expect('won' in p).toBe(false);
      }
    });
  });

  describe('repository getGame() top-level winner', () => {
    it('prefers the games.winner column', () => {
      const repo = createSqliteBackedRepository();
      repo.seedGame({
        id: 'g-col',
        status: 'ENDED',
        winner: 'MAFIA',
        events: [
          ROLES_EVENT,
          { type: 'GAME_ENDED', data: { winner: 'TOWN', reason: 'stale' } },
        ],
      });

      const game = repo.getGame('g-col');
      expect(game?.winner).toBe('MAFIA');
    });

    it('falls back to config.winner when the column is NULL (historical legacy games)', () => {
      const repo = createSqliteBackedRepository();
      repo.seedGame({ id: 'g-cfg', status: 'ENDED', events: [ROLES_EVENT] });
      // The pre-MAF-GAP-056 adapter wrote ONLY the config blob.
      repo.db
        .prepare("UPDATE games SET config = json_set(config, '$.winner', ?) WHERE id = ?")
        .run('TOWN', 'g-cfg');

      const game = repo.getGame('g-cfg');
      expect(game?.winner).toBe('TOWN');
    });

    it('keeps winner absent (not fabricated) when neither column nor config has one', () => {
      const repo = createSqliteBackedRepository();
      repo.seedGame({
        id: 'g-none',
        status: 'ENDED',
        events: [{ type: 'GAME_ENDED', data: { winner: 'UNKNOWN' } }],
      });

      const game = repo.getGame('g-none');
      expect(game).not.toBeNull();
      expect(game?.winner).toBeUndefined();
      // Byte-identical rule (MAF-GAP-029): no decided outcome -> no key.
      expect('winner' in (game as object)).toBe(false);
    });

    it('exposes per-player won through getGame().players', () => {
      const repo = createSqliteBackedRepository();
      repo.seedGame({
        id: 'g-detail',
        status: 'ENDED',
        winner: 'TOWN',
        events: [ROLES_EVENT],
        players: [
          { id: 'p-maf', name: 'Maf', role: 'MAFIA', isMafia: true, joinOrder: 0 },
          { id: 'p-town', name: 'Town', role: 'VILLAGER', isMafia: false, joinOrder: 1 },
        ],
      });
      repo.db
        .prepare('UPDATE players SET won = CASE WHEN is_mafia = 1 THEN 0 ELSE 1 END WHERE game_id = ?')
        .run('g-detail');

      const game = repo.getGame('g-detail');
      const byId = new Map<string, any>((game?.players ?? []).map((p): [string, any] => [p.id, p]));
      expect(byId.get('p-maf')?.won).toBe(0);
      expect(byId.get('p-town')?.won).toBe(1);
    });
  });

  // ==========================================================================
  // Adapter write path: done handler persists the games.winner column
  // ==========================================================================

  describe('legacy adapter done handler', () => {
    it('writes the games.winner column on a real winner (summary reconciles)', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({
        id: 'g-col-write',
        status: 'IN_PROGRESS',
        players: [
          { id: 'p-maf', name: 'Maf', role: 'MAFIA', isMafia: true, joinOrder: 0 },
          { id: 'p-town', name: 'Town', role: 'VILLAGER', isMafia: false, joinOrder: 1 },
        ],
      });
      const sqliteAdapter = new LegacyGameAdapter(
        createFakeEventBus(),
        sqliteRepo as any,
      );
      (sqliteAdapter as any).activeGames.set('g-col-write', {
        gameId: 'g-col-write',
        process: null,
        eventCount: 2,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5000),
      });

      (sqliteAdapter as any).handleBridgeMessage('g-col-write', {
        type: 'done',
        winner: 'TOWN',
        totalEvents: 2,
        dayCount: 1,
        usage: [],
      });

      const row = sqliteRepo.db
        .prepare('SELECT status, winner FROM games WHERE id = ?')
        .get('g-col-write') as Record<string, unknown>;
      expect(row.status).toBe('ENDED');
      expect(row.winner).toBe('TOWN');

      // Summary reconciliation: the win now counts toward townWins.
      const stats = sqliteRepo.getGameStats();
      expect(stats.mafiaWins).toBe(0);
      expect(stats.townWins).toBe(1);
    });

    it('leaves the games.winner column NULL when the bridge reports no real winner', () => {
      const sqliteRepo = createSqliteBackedRepository();
      sqliteRepo.seedGame({ id: 'g-col-null', status: 'IN_PROGRESS' });
      const sqliteAdapter = new LegacyGameAdapter(
        createFakeEventBus(),
        sqliteRepo as any,
      );
      (sqliteAdapter as any).activeGames.set('g-col-null', {
        gameId: 'g-col-null',
        process: null,
        eventCount: 1,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5000),
      });

      (sqliteAdapter as any).handleBridgeMessage('g-col-null', {
        type: 'done',
        winner: null,
        totalEvents: 1,
        dayCount: 1,
        usage: [],
      });

      const row = sqliteRepo.db
        .prepare('SELECT status, winner FROM games WHERE id = ?')
        .get('g-col-null') as Record<string, unknown>;
      expect(row.status).toBe('ENDED');
      expect(row.winner).toBeNull();

      const stats = sqliteRepo.getGameStats();
      expect(stats.mafiaWins + stats.townWins).toBe(0);
    });
  });

  // ==========================================================================
  // Route: main repository branch + legacy-fallback branch over HTTP
  // ==========================================================================

  describe('GET /api/v1/games/:id', () => {
    let server: Server;
    let baseUrl: string;

    async function mount(adapter?: LegacyGameAdapterType): Promise<void> {
      const app = express();
      app.use(express.json());
      app.use('/', createGamesRouter(
        { gameEngine: {}, gameRepository: repo, eventBus: createFakeEventBus() } as any,
        adapter ?? null,
      ));
      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => resolve());
      });
      const address = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${address.port}`;
    }

    let repo: ReturnType<typeof createSqliteBackedRepository>;

    afterEach(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    });

    it('(main branch) ENDED game returns top-level winner matching GAME_ENDED + per-player won', async () => {
      repo = createSqliteBackedRepository();
      repo.seedGame({
        id: 'g-api-ended',
        status: 'ENDED',
        winner: 'TOWN',
        endedAt: Date.now(),
        events: [
          ROLES_EVENT,
          { type: 'GAME_ENDED', data: { winner: 'TOWN', reason: 'Legacy engine completed' } },
        ],
        players: [
          { id: 'p-maf', name: 'Maf', role: 'MAFIA', isMafia: true, joinOrder: 0 },
          { id: 'p-town', name: 'Town', role: 'VILLAGER', isMafia: false, joinOrder: 1 },
        ],
      });
      repo.db
        .prepare('UPDATE players SET won = CASE WHEN is_mafia = 1 THEN 0 ELSE 1 END WHERE game_id = ?')
        .run('g-api-ended');

      await mount();
      const res = await fetch(`${baseUrl}/api/v1/games/g-api-ended`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // PASS criterion 1: winner matches the GAME_ENDED event.
      expect(body.data.winner).toBe('TOWN');
      // Per-player won present and correct.
      const byId = new Map<string, any>(
        body.data.players.map((p: any) => [p.id, p]),
      );
      expect(byId.get('p-maf').won).toBe(0);
      expect(byId.get('p-town').won).toBe(1);
    });

    it('(main branch) running game without results stays byte-identical: no winner/won keys', async () => {
      repo = createSqliteBackedRepository();
      repo.seedGame({
        id: 'g-api-live',
        status: 'IN_PROGRESS',
        events: [ROLES_EVENT],
        players: [
          { id: 'p-maf', name: 'Maf', role: 'MAFIA', isMafia: true, joinOrder: 0 },
          { id: 'p-town', name: 'Town', role: 'VILLAGER', isMafia: false, joinOrder: 1 },
        ],
      });

      await mount();
      const res = await fetch(`${baseUrl}/api/v1/games/g-api-live`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect('winner' in body.data).toBe(false);
      for (const p of body.data.players) {
        expect('won' in p).toBe(false);
      }
    });

    it('(legacy-fallback branch) completed legacy game derives winner from GAME_ENDED and per-player won from sides', async () => {
      repo = createSqliteBackedRepository();
      // No games row -> the route takes the legacyAdapter.getGameState
      // branch. FK enforcement relaxed for the fixture (same pattern as the
      // MAF-GAP-029 suite).
      repo.db.pragma('foreign_keys = OFF');
      const insertEvent = repo.db.prepare(
        `INSERT INTO events (id, game_id, type, timestamp, visibility, actor_id, target_id, data, turn_number, day_number, phase, sequence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertEvent.run('evt-lf-1', 'g-legacy-ended', 'ROLES_ASSIGNED', Date.now(), 'PUBLIC', null, null, JSON.stringify(ROLES_EVENT.data), 1, 1, 'SETUP', 1);
      insertEvent.run('evt-lf-2', 'g-legacy-ended', 'GAME_ENDED', Date.now(), 'PUBLIC', null, null, JSON.stringify({ winner: 'MAFIA', reason: 'Legacy engine completed' }), 2, 2, 'GAME_OVER', 2);

      await mount(createLegacyAdapterWithStates({
        'g-legacy-ended': { status: 'COMPLETED' },
      }));

      const res = await fetch(`${baseUrl}/api/v1/games/g-legacy-ended`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('ENDED');

      // PASS criterion 1 on the fallback branch too.
      expect(body.data.winner).toBe('MAFIA');
      const byId = new Map<string, any>(
        body.data.players.map((p: any) => [p.id, p]),
      );
      expect(byId.get('p-maf')).toMatchObject({ won: 1, isMafia: true });
      expect(byId.get('p-town')).toMatchObject({ won: 0, isMafia: false });
      // Result-state parity with the main branch.
      expect(body.data.currentState.eliminatedPlayers).toEqual([]);
      expect(body.data.currentState.activePlayers.sort()).toEqual(['p-maf', 'p-town']);
    });

    it('(legacy-fallback branch) running legacy game emits no winner/won (no fabrication)', async () => {
      repo = createSqliteBackedRepository();
      repo.db.pragma('foreign_keys = OFF');
      const insertEvent = repo.db.prepare(
        `INSERT INTO events (id, game_id, type, timestamp, visibility, actor_id, target_id, data, turn_number, day_number, phase, sequence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertEvent.run('evt-lr-1', 'g-legacy-live', 'ROLES_ASSIGNED', Date.now(), 'PUBLIC', null, null, JSON.stringify(ROLES_EVENT.data), 1, 1, 'SETUP', 1);

      await mount(createLegacyAdapterWithStates({
        'g-legacy-live': { status: 'RUNNING' },
      }));

      const res = await fetch(`${baseUrl}/api/v1/games/g-legacy-live`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.status).toBe('IN_PROGRESS');
      expect('winner' in body.data).toBe(false);
      expect('currentState' in body.data).toBe(false);
      for (const p of body.data.players) {
        expect('won' in p).toBe(false);
      }
    });
  });
});
