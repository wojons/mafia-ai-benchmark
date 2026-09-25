import { describe, it, expect, beforeEach } from 'vitest';
import { BenchmarkRunner, STALE_RUN_MAX_MS } from '../../services/benchmark-runner.js';
import { createSqliteBackedRepository, createFakeEventBus, createFakeStatsCollector, createFakeAgentCoordinator, createFakeLegacyGameAdapter } from './mocks.js';
import type { GameEngine } from '../../services/game-engine.js';
import type { GameEvent } from '@mafia/shared/events';

describe('BenchmarkRunner', () => {
  let repo: ReturnType<typeof createSqliteBackedRepository>;
  let eventBus: ReturnType<typeof createFakeEventBus>;
  let stats: ReturnType<typeof createFakeStatsCollector>;
  let agentCoord: ReturnType<typeof createFakeAgentCoordinator>;
  let runner: BenchmarkRunner;

  beforeEach(() => {
    repo = createSqliteBackedRepository();
    eventBus = createFakeEventBus();
    stats = createFakeStatsCollector();
    agentCoord = createFakeAgentCoordinator();
    runner = new BenchmarkRunner({
      gameEngine: {} as GameEngine,
      agentCoordinator: agentCoord,
      eventBus,
      statsCollector: stats,
      gameRepository: repo as any,
    });
  });

  /** Build a terminal event (WINNER_DETERMINED or GAME_ENDED) for a game. */
  function terminalEvent(gameId: string, type: 'WINNER_DETERMINED' | 'GAME_ENDED', winner: string): GameEvent {
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

  // ==========================================================================
  // Validation
  // ==========================================================================

  describe('config validation', () => {
    it('throws when models array is empty', () => {
      expect(() => runner.start({ models: [] })).toThrow(
        'Benchmark config must include at least 2 models',
      );
    });

    it('throws when models array has only one entry', () => {
      expect(() => runner.start({ models: ['gpt-4'] })).toThrow(
        'Benchmark config must include at least 2 models',
      );
    });

    it('throws on duplicate model entries', () => {
      expect(() =>
        runner.start({ models: ['gpt-4', 'claude-3', 'gpt-4'] }),
      ).toThrow('Duplicate model in config: gpt-4');
    });

    it('throws on empty/whitespace model strings', () => {
      expect(() =>
        runner.start({ models: ['gpt-4', '   '] }),
      ).toThrow('Invalid model entry');
    });
  });

  // ==========================================================================
  // listRuns
  // ==========================================================================

  describe('listRuns()', () => {
    it('returns empty array when no runs exist', () => {
      expect(runner.listRuns()).toEqual([]);
    });
  });

  // ==========================================================================
  // getStatus
  // ==========================================================================

  describe('getStatus()', () => {
    it('returns null for unknown run ID', () => {
      expect(runner.getStatus('nonexistent')).toBeNull();
    });
  });

  // ==========================================================================
  // getProgress
  // ==========================================================================

  describe('getProgress()', () => {
    it('returns null for unknown run ID', () => {
      expect(runner.getProgress('nonexistent')).toBeNull();
    });
  });

  // ==========================================================================
  // cancel
  // ==========================================================================

  describe('cancel()', () => {
    it('returns false for unknown run ID', () => {
      expect(runner.cancel('nonexistent')).toBe(false);
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('handles gamesPerPairing=0 by defaulting to 2 (via validateConfig)', () => {
      // Validation via validateConfig defaults gamesPerPairing=0 to 2.
      // The runner requires a real gameEngine to start; we test that
      // validation passes and the error is from the missing engine.
      expect(() =>
        runner.start({ models: ['a', 'b'], gamesPerPairing: 0 }),
      ).toThrow();
    });

    it('handles very large numPlayers gracefully', () => {
      expect(() =>
        runner.start({ models: ['a', 'b'], numPlayers: 100 }),
      ).toThrow();
    });
  });

  // ==========================================================================
  // Legacy adapter path (MAF-GAP-011)
  // ==========================================================================

  describe('legacy adapter path', () => {
    it('launches games via the legacy adapter when one is provided (no GameEngine calls)', () => {
      const legacyAdapter = createFakeLegacyGameAdapter(repo as any);
      const engineCalls = { createGame: 0, joinGame: 0, startGame: 0 };
      runner = new BenchmarkRunner({
        gameEngine: {
          createGame: () => { engineCalls.createGame++; return { id: 'engine-game' }; },
          joinGame: () => { engineCalls.joinGame++; return { success: true }; },
          startGame: () => { engineCalls.startGame++; return { success: true }; },
        } as unknown as GameEngine,
        agentCoordinator: agentCoord,
        eventBus,
        statsCollector: stats,
        gameRepository: repo as any,
        legacyAdapter,
      });

      const result = runner.start({ models: ['openrouter:model-a', 'openrouter:model-b'], gamesPerPairing: 1, numPlayers: 5 });

      expect(result.totalGames).toBe(1);
      expect(legacyAdapter.started).toHaveLength(1);
      expect(engineCalls.createGame).toBe(0);
      expect(engineCalls.joinGame).toBe(0);
      expect(engineCalls.startGame).toBe(0);

      const config = legacyAdapter.started[0].config;
      expect(config.numPlayers).toBe(5);
      // Benchmark specs use "provider:model"; the legacy engine expects
      // "provider/model" role-model strings. parseModel uppercases the
      // provider (pre-existing behavior), and the legacy engine's
      // composeModelId passes strings containing "/" through unchanged.
      expect(config.roleModels).toEqual({
        MAFIA: 'OPENROUTER/model-a',
        SHERIFF: 'OPENROUTER/model-a',
        TOWN: 'OPENROUTER/model-b',
        DOCTOR: 'OPENROUTER/model-b',
      });

      // The benchmark_games row is persisted with the legacy game id.
      const row = (repo as any).db
        .prepare('SELECT * FROM benchmark_games WHERE run_id = ?')
        .get(result.runId) as any;
      expect(row).toBeDefined();
      expect(row.game_id).toBe(legacyAdapter.started[0].gameId);
      expect(row.model_a).toBe('openrouter:model-a');
      expect(row.model_b).toBe('openrouter:model-b');
      // Roles are not observable on the legacy path -> VILLAGER default.
      expect(row.model_a_role).toBe('VILLAGER');
      expect(row.model_b_role).toBe('VILLAGER');
    });

    it('keeps the GameEngine path when no adapter is provided', () => {
      const engineCalls = { createGame: 0, joinGame: 0, startGame: 0 };
      runner = new BenchmarkRunner({
        gameEngine: {
          createGame: () => {
            engineCalls.createGame++;
            // The real GameEngine persists the game via the repository; the
            // benchmark_games FK (game_id -> games.id) requires the row.
            (repo as any).db
              .prepare(`INSERT INTO games (id, status, config, created_at) VALUES (?, 'SETUP', ?, ?)`)
              .run('engine-game', JSON.stringify({ numPlayers: 5 }), Date.now());
            return { id: 'engine-game' };
          },
          joinGame: () => { engineCalls.joinGame++; return { success: true }; },
          startGame: () => { engineCalls.startGame++; return { success: true }; },
        } as unknown as GameEngine,
        agentCoordinator: agentCoord,
        eventBus,
        statsCollector: stats,
        gameRepository: repo as any,
      });

      const result = runner.start({ models: ['a', 'b'], gamesPerPairing: 1, numPlayers: 5 });

      expect(result.totalGames).toBe(1);
      expect(engineCalls.createGame).toBe(1);
      expect(engineCalls.joinGame).toBe(5);
      expect(engineCalls.startGame).toBe(1);
    });
  });

  // ==========================================================================
  // Run completion via terminal events (MAF-GAP-011)
  // ==========================================================================

  describe('run completion', () => {
    it('marks the run COMPLETED when every game fires WINNER_DETERMINED', () => {
      const legacyAdapter = createFakeLegacyGameAdapter(repo as any);
      runner = new BenchmarkRunner({
        gameEngine: {} as GameEngine,
        agentCoordinator: agentCoord,
        eventBus,
        statsCollector: stats,
        gameRepository: repo as any,
        legacyAdapter,
      });

      const result = runner.start({ models: ['a', 'b'], gamesPerPairing: 2, numPlayers: 5 });
      expect(result.totalGames).toBe(2);
      expect(runner.getStatus(result.runId)!.status).toBe('RUNNING');

      for (const started of legacyAdapter.started) {
        eventBus.publish(terminalEvent(started.gameId, 'WINNER_DETERMINED', 'MAFIA'));
      }

      const status = runner.getStatus(result.runId)!;
      expect(status.status).toBe('COMPLETED');
      expect(status.completedAt).not.toBeNull();
      const progress = runner.getProgress(result.runId)!;
      expect(progress.completedGames).toBe(2);
      expect(progress.validGames).toBe(2);
    });

    it('marks the run COMPLETED when legacy games fire GAME_ENDED (legacy terminal event)', () => {
      const legacyAdapter = createFakeLegacyGameAdapter(repo as any);
      runner = new BenchmarkRunner({
        gameEngine: {} as GameEngine,
        agentCoordinator: agentCoord,
        eventBus,
        statsCollector: stats,
        gameRepository: repo as any,
        legacyAdapter,
      });

      const result = runner.start({ models: ['a', 'b'], gamesPerPairing: 1, numPlayers: 5 });
      expect(result.totalGames).toBe(1);

      // The legacy engine's terminal STATE_CHANGE is remapped to GAME_ENDED
      // by LegacyGameAdapter (MAF-GAP-005); the runner must react to it.
      eventBus.publish(terminalEvent(legacyAdapter.started[0].gameId, 'GAME_ENDED', 'TOWN'));

      const status = runner.getStatus(result.runId)!;
      expect(status.status).toBe('COMPLETED');
      const row = (repo as any).db
        .prepare('SELECT winner, completed_at FROM benchmark_games WHERE game_id = ?')
        .get(legacyAdapter.started[0].gameId) as any;
      expect(row.winner).toBe('TOWN');
      expect(row.completed_at).not.toBeNull();
    });

    it('stays RUNNING until every game has completed', () => {
      const legacyAdapter = createFakeLegacyGameAdapter(repo as any);
      runner = new BenchmarkRunner({
        gameEngine: {} as GameEngine,
        agentCoordinator: agentCoord,
        eventBus,
        statsCollector: stats,
        gameRepository: repo as any,
        legacyAdapter,
      });

      const result = runner.start({ models: ['a', 'b'], gamesPerPairing: 2, numPlayers: 5 });
      expect(result.totalGames).toBe(2);

      // Only the first game completes.
      eventBus.publish(terminalEvent(legacyAdapter.started[0].gameId, 'GAME_ENDED', 'MAFIA'));

      const status = runner.getStatus(result.runId)!;
      expect(status.status).toBe('RUNNING');
      expect(runner.getProgress(result.runId)!.completedGames).toBe(1);

      // Second game completes -> run completes.
      eventBus.publish(terminalEvent(legacyAdapter.started[1].gameId, 'GAME_ENDED', 'TOWN'));
      expect(runner.getStatus(result.runId)!.status).toBe('COMPLETED');
    });

    it('records the winner from the first terminal event only (idempotent)', () => {
      const legacyAdapter = createFakeLegacyGameAdapter(repo as any);
      runner = new BenchmarkRunner({
        gameEngine: {} as GameEngine,
        agentCoordinator: agentCoord,
        eventBus,
        statsCollector: stats,
        gameRepository: repo as any,
        legacyAdapter,
      });

      const result = runner.start({ models: ['a', 'b'], gamesPerPairing: 1, numPlayers: 5 });
      const gameId = legacyAdapter.started[0].gameId;

      eventBus.publish(terminalEvent(gameId, 'GAME_ENDED', 'MAFIA'));
      // A duplicate terminal event (e.g. WINNER_DETERMINED arriving after
      // GAME_ENDED) must not overwrite the recorded result.
      eventBus.publish(terminalEvent(gameId, 'WINNER_DETERMINED', 'TOWN'));

      const row = (repo as any).db
        .prepare('SELECT winner FROM benchmark_games WHERE game_id = ?')
        .get(gameId) as any;
      expect(row.winner).toBe('MAFIA');
      expect(runner.getStatus(result.runId)!.status).toBe('COMPLETED');
    });
  });

  // ==========================================================================
  // Model spec parsing / role-model attribution (MAF-GAP-057)
  //
  // Live bug (run d7647a7c, game d988b26f): the CLI documents slash specs
  // ('openai/gpt-4o-mini,openai/gpt-4o') but parseModel only understood
  // "provider:model", so slash specs became ['CUSTOM', 'openai/gpt-4o'] and
  // were re-joined into 'CUSTOM/openai/gpt-4o'. Every downstream split('/')
  // truncated that to provider='CUSTOM' + model='openai': token_usage /
  // api_calls / player_model_assignments recorded the SECOND model under a
  // phantom bare 'openai' name, and the engine sent the invalid wire id
  // 'CUSTOM/openai' to OpenRouter.
  // ==========================================================================

  describe('slash-format model specs (MAF-GAP-057)', () => {
    it('passes slash specs through verbatim as legacy roleModels (no CUSTOM double prefix)', () => {
      const legacyAdapter = createFakeLegacyGameAdapter(repo as any);
      runner = new BenchmarkRunner({
        gameEngine: {} as GameEngine,
        agentCoordinator: agentCoord,
        eventBus,
        statsCollector: stats,
        gameRepository: repo as any,
        legacyAdapter,
      });

      // Exactly the CLI's DEFAULT_MODELS pair.
      runner.start({
        models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
        gamesPerPairing: 1,
        numPlayers: 5,
      });

      expect(legacyAdapter.started).toHaveLength(1);
      expect(legacyAdapter.started[0].config.roleModels).toEqual({
        MAFIA: 'openai/gpt-4o-mini',
        SHERIFF: 'openai/gpt-4o-mini',
        TOWN: 'openai/gpt-4o',
        DOCTOR: 'openai/gpt-4o',
      });
    });

    it('keeps colon specs on the historical rebuild spelling', () => {
      const legacyAdapter = createFakeLegacyGameAdapter(repo as any);
      runner = new BenchmarkRunner({
        gameEngine: {} as GameEngine,
        agentCoordinator: agentCoord,
        eventBus,
        statsCollector: stats,
        gameRepository: repo as any,
        legacyAdapter,
      });

      runner.start({ models: ['openrouter:model-a', 'openrouter:model-b'], gamesPerPairing: 1, numPlayers: 5 });

      expect(legacyAdapter.started[0].config.roleModels).toEqual({
        MAFIA: 'OPENROUTER/model-a',
        SHERIFF: 'OPENROUTER/model-a',
        TOWN: 'OPENROUTER/model-b',
        DOCTOR: 'OPENROUTER/model-b',
      });
    });
  });

  // ==========================================================================
  // Startup reconciliation of stranded runs (QA-MAFIA-AI-BENCHMARK-2)
  //
  // Live finding: benchmark_runs marked RUNNING (or left QUEUED) survive a
  // server restart forever, because the only thing that ever flips them to a
  // terminal status is the in-process EventBus subscription installed by
  // launchGame(). After a restart those subscriptions are gone and there is
  // no way to re-attach (the engine has no durable claim of ownership), so
  // the rows stay RUNNING forever.
  //
  // Policy (durable DB evidence only — never process state):
  //   - every benchmark_games row has completed_at or error  -> the run's
  //     games all reached a terminal state, so the run is COMPLETED (or
  //     FAILED when at least one game recorded an error) and completed_at /
  //     summary are persisted;
  //   - every game is terminal AND at least one game recorded an error ->
  //     FAILED;
  //   - any non-terminal game row remains -> the run may genuinely still be
  //     in flight, so it stays untouched (RUNNING stays RUNNING, QUEUED
  //     stays QUEUED).
  // ==========================================================================

  describe('run recovery (reconcileStrandedRuns)', () => {
    /**
     * Seed one stranded run with the given games.
     * `created_at` defaults to "now" so seeded non-terminal runs are FRESH
     * (inside the max-age window); stale-run tests pass an old timestamp
     * explicitly.
     */
    function seedStrandedRun(
      runId: string,
      status: 'QUEUED' | 'RUNNING',
      games: Array<{
        game_id: string;
        completed_at?: number | null;
        error?: string | null;
        winner?: string | null;
      }>,
      createdAt: number = Date.now(),
    ): void {
      repo.insertBenchmarkRun({
        id: runId,
        config: { models: ['openai/model-a', 'openai/model-b'], gamesPerPairing: games.length, numPlayers: 10 },
        status,
        created_at: createdAt,
      });
      for (const g of games) {
        // benchmark_games.game_id has a FK to games.id — create the parent
        // game row first (a benchmark game IS a game in the games table).
        (repo as any).db
          .prepare(
            `INSERT OR IGNORE INTO games (id, status, config, created_at, started_at, ended_at, winner)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            g.game_id,
            g.completed_at || g.error ? 'ENDED' : 'IN_PROGRESS',
            JSON.stringify({ numPlayers: 10 }),
            1_700_000_000_000,
            1_700_000_000_000,
            g.completed_at ?? null,
            g.winner ?? null,
          );
        repo.insertBenchmarkGame({
          game_id: g.game_id,
          run_id: runId,
          pairing_id: 'openai/model-a__vs__openai/model-b',
          model_a: 'openai/model-a',
          model_b: 'openai/model-b',
          seed: 0,
          model_a_role: 'VILLAGER',
          model_b_role: 'VILLAGER',
          winner: g.winner ?? null,
          completed_at: g.completed_at ?? null,
        });
        if (g.error) {
          // The mock insert helper has no error column, so set it directly —
          // same table the production runner reads.
          (repo as any).db
            .prepare('UPDATE benchmark_games SET error = ? WHERE game_id = ?')
            .run(g.error, g.game_id);
        }
      }
    }

    it('marks a RUNNING run with every game terminal as COMPLETED', () => {
      seedStrandedRun('run-all-done', 'RUNNING', [
        { game_id: 'g-done-1', completed_at: 1_700_000_100_000, winner: 'MAFIA' },
        { game_id: 'g-done-2', completed_at: 1_700_000_200_000, winner: 'TOWN' },
      ]);

      const summary = runner.reconcileStrandedRuns();

      expect(summary.reconciled).toBe(1);
      const status = runner.getStatus('run-all-done')!;
      expect(status.status).toBe('COMPLETED');
      expect(status.completedAt).not.toBeNull();
      // Summary is persisted from durable game evidence.
      expect(status.summary).toMatchObject({ totalGames: 2, completedGames: 2, failedGames: 0 });
    });

    it('also reconciles a stranded QUEUED run whose games are all terminal', () => {
      seedStrandedRun('run-queued-done', 'QUEUED', [
        { game_id: 'g-q-done', completed_at: 1_700_000_050_000, winner: 'TOWN' },
      ]);

      const summary = runner.reconcileStrandedRuns();

      expect(summary.reconciled).toBe(1);
      expect(runner.getStatus('run-queued-done')!.status).toBe('COMPLETED');
    });

    it('marks a run with a terminal error evidence as FAILED and persists the error', () => {
      seedStrandedRun('run-failed', 'RUNNING', [
        { game_id: 'g-fail-1', completed_at: 1_700_000_100_000, winner: 'MAFIA' },
        { game_id: 'g-fail-2', error: 'provider exploded' },
      ]);

      const summary = runner.reconcileStrandedRuns();

      expect(summary.reconciled).toBe(1);
      const status = runner.getStatus('run-failed')!;
      expect(status.status).toBe('FAILED');
      expect(status.completedAt).not.toBeNull();
      expect(status.error).toContain('provider exploded');
      expect(status.summary).toMatchObject({ totalGames: 2, completedGames: 1, failedGames: 1 });
    });

    it('leaves a run with an unfinished game untouched (genuinely active)', () => {
      // FRESH run (created_at defaults to now): inside the max-age window,
      // so the non-terminal shape keeps the leave-active behavior.
      seedStrandedRun('run-active', 'RUNNING', [
        { game_id: 'g-done', completed_at: 1_700_000_100_000, winner: 'MAFIA' },
        { game_id: 'g-live', completed_at: null },
      ]);

      const summary = runner.reconcileStrandedRuns();

      expect(summary.reconciled).toBe(0);
      expect(summary.staleFailed).toBe(0);
      expect(summary.leftActive).toBe(1);
      const status = runner.getStatus('run-active')!;
      expect(status.status).toBe('RUNNING');
      expect(status.completedAt).toBeNull();
      expect(status.summary).toBeNull();
    });

    // =========================================================================
    // Stale-run sweep (DF-MAFIA-AI-BENCHMARK-15): a non-terminal run with no
    // terminal game evidence is abandoned once it ages past STALE_RUN_MAX_MS
    // — the restart killed the only writer that could ever finish its games.
    // =========================================================================

    it('flips a stale RUNNING run with no live game evidence to FAILED with a reason', () => {
      // Older than STALE_RUN_MAX_MS, and its unfinished game row can never
      // gain terminal evidence (the writing subscription died with the old
      // process) — the durable-evidence reconcile leaves it, the age sweep
      // retires it.
      seedStrandedRun(
        'run-stale',
        'RUNNING',
        [
          { game_id: 'g-stale-done', completed_at: 1_700_000_100_000, winner: 'MAFIA' },
          { game_id: 'g-stale-live', completed_at: null },
        ],
        Date.now() - (STALE_RUN_MAX_MS + 60_000),
      );

      const summary = runner.reconcileStrandedRuns();

      expect(summary.reconciled).toBe(0);
      expect(summary.staleFailed).toBe(1);
      expect(summary.leftActive).toBe(0);
      const status = runner.getStatus('run-stale')!;
      expect(status.status).toBe('FAILED');
      expect(status.error).toContain('abandoned');
      expect(status.completedAt).not.toBeNull();
    });

    it('leaves a fresh RUNNING run with an unfinished game active (inside the max-age window)', () => {
      seedStrandedRun('run-fresh', 'RUNNING', [
        { game_id: 'g-fresh-live', completed_at: null },
      ]);

      const summary = runner.reconcileStrandedRuns();

      expect(summary.reconciled).toBe(0);
      expect(summary.staleFailed).toBe(0);
      expect(summary.leftActive).toBe(1);
      const status = runner.getStatus('run-fresh')!;
      expect(status.status).toBe('RUNNING');
      expect(status.error).toBeNull();
      expect(status.completedAt).toBeNull();
    });

    it('is idempotent for the stale sweep: a second pass does not re-flip or double-count', () => {
      seedStrandedRun(
        'run-stale-once',
        'RUNNING',
        [{ game_id: 'g-stale-once', completed_at: null }],
        Date.now() - (STALE_RUN_MAX_MS + 60_000),
      );

      const first = runner.reconcileStrandedRuns();
      expect(first.staleFailed).toBe(1);
      const statusAfterFirst = runner.getStatus('run-stale-once')!;
      expect(statusAfterFirst.status).toBe('FAILED');
      const errorAfterFirst = statusAfterFirst.error;

      const second = runner.reconcileStrandedRuns();
      expect(second.staleFailed).toBe(0);
      expect(second.inspected).toBe(0);
      expect(second.reconciled).toBe(0);
      const statusAfterSecond = runner.getStatus('run-stale-once')!;
      expect(statusAfterSecond.status).toBe('FAILED');
      expect(statusAfterSecond.error).toBe(errorAfterFirst);
    });

    it('terminal evidence wins over age: a stale run whose games are all terminal still recovers COMPLETED', () => {
      seedStrandedRun(
        'run-stale-terminal',
        'RUNNING',
        [{ game_id: 'g-stale-done', completed_at: 1_700_000_100_000, winner: 'TOWN' }],
        Date.now() - (STALE_RUN_MAX_MS + 60_000),
      );

      const summary = runner.reconcileStrandedRuns();

      expect(summary.reconciled).toBe(1);
      expect(summary.staleFailed).toBe(0);
      expect(runner.getStatus('run-stale-terminal')!.status).toBe('COMPLETED');
    });

    it('is idempotent: reconciling twice reconciles nothing new', () => {
      seedStrandedRun('run-once', 'RUNNING', [
        { game_id: 'g-once', completed_at: 1_700_000_100_000, winner: 'TOWN' },
      ]);

      const first = runner.reconcileStrandedRuns();
      expect(first.reconciled).toBe(1);

      const second = runner.reconcileStrandedRuns();
      expect(second.reconciled).toBe(0);
      expect(runner.getStatus('run-once')!.status).toBe('COMPLETED');
    });

    it('ignores runs that are already terminal', () => {
      seedStrandedRun('run-already', 'RUNNING', [
        { game_id: 'g-already', completed_at: 1_700_000_100_000, winner: 'TOWN' },
      ]);
      (repo as any).db
        .prepare("UPDATE benchmark_runs SET status = 'CANCELLED' WHERE id = 'run-already'")
        .run();

      const summary = runner.reconcileStrandedRuns();
      expect(summary.reconciled).toBe(0);
      expect(runner.getStatus('run-already')!.status).toBe('CANCELLED');
    });
  });
});
