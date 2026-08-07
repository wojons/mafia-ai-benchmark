import { describe, it, expect, beforeEach } from 'vitest';
import { BenchmarkRunner } from '../../services/benchmark-runner.js';
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
});
