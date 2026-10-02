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
  // benchmark_runs.summary persistence (DF-MAFIA-AI-BENCHMARK-28)
  //
  // Live defect: every run row (all 239 COMPLETED in the production DB) had
  // summary NULL — the run record a user or API consumer reads for "what
  // happened in this run" was empty. The terminal transition (event-driven
  // maybeCompleteRun and the restart reconcile path) must persist the
  // summary payload built from the run's own game evidence.
  // ==========================================================================

  describe('run summary persistence (DF-MAFIA-AI-BENCHMARK-28)', () => {
    function runnerWithAdapter(): { runner: BenchmarkRunner; adapter: ReturnType<typeof createFakeLegacyGameAdapter> } {
      const adapter = createFakeLegacyGameAdapter(repo as any);
      runner = new BenchmarkRunner({
        gameEngine: {} as GameEngine,
        agentCoordinator: agentCoord,
        eventBus,
        statsCollector: stats,
        gameRepository: repo as any,
        legacyAdapter: adapter,
      });
      return { runner, adapter };
    }

    function rawSummary(runId: string): Record<string, unknown> {
      const row = (repo as any).db
        .prepare('SELECT summary FROM benchmark_runs WHERE id = ?')
        .get(runId) as { summary: string | null };
      // A COMPLETED run must carry a NON-NULL summary — the defect this
      // suite pins (NULL on every run incl. fresh COMPLETED ones).
      expect(row.summary).not.toBeNull();
      return JSON.parse(row.summary as string);
    }

    it('persists a non-NULL summary when the run completes (the pinned NULL defect)', () => {
      const { runner: r, adapter } = runnerWithAdapter();
      const result = r.start({ models: ['openai/gpt-4o-mini', 'openai/gpt-4o'], gamesPerPairing: 2, numPlayers: 5 });
      expect(result.totalGames).toBe(2);
      expect(r.getStatus(result.runId)!.summary).toBeNull(); // while running

      for (const started of adapter.started) {
        eventBus.publish(terminalEvent(started.gameId, 'WINNER_DETERMINED', 'MAFIA'));
      }

      const summary = rawSummary(result.runId);
      expect(summary.totalGames).toBe(2);
      expect(summary.completedGames).toBe(2);
      expect(summary.failedGames).toBe(0);
      expect(r.getStatus(result.runId)!.summary).toMatchObject({
        totalGames: 2,
        completedGames: 2,
        failedGames: 0,
      });
    });

    it('persists a summary on the FAILED terminal transition too', () => {
      const { runner: r, adapter } = runnerWithAdapter();
      const result = r.start({ models: ['a', 'b'], gamesPerPairing: 2, numPlayers: 5 });
      // One game completes normally, the other errors: the run is FAILED.
      eventBus.publish(terminalEvent(adapter.started[0].gameId, 'GAME_ENDED', 'TOWN'));
      (repo as any).db
        .prepare('UPDATE benchmark_games SET error = ? WHERE game_id = ?')
        .run('boom', adapter.started[1].gameId);
      // The error path reaches the run via the same allDone predicate.
      (runner as any).maybeCompleteRun(result.runId);

      const status = r.getStatus(result.runId)!;
      expect(status.status).toBe('FAILED');
      const summary = rawSummary(result.runId);
      expect(summary.failedGames).toBe(1);
      expect(summary.completedGames).toBe(1);
      // The failed game's evidence is in the summary.
      expect(String(summary.errorSummary)).toContain('boom');
    });

    it('folds the run-scoped verdict (pairings/modelPerformance) into a COMPLETED summary', () => {
      const { runner: r, adapter } = runnerWithAdapter();
      const result = r.start({
        models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
        gamesPerPairing: 2,
        numPlayers: 5,
      });
      // Real player rows with won/is_mafia: game 1 -> TOWN wins (model B
      // = 4o plays town per the fake adapter's role split; game 2 ->
      // MAFIA wins (model A = mini). Seed the players rows the adapter
      // path leaves absent — the run report reads players.
      for (let i = 0; i < adapter.started.length; i++) {
        const gameId = adapter.started[i].gameId;
        repo.seedGame({ id: gameId, status: 'ENDED', winner: i === 0 ? 'TOWN' : 'MAFIA' });
        // 5 players: model A (mini) 1 mafia + sheriff; model B (4o) town side.
        const players = [
          { id: `p1-${i}`, name: 'M1', role: 'MAFIA', isMafia: true, joinOrder: 0, provider: 'openai', model: i === 0 ? 'openai/gpt-4o-mini' : 'openai/gpt-4o-mini' },
          { id: `p2-${i}`, name: 'M2', role: 'SHERIFF', isMafia: false, joinOrder: 1, provider: 'openai', model: i === 0 ? 'openai/gpt-4o-mini' : 'openai/gpt-4o-mini' },
          { id: `p3-${i}`, name: 'M3', role: 'TOWN', isMafia: false, joinOrder: 2, provider: 'openai', model: 'openai/gpt-4o' },
          { id: `p4-${i}`, name: 'M4', role: 'DOCTOR', isMafia: false, joinOrder: 3, provider: 'openai', model: 'openai/gpt-4o' },
          { id: `p5-${i}`, name: 'M5', role: 'VILLAGER', isMafia: false, joinOrder: 4, provider: 'openai', model: 'openai/gpt-4o' },
        ];
        const winner = i === 0 ? 'TOWN' : 'MAFIA';
        for (const pl of players) {
          const won = winner === 'MAFIA' ? pl.isMafia : !pl.isMafia;
          (repo as any).db
            .prepare(
              `INSERT INTO players (id, game_id, name, role, is_mafia, is_alive, join_order, provider, model, won)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
            )
            .run(pl.id, gameId, pl.name, pl.role, pl.isMafia ? 1 : 0, pl.joinOrder, pl.provider, pl.model, won ? 1 : 0);
        }
        eventBus.publish(terminalEvent(gameId, 'WINNER_DETERMINED', winner));
      }

      const summary = rawSummary(result.runId);
      // The pairings block is present with decided winner counts.
      const pairings = summary.pairings as Array<{ modelA: string; modelB: string; aWins: number; bWins: number; games: number }>;
      expect(Array.isArray(pairings)).toBe(true);
      expect(pairings).toHaveLength(1);
      expect(pairings[0].games).toBe(2);
      expect(pairings[0].aWins + pairings[0].bWins).toBe(2);
      // The per-model rows carry real win attribution from players.won.
      const models = summary.modelPerformance as Array<{ model: string; wins: number; gamesPlayed: number }>;
      expect(models.length).toBeGreaterThanOrEqual(2);

      expect(runner.getStatus(result.runId)!.status).toBe('COMPLETED');
    });

    it('an unattributed COMPLETED run still carries a non-NULL summary (honest zero wins)', () => {
      const { runner: r, adapter } = runnerWithAdapter();
      const result = r.start({ models: ['a', 'b'], gamesPerPairing: 1, numPlayers: 5 });
      // Terminal events with side winners but NO players rows (legacy
      // usage-only games): no model attribution exists, the summary must
      // still be persisted (non-NULL contract) with honest zero counts.
      eventBus.publish(terminalEvent(adapter.started[0].gameId, 'GAME_ENDED', 'TOWN'));

      const summary = rawSummary(result.runId);
      expect(summary.totalGames).toBe(1);
      expect(summary.completedGames).toBe(1);
      expect(r.getStatus(result.runId)!.status).toBe('COMPLETED');
    });

    it('the reconcile recovery path persists the same summary shape', () => {
      const { runner: r } = runnerWithAdapter();
      // Seed a stranded RUNNING run with all-terminal games directly.
      // benchmark_games.game_id FK-references games(id) — the real rows.
      repo.insertBenchmarkRun({ id: 'run-recovered', config: { models: ['a', 'b'] }, status: 'RUNNING', created_at: Date.now() - STALE_RUN_MAX_MS });
      repo.seedGame({ id: 'g-r1', status: 'ENDED', winner: 'TOWN' });
      repo.seedGame({ id: 'g-r2', status: 'ENDED', winner: 'MAFIA' });
      repo.insertBenchmarkGame({ game_id: 'g-r1', run_id: 'run-recovered', pairing_id: 'a__vs__b', model_a: 'a', model_b: 'b', seed: 0, model_a_role: 'VILLAGER', model_b_role: 'VILLAGER', completed_at: Date.now(), winner: 'TOWN' });
      repo.insertBenchmarkGame({ game_id: 'g-r2', run_id: 'run-recovered', pairing_id: 'a__vs__b', model_a: 'a', model_b: 'b', seed: 1, model_a_role: 'VILLAGER', model_b_role: 'VILLAGER', completed_at: Date.now(), winner: 'MAFIA' });

      const reconcile = r.reconcileStrandedRuns();
      expect(reconcile.reconciled).toBe(1);
      const status = r.getStatus('run-recovered')!;
      expect(status.status).toBe('COMPLETED');
      expect(status.summary).toMatchObject({ totalGames: 2, completedGames: 2, failedGames: 0 });
    });
  });

  // ==========================================================================
  // Run-scoped report (DF-MAFIA-AI-BENCHMARK-28): getRunReport()
  //
  // The CLI's verdict must be about THIS run — getRunReport reads only the
  // run's own benchmark_games + players rows.
  // ==========================================================================

  describe('getRunReport (DF-MAFIA-AI-BENCHMARK-28)', () => {
    function runnerWithAdapter(): { runner: BenchmarkRunner; adapter: ReturnType<typeof createFakeLegacyGameAdapter> } {
      const adapter = createFakeLegacyGameAdapter(repo as any);
      runner = new BenchmarkRunner({
        gameEngine: {} as GameEngine,
        agentCoordinator: agentCoord,
        eventBus,
        statsCollector: stats,
        gameRepository: repo as any,
        legacyAdapter: adapter,
      });
      return { runner, adapter };
    }

    /**
     * Seed players rows for a completed game (the fake legacy adapter path
     * leaves no players rows). `modelAMafia` controls which side model
     * A's players sit on in THIS game — the winner attribution must come
     * from the rows, never a fixed role split. The games row is seeded
     * ENDED with duration above the degenerate window and 2 non-empty
     * SAYS broadcasts + a GAME_OVER event so the degenerate/mock
     * exclusions (DF-18/DF-12) keep the game usable.
     */
    function seedGameWithPlayers(
      repo2: ReturnType<typeof createSqliteBackedRepository>,
      gameId: string,
      gameIndex: number,
      modelAMafia: boolean,
      modelAWinsThisGame: boolean,
    ) {
      const modelA = 'openai/gpt-4o-mini';
      const modelB = 'openai/gpt-4o';
      const now = Date.now();
      repo2.seedGame({
        id: gameId,
        status: 'ENDED',
        winner: modelAWinsThisGame ? (modelAMafia ? 'MAFIA' : 'TOWN') : (modelAMafia ? 'TOWN' : 'MAFIA'),
        endedAt: now,
        duration: 200_000,
        events: [
          { type: 'AGENT_SAYS_BROADCASTED', data: { says: 'seeding the say-quality gate' } },
          { type: 'AGENT_SAYS_BROADCASTED', data: { says: 'second broadcast' } },
          { type: 'GAME_ENDED' as never, data: { winner: modelAWinsThisGame ? (modelAMafia ? 'MAFIA' : 'TOWN') : (modelAMafia ? 'TOWN' : 'MAFIA') } },
        ],
        players: [
          { id: `pa-${gameIndex}`, name: `PA${gameIndex}`, role: 'MAFIA', isMafia: modelAMafia, joinOrder: 0, provider: 'openai', model: modelA, won: modelAWinsThisGame ? 1 : 0 },
          { id: `pb-${gameIndex}`, name: `PB${gameIndex}`, role: 'VILLAGER', isMafia: !modelAMafia, joinOrder: 1, provider: 'openai', model: modelB, won: modelAWinsThisGame ? 0 : 1 },
        ],
      });
    }

    it('returns null for an unknown run', () => {
      expect(runner.getRunReport('nope')).toBeNull();
    });

    it('derives the winner from the run played (2 games, both won by the same model)', () => {
      const { runner: r, adapter } = runnerWithAdapter();
      const result = r.start({
        models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
        gamesPerPairing: 2,
        numPlayers: 5,
      });
      const db = (repo as any).db;
      // Game 0: model B (4o) wins as TOWN. Game 1: model B wins as TOWN.
      for (let i = 0; i < 2; i++) {
        const gameId = adapter.started[i].gameId;
        seedGameWithPlayers(repo, gameId, i, true, false);
        eventBus.publish(terminalEvent(gameId, 'WINNER_DETERMINED', 'TOWN'));
      }

      const report = r.getRunReport(result.runId)!;
      expect(report).not.toBeNull();
      expect(report.runId).toBe(result.runId);
      expect(report.summary).toMatchObject({ totalGames: 2, completedGames: 2, gamesWithWinner: 2 });

      // Per-model rows: ONLY this run's games — 2 games for each model, 2
      // wins for 4o, 0 for mini (a model playing 1 player slot per game is
      // still one win per game).
      const mini = report.modelPerformance.find((m) => m.model === 'gpt-4o-mini');
      const fourO = report.modelPerformance.find((m) => m.model === 'gpt-4o');
      expect(mini).toBeDefined();
      expect(fourO).toBeDefined();
      expect(mini!.gamesPlayed).toBe(2);
      expect(fourO!.gamesPlayed).toBe(2);
      expect(fourO!.wins).toBe(2);
      expect(mini!.wins).toBe(0);
      expect(fourO!.winRate).toBe(1);
      expect(mini!.winRate).toBe(0);

      // The pairing block: bWins 2, aWins 0.
      expect(report.pairings).toHaveLength(1);
      expect(report.pairings[0]).toMatchObject({ aWins: 0, bWins: 2, unattributed: 0 });
    });

    it('MOCK-flagged games are excluded from win attribution (DF-12 parity)', () => {
      const { runner: r, adapter } = runnerWithAdapter();
      const result = r.start({
        models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
        gamesPerPairing: 1,
        numPlayers: 5,
      });
      const gameId = adapter.started[0].gameId;
      // A completed, winner-carrying game the adapter flagged MOCK (every
      // provider call fell back to the canned mock — no real win evidence).
      // NOTE: the fake adapter already INSERTed the games row (IN_PROGRESS),
      // and seedGame INSERT OR IGNOREs — so UPDATE the row to its ENDED
      // completed state directly.
      const db = (repo as any).db;
      db.prepare(
        `UPDATE games
            SET status = 'ENDED', winner = 'TOWN', ended_at = ?, duration = ?
          WHERE id = ?`,
      )
        .run(Date.now(), 200_000, gameId);
      db.prepare(
        `INSERT OR REPLACE INTO players (id, game_id, name, role, is_alive, is_mafia, join_order, agent_id, provider, model, survived, won, tokens_used, role_performance)
         VALUES ('pa-m', ?, 'PA', 'MAFIA', 1, 1, 0, 'pa-m', 'openai', 'openai/gpt-4o-mini', NULL, 0, 0, 0)`,
      ).run(gameId);
      db.prepare(
        `INSERT OR REPLACE INTO players (id, game_id, name, role, is_alive, is_mafia, join_order, agent_id, provider, model, survived, won, tokens_used, role_performance)
         VALUES ('pb-m', ?, 'PB', 'VILLAGER', 1, 0, 1, 'pb-m', 'openai', 'openai/gpt-4o', NULL, 1, 0, 0)`,
      ).run(gameId);
      db.prepare(`UPDATE games SET config = json_set(config, '$.mock', 1) WHERE id = ?`).run(gameId);
      eventBus.publish(terminalEvent(gameId, 'WINNER_DETERMINED', 'TOWN'));
      // The seed really took: the row IS ended + mocked now.
      const grown = db.prepare('SELECT status, duration FROM games WHERE id = ?').get(gameId) as any;
      expect(grown.status).toBe('ENDED');
      expect(grown.duration).toBe(200_000);

      const report = r.getRunReport(result.runId)!;
      // The mock game is PLAYED (gamesPlayed 1) but its side outcome is
      // NOT attributed: wins stay 0, losses stay null — same exclusion the
      // global aggregates apply (DF-MAFIA-AI-BENCHMARK-12).
      const mini = report.modelPerformance.find((m) => m.model === 'gpt-4o-mini')!;
      const fourO = report.modelPerformance.find((m) => m.model === 'gpt-4o')!;
      expect(mini.gamesPlayed).toBe(1);
      expect(fourO.gamesPlayed).toBe(1);
      expect(mini.wins).toBe(0);
      expect(fourO.wins).toBe(0);
      expect(mini.losses).toBeNull();
      expect(fourO.losses).toBeNull();
      expect(report.summary.gamesWithWinner).toBe(1); // the row has a winner...
      // ...but a MOCK winner is unusable: the pairing counts the game as
      // unattributed (never a side win) — the usable gate governs aWins/
      // bWins exactly like the per-model wins.
      expect(report.pairings[0].aWins).toBe(0);
      expect(report.pairings[0].bWins).toBe(0);
      expect(report.pairings[0].unattributed).toBe(1);
      expect(r.getStatus(result.runId)!.status).toBe('COMPLETED');
    });

    it('attributes the winner from the players rows even when the side winner flips per game', () => {
      const { runner: r, adapter } = runnerWithAdapter();
      const result = r.start({
        models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
        gamesPerPairing: 2,
        numPlayers: 5,
      });
      const db = (repo as any).db;
      // Game 0: MAFIA wins and the mafia player is model B (4o) — B wins.
      // Game 1: MAFIA wins and the mafia player is model A (mini) — A wins.
      const sides = [false, true]; // modelAMafia
      for (let i = 0; i < 2; i++) {
        const gameId = adapter.started[i].gameId;
        seedGameWithPlayers(repo, gameId, i, sides[i], true);
        eventBus.publish(terminalEvent(gameId, 'WINNER_DETERMINED', 'MAFIA'));
      }

      const report = r.getRunReport(result.runId)!;
      const mini = report.modelPerformance.find((m) => m.model === 'gpt-4o-mini')!;
      const fourO = report.modelPerformance.find((m) => m.model === 'gpt-4o')!;
      expect(mini.wins).toBe(1);
      expect(fourO.wins).toBe(1);
      expect(report.pairings[0]).toMatchObject({ aWins: 1, bWins: 1, unattributed: 0 });
    });

    it('counts a game with NO decided winner as played but unattributable', () => {
      const { runner: r, adapter } = runnerWithAdapter();
      const result = r.start({
        models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
        gamesPerPairing: 1,
        numPlayers: 5,
      });
      const gameId = adapter.started[0].gameId;
      // Players rows exist but won is unwritten (NULL — setPlayersWon never
      // ran, the legacy usage-only shape): no model attribution exists.
      repo.seedGame({
        id: gameId,
        status: 'ENDED',
        endedAt: Date.now(),
        duration: 200_000,
        events: [{ type: 'AGENT_SAYS_BROADCASTED', data: { says: 'unfinished game' } }],
        players: [
          { id: 'pa-u', name: 'PA', role: 'MAFIA', isMafia: true, joinOrder: 0, provider: 'openai', model: 'openai/gpt-4o-mini' },
          { id: 'pb-u', name: 'PB', role: 'VILLAGER', isMafia: false, joinOrder: 1, provider: 'openai', model: 'openai/gpt-4o' },
        ],
      });
      eventBus.publish(terminalEvent(gameId, 'GAME_ENDED', 'UNKNOWN'));

      const report = r.getRunReport(result.runId)!;
      expect(report.summary.gamesWithWinner).toBe(0);
      expect(report.modelPerformance.every((m) => m.wins === 0 && m.losses === null)).toBe(true);
      expect(report.pairings[0]).toMatchObject({ aWins: 0, bWins: 0 });
      expect(report.pairings[0].unattributed).toBe(1);
    });

    it('normalizes a prefixed model row so one real model stays one row', () => {
      const { runner: r, adapter } = runnerWithAdapter();
      const result = r.start({
        models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
        gamesPerPairing: 1,
        numPlayers: 5,
      });
      const gameId = adapter.started[0].gameId;
      // Mixed spellings for the SAME real model: 'openai' + bare
      // 'gpt-4o-mini' and 'OPENAI' + prefixed 'openai/gpt-4o-mini' — the
      // legacy split-brain shape (MAF-GAP-036/045). One canonical row,
      // not two, and one win per game despite 2 player rows.
      repo.seedGame({
        id: gameId,
        status: 'ENDED',
        winner: 'TOWN',
        endedAt: Date.now(),
        duration: 200_000,
        events: [{ type: 'AGENT_SAYS_BROADCASTED', data: { says: 'normalize check' } }],
        players: [
          { id: 'px', name: 'P1', role: 'MAFIA', isMafia: true, joinOrder: 0, provider: 'openai', model: 'gpt-4o-mini', won: 0 },
          { id: 'py', name: 'P2', role: 'TOWN', isMafia: false, joinOrder: 1, provider: 'OPENAI', model: 'openai/gpt-4o-mini', won: 1 },
        ],
      });
      eventBus.publish(terminalEvent(gameId, 'WINNER_DETERMINED', 'TOWN'));

      const report = r.getRunReport(result.runId)!;
      const miniRows = report.modelPerformance.filter((m) => m.model === 'gpt-4o-mini');
      expect(miniRows).toHaveLength(1);
      expect(miniRows[0].gamesPlayed).toBe(1);
      expect(miniRows[0].wins).toBe(1);
      // One win per game despite 2 player slots: the win is the GAME's.
      expect(miniRows[0].losses).toBe(0);
    });

    it('a 0-win model with any winner present reports real losses; all-zero runs report null losses', () => {
      const { runner: r, adapter } = runnerWithAdapter();
      const result = r.start({
        models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
        gamesPerPairing: 2,
        numPlayers: 5,
      });
      const db = (repo as any).db;
      for (let i = 0; i < 2; i++) {
        const gameId = adapter.started[i].gameId;
        seedGameWithPlayers(repo, gameId, i, true, false);
        eventBus.publish(terminalEvent(gameId, 'WINNER_DETERMINED', 'TOWN'));
      }
      const report = r.getRunReport(result.runId)!;
      const mini = report.modelPerformance.find((m) => m.model === 'gpt-4o-mini')!;
      const fourO = report.modelPerformance.find((m) => m.model === 'gpt-4o')!;
      // mini lost 2 real games (4o has wins -> losses are countable).
      expect(mini.losses).toBe(2);
      expect(fourO.losses).toBe(0);
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
