/**
 * LeagueRunner service tests (MAF-LAYER-3).
 *
 * The runner is exercised through the same fakes the BenchmarkRunner tests
 * use (mocks.ts): an in-memory SQLite repository with the real schema, a
 * fake EventBus, and a fake LegacyGameAdapter that records startGame calls.
 * Tests drive game completion by publishing terminal events — the same
 * contract the real adapter publishes (GAME_ENDED / WINNER_DETERMINED).
 *
 * No child processes, no network, no LLM calls: play-through is proven with
 * the repo's mock surfaces only.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LeagueRunner,
  LeagueValidationError,
  LEAGUE_GAME_TIMEOUT_MS,
  assignSeatMap,
  seatGroupsFor,
  seededShuffle,
  mulberry32,
} from '../../services/league-runner.js';
import {
  createSqliteBackedRepository,
  createFakeEventBus,
  createFakeLegacyGameAdapter,
  type FakeLegacyGameAdapter,
} from './mocks';
// MAF-L3-FM-001: the league reconcile reuses the benchmark policy backstop.
import { STALE_RUN_MAX_MS } from '../../services/benchmark-runner.js';
import type { GameEvent } from '@mafia/shared/events';
import type { EventEmitter } from 'events';

type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

/** Yield to the league loop's microtasks until the condition holds. */
async function until(cond: () => boolean, what: string): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > 5000) {
      throw new Error(`timed out waiting for: ${what}`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

function terminalEvent(gameId: string, winner: string, type: 'WINNER_DETERMINED' | 'GAME_ENDED' = 'GAME_ENDED'): GameEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 10)}`,
    gameId,
    type,
    timestamp: new Date(),
    visibility: 'PUBLIC',
    data: { winner },
    metadata: { turnNumber: 1, dayNumber: 1, phase: 'GAME_OVER', sequence: 1 },
  };
}

describe('LeagueRunner', () => {
  let repo: FakeRepo;
  let eventBus: ReturnType<typeof createFakeEventBus>;
  let adapter: FakeLegacyGameAdapter;
  let runner: LeagueRunner;

  beforeEach(() => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    eventBus = createFakeEventBus();
    adapter = createFakeLegacyGameAdapter(repo as never);
    runner = new LeagueRunner({
      eventBus,
      gameRepository: repo as never,
      legacyAdapter: adapter,
    });
  });

  // ==========================================================================
  // Config validation
  // ==========================================================================

  describe('config validation', () => {
    it('throws when fewer than 2 models are configured', () => {
      expect(() => runner.start({ models: [], budgetUsd: 1 })).toThrow(LeagueValidationError);
      expect(() => runner.start({ models: ['openai/gpt-4o'], budgetUsd: 1 })).toThrow(
        'at least 2 models',
      );
    });

    it('throws on duplicate model entries', () => {
      expect(() =>
        runner.start({ models: ['openai/a', 'openai/a'], budgetUsd: 1 }),
      ).toThrow('Duplicate model in config: openai/a');
    });

    it('throws on empty/whitespace model entries', () => {
      expect(() => runner.start({ models: ['openai/a', '   '], budgetUsd: 1 })).toThrow(
        'Invalid model entry',
      );
    });

    it('throws when models exceed the seat groups a game can host', () => {
      // numPlayers 10 -> 5 seat groups; 6 models cannot all hold a seat.
      expect(() =>
        runner.start({ models: ['m/1', 'm/2', 'm/3', 'm/4', 'm/5', 'm/6'], budgetUsd: 1 }),
      ).toThrow('6 models but a 10-player game only has 5 seat groups');
    });

    it('throws when numPlayers is below the engine minimum', () => {
      expect(() =>
        runner.start({ models: ['a', 'b'], budgetUsd: 1, numPlayers: 4 }),
      ).toThrow('between 5 and 50');
    });

    it('throws when budgetUsd is missing, zero, or negative', () => {
      for (const bad of [undefined, 0, -1, '1' as unknown as number, Number.NaN]) {
        expect(() => runner.start({ models: ['a', 'b'], budgetUsd: bad })).toThrow(
          'budgetUsd must be a positive number',
        );
      }
    });

    it('defaults games to 2 and numPlayers to 10', () => {
      const result = runner.start({ models: ['a', 'b'], budgetUsd: 100 });
      expect(result.games).toBe(2);
      const status = runner.getStatus(result.leagueId)!;
      expect(status.config.numPlayers).toBe(10);
      expect(status.config.games).toBe(2);
    });
  });

  // ==========================================================================
  // Seat assignment (randomized, seeded, every model plays)
  // ==========================================================================

  describe('seat assignment', () => {
    it('exposes the engine role groups as seats (5 at numPlayers>=6, 4 at 5)', () => {
      expect(seatGroupsFor(10)).toEqual(['MAFIA', 'SHERIFF', 'DOCTOR', 'VIGILANTE', 'VILLAGER']);
      expect(seatGroupsFor(5)).toEqual(['MAFIA', 'SHERIFF', 'DOCTOR', 'VILLAGER']);
    });

    it('is deterministic for the same seed and round', () => {
      const a = assignSeatMap(['openai/a', 'openai/b', 'openai/c'], 10, 42, 1);
      const b = assignSeatMap(['openai/a', 'openai/b', 'openai/c'], 10, 42, 1);
      expect(a).toEqual(b);
    });

    it('differs across seeds (randomized per game)', () => {
      // A deterministic PRNG means this assertion is fixed forever: collect
      // the round-1 seat maps for seeds 0..9 and require more than one
      // distinct assignment (a single-seed pair can legitimately collide —
      // two shuffles can produce the same deal).
      const models = ['openai/a', 'openai/b', 'openai/c'];
      const maps = new Set<string>();
      for (let seed = 0; seed < 10; seed++) {
        maps.add(JSON.stringify(assignSeatMap(models, 10, seed, 1)));
      }
      expect(maps.size).toBeGreaterThan(1);
    });

    it('assigns every configured model to at least one seat', () => {
      const models = ['openai/a', 'openai/b', 'openai/c'];
      const seatMap = assignSeatMap(models, 10, 7, 3);
      const assigned = new Set(Object.values(seatMap));
      for (const m of models) expect(assigned.has(m)).toBe(true);
      // And only configured models ever hold a seat.
      for (const m of assigned) expect(models).toContain(m);
    });

    it('is mixed-model whenever 2+ models are configured', () => {
      const seatMap = assignSeatMap(['openai/a', 'openai/b'], 10, 9, 1);
      expect(new Set(Object.values(seatMap)).size).toBeGreaterThanOrEqual(2);
    });

    it('rotates models through seats across seeds (distribution, seed-controlled)', () => {
      // Deterministic PRNG -> the distribution below is fixed forever, so
      // these assertions can never flake: verify once, holds always.
      const models = ['openai/a', 'openai/b'];
      const mafiaSeat = new Map<string, number>();
      for (let seed = 0; seed < 50; seed++) {
        const seatMap = assignSeatMap(models, 10, seed, 1);
        const holder = seatMap.MAFIA;
        mafiaSeat.set(holder, (mafiaSeat.get(holder) ?? 0) + 1);
      }
      // Both models must hold the MAFIA seat somewhere across seeds.
      expect(mafiaSeat.size).toBe(2);
      expect(mafiaSeat.get('openai/a')).toBeGreaterThan(0);
      expect(mafiaSeat.get('openai/b')).toBeGreaterThan(0);
    });

    it('the seeded shuffle is a true permutation', () => {
      const rng = mulberry32(123);
      const shuffled = seededShuffle(['a', 'b', 'c', 'd', 'e'], rng);
      expect([...shuffled].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    });
  });

  // ==========================================================================
  // Play-through (the working engine path, sequentially)
  // ==========================================================================

  describe('league play-through', () => {
    it('plays every round through the legacy adapter and completes the league', async () => {
      const result = runner.start({
        models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
        games: 2,
        numPlayers: 5,
        budgetUsd: 10,
        seatSeed: 1234,
      });

      // Round 1 is armed synchronously by start().
      expect(adapter.started).toHaveLength(1);
      expect(adapter.started[0].config.numPlayers).toBe(5);

      eventBus.publish(terminalEvent(adapter.started[0].gameId, 'MAFIA'));
      await until(() => adapter.started.length >= 2, 'round 2 to launch');
      eventBus.publish(terminalEvent(adapter.started[1].gameId, 'TOWN'));

      await until(
        () => runner.getStatus(result.leagueId)!.status === 'COMPLETED',
        'league to complete',
      );

      const status = runner.getStatus(result.leagueId)!;
      expect(status.status).toBe('COMPLETED');
      expect(status.completedAt).not.toBeNull();
      expect(status.summary).toMatchObject({ totalGames: 2, completedGames: 2, failedGames: 0 });
    });

    it('every game carries a full seat map covering all seat groups (no DEFAULT_MODEL fallback)', () => {
      runner.start({
        models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
        games: 1,
        numPlayers: 10,
        budgetUsd: 10,
        seatSeed: 77,
      });

      expect(adapter.started).toHaveLength(1);
      const roleModels = adapter.started[0].config.roleModels ?? {};
      const groups = seatGroupsFor(10);
      expect(Object.keys(roleModels).sort()).toEqual([...groups].sort());
      // Every seat holds one of the CONFIGURED models.
      for (const model of Object.values(roleModels)) {
        expect(['openai/gpt-4o-mini', 'openai/gpt-4o']).toContain(model);
      }
      // Mixed-model game: both models appear.
      expect(new Set(Object.values(roleModels)).size).toBe(2);
    });

    it('records the winner per game from the terminal event', async () => {
      const result = runner.start({
        models: ['openai/a', 'openai/b'],
        games: 1,
        numPlayers: 5,
        budgetUsd: 10,
        seatSeed: 5,
      });
      eventBus.publish(terminalEvent(adapter.started[0].gameId, 'TOWN'));

      await until(
        () => runner.getStatus(result.leagueId)!.status === 'COMPLETED',
        'league to complete',
      );
      const detail = runner.getDetail(result.leagueId)!;
      expect(detail.games).toHaveLength(1);
      expect(detail.games[0].winner).toBe('TOWN');
      expect(detail.games[0].completedAt).not.toBeNull();
      expect(detail.games[0].error).toBeNull();
    });

    it('leaves zero league games stranded: every league_games row is terminal', async () => {
      const result = runner.start({
        models: ['openai/a', 'openai/b'],
        games: 3,
        numPlayers: 5,
        budgetUsd: 10,
        seatSeed: 11,
      });
      for (let i = 0; adapter.started.length < 3; i++) {
        eventBus.publish(terminalEvent(adapter.started[i].gameId, 'MAFIA'));
        await until(() => adapter.started.length >= i + 2 || adapter.started.length === 3, 'next round');
      }
      eventBus.publish(terminalEvent(adapter.started[2].gameId, 'TOWN'));
      await until(
        () => runner.getStatus(result.leagueId)!.status === 'COMPLETED',
        'league to complete',
      );

      const rows = repo.db
        .prepare('SELECT completed_at, error FROM league_games WHERE league_run_id = ?')
        .all(result.leagueId) as Array<{ completed_at: number | null; error: string | null }>;
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.completed_at !== null || row.error !== null).toBe(true);
      }
    });

    it('seat maps differ between two leagues with different seeds (randomized per game)', async () => {
      const first = runner.start({
        models: ['openai/a', 'openai/b', 'openai/c'],
        games: 1,
        numPlayers: 5,
        budgetUsd: 10,
        seatSeed: 101,
      });
      eventBus.publish(terminalEvent(adapter.started[0].gameId, 'MAFIA'));

      const second = runner.start({
        models: ['openai/a', 'openai/b', 'openai/c'],
        games: 1,
        numPlayers: 5,
        budgetUsd: 10,
        seatSeed: 202,
      });
      eventBus.publish(terminalEvent(adapter.started[1].gameId, 'MAFIA'));

      await until(
        () =>
          runner.getStatus(first.leagueId)!.status === 'COMPLETED' &&
          runner.getStatus(second.leagueId)!.status === 'COMPLETED',
        'both leagues to complete',
      );

      const mapA = runner.getDetail(first.leagueId)!.games[0].seatMap;
      const mapB = runner.getDetail(second.leagueId)!.games[0].seatMap;
      expect(mapA).not.toEqual(mapB);
    });

    it('refuses to start without the legacy adapter (no GameEngine stranding path)', () => {
      const bare = new LeagueRunner({
        eventBus,
        gameRepository: repo as never,
        legacyAdapter: null,
      });
      expect(() => bare.start({ models: ['a', 'b'], budgetUsd: 1 })).toThrow(
        LeagueValidationError,
      );
      expect(() => bare.start({ models: ['a', 'b'], budgetUsd: 1 })).toThrow(
        /legacy game adapter/,
      );
    });
  });

  // ==========================================================================
  // Budget cap
  // ==========================================================================

  describe('budget cap', () => {
    function insertUsage(gameId: string, cost: number | null): void {
      repo.insertTokenUsage({
        gameId,
        playerId: 'p-all',
        turnNumber: 0,
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: cost as number,
      });
    }

    it('stops creating games once spend >= budget and reports BUDGET_CAPPED', async () => {
      const result = runner.start({
        models: ['openai/a', 'openai/b'],
        games: 5,
        numPlayers: 5,
        budgetUsd: 0.5,
        seatSeed: 3,
      });

      // Round 1 plays and records $0.75 of usage — above the $0.50 cap.
      eventBus.publish(terminalEvent(adapter.started[0].gameId, 'MAFIA'));
      insertUsage(adapter.started[0].gameId, 0.75);
      // The spend readback happens on the loop's microtasks; round 2 is
      // REFUSED (spend 0.75 >= 0.50), so the league terminalizes without
      // ever launching another game.
      await until(
        () => runner.getStatus(result.leagueId)!.status === 'BUDGET_CAPPED',
        'league to hit the budget cap',
      );

      expect(adapter.started).toHaveLength(1); // no game started after the cap
      const status = runner.getStatus(result.leagueId)!;
      expect(status.status).toBe('BUDGET_CAPPED');
      expect(status.completedAt).not.toBeNull();
      expect(status.summary).toMatchObject({ capped: true, totalGames: 1, completedGames: 1 });

      const detail = runner.getDetail(result.leagueId)!;
      expect(detail.spend.spentUsd).toBe(0.75);
      expect(detail.spend.capped).toBe(true);
    });

    it('counts only the league\'s own games toward spend', async () => {
      // Foreign game usage (another run's game id) must not leak in.
      repo.seedGame({ id: 'foreign-game', status: 'ENDED' });
      insertUsage('foreign-game', 999);

      const result = runner.start({
        models: ['openai/a', 'openai/b'],
        games: 2,
        numPlayers: 5,
        budgetUsd: 5,
        seatSeed: 3,
      });
      eventBus.publish(terminalEvent(adapter.started[0].gameId, 'MAFIA'));
      // Game 1 spent $1 — below the $5 cap, so round 2 must still launch.
      insertUsage(adapter.started[0].gameId, 1);
      await until(() => adapter.started.length >= 2, 'round 2 to launch');
      expect(adapter.started).toHaveLength(2);

      eventBus.publish(terminalEvent(adapter.started[1].gameId, 'TOWN'));
      await until(
        () => runner.getStatus(result.leagueId)!.status === 'COMPLETED',
        'league to complete',
      );
      const detail = runner.getDetail(result.leagueId)!;
      expect(detail.spend.spentUsd).toBe(1); // the foreign $999 never counted
      expect(detail.spend.capped).toBe(false);
    });

    it('missing cost rows count as 0 spend but the game still counts', async () => {
      const result = runner.start({
        models: ['openai/a', 'openai/b'],
        games: 2,
        numPlayers: 5,
        budgetUsd: 0.01,
        seatSeed: 3,
      });
      // Game 1 has usage rows but every cost is NULL (no pricing entry):
      // spend stays 0, the gate does NOT fire, round 2 launches.
      eventBus.publish(terminalEvent(adapter.started[0].gameId, 'MAFIA'));
      insertUsage(adapter.started[0].gameId, null);
      await until(() => adapter.started.length >= 2, 'round 2 to launch (null cost = 0 spend)');
      expect(adapter.started).toHaveLength(2);

      eventBus.publish(terminalEvent(adapter.started[1].gameId, 'TOWN'));
      await until(
        () => runner.getStatus(result.leagueId)!.status === 'COMPLETED',
        'league to complete',
      );
      const detail = runner.getDetail(result.leagueId)!;
      expect(detail.spend.spentUsd).toBe(0);
      expect(detail.spend.capped).toBe(false);
      // The game's own cost surfaces as null (absence, not zero).
      expect(detail.games[0].costUsd).toBeNull();
      expect(detail.games[0].totalTokens).toBe(150);
    });
  });

  // ==========================================================================
  // Provenance persistence
  // ==========================================================================

  describe('provenance persistence', () => {
    it('persists the league run and per-game provenance (league id, round, seat map, seed)', async () => {
      const result = runner.start({
        models: ['openai/a', 'openai/b'],
        games: 1,
        numPlayers: 5,
        budgetUsd: 10,
        seatSeed: 424242,
      });
      eventBus.publish(terminalEvent(adapter.started[0].gameId, 'MAFIA'));
      await until(
        () => runner.getStatus(result.leagueId)!.status === 'COMPLETED',
        'league to complete',
      );

      const row = repo.db
        .prepare('SELECT * FROM league_games WHERE league_run_id = ?')
        .get(result.leagueId) as {
        game_id: string;
        league_run_id: string;
        round: number;
        seat_map: string;
        seat_seed: number;
      };
      expect(row).toBeDefined();
      expect(row.league_run_id).toBe(result.leagueId);
      expect(row.round).toBe(1);
      expect(row.game_id).toBe(adapter.started[0].gameId);
      expect(row.seat_seed).toBe((424242 + 1) >>> 0);
      const seatMap = JSON.parse(row.seat_map) as Record<string, string>;
      expect(Object.keys(seatMap).sort()).toEqual([...seatGroupsFor(5)].sort());

      // ...and the same provenance is served through getDetail.
      const detail = runner.getDetail(result.leagueId)!;
      expect(detail.status.config).toMatchObject({
        models: ['openai/a', 'openai/b'],
        numPlayers: 5,
        games: 1,
        budgetUsd: 10,
        seatSeed: 424242,
      });
      expect(detail.games[0].seatMap).toEqual(seatMap);
      expect(detail.games[0].round).toBe(1);
    });

    it('returns null for an unknown league id', () => {
      expect(runner.getStatus('nope')).toBeNull();
      expect(runner.getDetail('nope')).toBeNull();
    });

    it('listLeagues returns runs most recent first', async () => {
      const first = runner.start({ models: ['a', 'b'], games: 1, budgetUsd: 10, seatSeed: 1 });
      eventBus.publish(terminalEvent(adapter.started[0].gameId, 'MAFIA'));
      const second = runner.start({ models: ['a', 'b'], games: 1, budgetUsd: 10, seatSeed: 2 });
      eventBus.publish(terminalEvent(adapter.started[1].gameId, 'MAFIA'));
      await until(
        () =>
          runner.getStatus(first.leagueId)!.status === 'COMPLETED' &&
          runner.getStatus(second.leagueId)!.status === 'COMPLETED',
        'both leagues to complete',
      );

      const list = runner.listLeagues();
      expect(list).toHaveLength(2);
      expect(list[0].leagueId).toBe(second.leagueId);
      expect(list[1].leagueId).toBe(first.leagueId);
    });
  });

  // ==========================================================================
  // Failure handling — every game ends ENDED or with a recorded reason
  // ==========================================================================

  describe('failure handling', () => {
    it('records the launch failure as run-level evidence when the adapter throws', async () => {
      adapter.startGame = () => {
        throw new Error('bridge spawn refused');
      };
      const result = runner.start({
        models: ['openai/a', 'openai/b'],
        games: 1,
        numPlayers: 5,
        budgetUsd: 10,
        seatSeed: 8,
      });
      await until(
        () => runner.getStatus(result.leagueId)!.status === 'FAILED',
        'league to fail',
      );

      const status = runner.getStatus(result.leagueId)!;
      expect(status.status).toBe('FAILED');
      expect(status.error).toContain('bridge spawn refused');
      // A launch that never produced a game has NO league_games row — the
      // failure lives on the run row (error + summary.launchFailures).
      const detail = runner.getDetail(result.leagueId)!;
      expect(detail.games).toHaveLength(0);
      expect(status.summary).toMatchObject({ launchFailures: 1, totalGames: 0 });
    });

    it('ends the league FAILED when the bridge child dies without a terminal event', async () => {
      // Swap in an adapter whose game state carries a real event-emitting
      // child process handle, so the close-without-done path is exercised.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const failing: any = {
        startGame(config: unknown) {
          void config;
          const { EventEmitter } = require('events') as typeof import('events');
          const child: EventEmitter = new EventEmitter();
          const gameId = `legacy-dying-${adapter.started.length + 1}`;
          adapter.started.push({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            config: config as any,
            gameId,
          });
          repo.db
            .prepare(`INSERT INTO games (id, status, config, created_at) VALUES (?, 'IN_PROGRESS', ?, ?)`)
            .run(gameId, JSON.stringify({ numPlayers: 5, engineType: 'legacy' }), Date.now());
          queueMicrotask(() => child.emit('close', 1));
          return { gameId, process: child, eventCount: 0, status: 'RUNNING', startedAt: new Date() };
        },
        getActiveGames: () => [],
        getGameState: () => undefined,
        stopGame: () => false,
        stopAll: () => {},
      };
      const dyingRunner = new LeagueRunner({
        eventBus,
        gameRepository: repo as never,
        legacyAdapter: failing,
      });

      const result = dyingRunner.start({
        models: ['openai/a', 'openai/b'],
        games: 1,
        numPlayers: 5,
        budgetUsd: 10,
        seatSeed: 9,
      });
      await until(
        () => dyingRunner.getStatus(result.leagueId)!.status === 'FAILED',
        'league to fail',
      );

      const status = dyingRunner.getStatus(result.leagueId)!;
      expect(status.status).toBe('FAILED');
      expect(status.error).toContain('exited with code 1');
      const detail = dyingRunner.getDetail(result.leagueId)!;
      expect(detail.games[0].error).toContain('without publishing');
    });

    it('the per-game timeout policy constant is 30 minutes (documented backstop)', () => {
      expect(LEAGUE_GAME_TIMEOUT_MS).toBe(30 * 60 * 1000);
    });
  });

  // ==========================================================================
  // Cancellation
  // ==========================================================================

  describe('cancellation', () => {
    it('cancels a running league; the loop stops before the next round', async () => {
      const result = runner.start({
        models: ['openai/a', 'openai/b'],
        games: 3,
        numPlayers: 5,
        budgetUsd: 100,
        seatSeed: 2,
      });
      expect(adapter.started).toHaveLength(1);

      expect(runner.cancel(result.leagueId)).toBe(true);
      await until(
        () => runner.getStatus(result.leagueId)!.status === 'CANCELLED',
        'league to cancel',
      );

      // Give the loop time to (wrongly) launch round 2 — it must not.
      await new Promise((r) => setTimeout(r, 50));
      expect(adapter.started).toHaveLength(1);
      expect(runner.getStatus(result.leagueId)!.completedAt).not.toBeNull();
    });

    it('cancel is false for unknown or already-terminal leagues', async () => {
      expect(runner.cancel('nope')).toBe(false);
      const result = runner.start({
        models: ['openai/a', 'openai/b'],
        games: 1,
        numPlayers: 5,
        budgetUsd: 10,
        seatSeed: 2,
      });
      eventBus.publish(terminalEvent(adapter.started[0].gameId, 'MAFIA'));
      await until(
        () => runner.getStatus(result.leagueId)!.status === 'COMPLETED',
        'league to complete',
      );
      expect(runner.cancel(result.leagueId)).toBe(false);
    });
  });

  // ==========================================================================
  // Stranded-run reconciliation (MAF-L3-FM-001)
  //
  // Fixtures are written straight into the durable tables the reconcile
  // reads (league_runs / league_games), exactly as a crash mid-loop would
  // have left them: a non-terminal run row plus per-game rows that may or
  // may not carry terminal evidence.
  // ==========================================================================

  describe('stranded-run reconciliation (MAF-L3-FM-001)', () => {
    type FixtureConfig = {
      models: string[];
      numPlayers: number;
      games: number;
      budgetUsd: number;
      seatSeed: number;
    };

    function insertStrandedRun(
      id: string,
      status: 'QUEUED' | 'RUNNING',
      config: Partial<FixtureConfig> = {},
      createdAt: number = Date.now(),
    ): void {
      const full: FixtureConfig = {
        models: ['a', 'b'],
        numPlayers: 5,
        games: 1,
        budgetUsd: 10,
        seatSeed: 1,
        ...config,
      };
      const now = Date.now();
      repo.db
        .prepare(
          'INSERT INTO league_runs (id, config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, JSON.stringify(full), status, createdAt, now);
    }

    function insertLeagueGameRow(
      leagueId: string,
      gameId: string,
      round: number,
      fields: { winner?: string | null; completedAt?: number | null; error?: string | null } = {},
    ): void {
      // league_games.game_id is an FK to games(id) — seed the game first.
      repo.seedGame({ id: gameId, status: fields.error ? 'FAILED' : 'ENDED' });
      repo.db
        .prepare(
          `INSERT INTO league_games (game_id, league_run_id, round, seat_map, seat_seed, winner, completed_at, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          gameId,
          leagueId,
          round,
          JSON.stringify({ MAFIA: 'a', SHERIFF: 'b', DOCTOR: 'a', VILLAGER: 'b' }),
          round,
          fields.winner ?? null,
          fields.completedAt ?? null,
          fields.error ?? null,
        );
    }

    function readRunRow(id: string): {
      status: string;
      completed_at: number | null;
      summary: string | null;
      error: string | null;
    } {
      return repo.db
        .prepare('SELECT status, completed_at, summary, error FROM league_runs WHERE id = ?')
        .get(id) as {
        status: string;
        completed_at: number | null;
        summary: string | null;
        error: string | null;
      };
    }

    it('reconciles a stranded RUNNING league whose durable game rows prove it terminal', () => {
      insertStrandedRun('lg-stranded', 'RUNNING', { games: 1 });
      insertLeagueGameRow('lg-stranded', 'game-done-1', 1, {
        winner: 'MAFIA',
        completedAt: Date.now(),
      });

      const summary = runner.reconcileStrandedRuns();
      expect(summary).toEqual({ inspected: 1, reconciled: 1, leftActive: 0, staleFailed: 0 });

      const row = readRunRow('lg-stranded');
      expect(row.status).toBe('COMPLETED');
      expect(row.completed_at).not.toBeNull();
      expect(row.error).toBeNull();
      // Summary is the same shape the live loop's terminalize() writes, so
      // the recovered run is self-describing like a live-completed one.
      expect(JSON.parse(row.summary ?? '{}')).toMatchObject({
        totalGames: 1,
        completedGames: 1,
        failedGames: 0,
        roundsScheduled: 1,
      });
      // The recovered run is served through the normal read path.
      const status = runner.getStatus('lg-stranded')!;
      expect(status.status).toBe('COMPLETED');
      expect(runner.getDetail('lg-stranded')!.games[0].winner).toBe('MAFIA');
    });

    it('reconciles a stranded RUNNING league to FAILED when a game row carries the error', () => {
      insertStrandedRun('lg-errored', 'RUNNING', { games: 2 });
      insertLeagueGameRow('lg-errored', 'game-ok-1', 1, { winner: 'TOWN', completedAt: Date.now() });
      insertLeagueGameRow('lg-errored', 'game-bad-2', 2, { error: 'bridge died mid-game' });

      const summary = runner.reconcileStrandedRuns();
      expect(summary.reconciled).toBe(1);

      const row = readRunRow('lg-errored');
      expect(row.status).toBe('FAILED');
      expect(row.error).toContain('game-bad-2: bridge died mid-game');
      expect(row.completed_at).not.toBeNull();
      expect(JSON.parse(row.summary ?? '{}')).toMatchObject({
        totalGames: 2,
        completedGames: 1,
        failedGames: 1,
      });
    });

    it('preserves a RUNNING league with no durable terminal evidence (genuinely active shape)', () => {
      // Mid-flight shape: the loop launched round 1 of 2 and the game row
      // has neither completed_at nor error — inconclusive, left untouched.
      insertStrandedRun('lg-active', 'RUNNING', { games: 2 });
      insertLeagueGameRow('lg-active', 'game-inflight-1', 1);

      // QUEUED with zero game rows is equally non-conclusive.
      insertStrandedRun('lg-queued', 'QUEUED', { games: 1 });

      const summary = runner.reconcileStrandedRuns();
      expect(summary).toEqual({ inspected: 2, reconciled: 0, leftActive: 2, staleFailed: 0 });

      expect(readRunRow('lg-active').status).toBe('RUNNING');
      expect(readRunRow('lg-queued').status).toBe('QUEUED');
      expect(readRunRow('lg-active').completed_at).toBeNull();
    });

    it('is idempotent: a second pass finds nothing and leaves the reconciled row untouched', () => {
      insertStrandedRun('lg-once', 'RUNNING', { games: 1 });
      insertLeagueGameRow('lg-once', 'game-once-1', 1, { winner: 'MAFIA', completedAt: Date.now() });

      const first = runner.reconcileStrandedRuns();
      expect(first.reconciled).toBe(1);

      const before = readRunRow('lg-once');
      const second = runner.reconcileStrandedRuns();
      expect(second).toEqual({ inspected: 0, reconciled: 0, leftActive: 0, staleFailed: 0 });
      expect(readRunRow('lg-once')).toEqual(before);
    });

    it('sweeps a non-terminal league older than STALE_RUN_MAX_MS to FAILED (same backstop as benchmark)', () => {
      insertStrandedRun(
        'lg-stale',
        'RUNNING',
        { games: 2 },
        Date.now() - (STALE_RUN_MAX_MS + 60_000),
      );
      insertLeagueGameRow('lg-stale', 'game-stale-1', 1, { winner: 'MAFIA', completedAt: Date.now() });

      const summary = runner.reconcileStrandedRuns();
      expect(summary).toEqual({ inspected: 1, reconciled: 0, leftActive: 0, staleFailed: 1 });

      const row = readRunRow('lg-stale');
      expect(row.status).toBe('FAILED');
      expect(row.error).toContain('abandoned');
      expect(row.completed_at).not.toBeNull();
    });
  });
});
