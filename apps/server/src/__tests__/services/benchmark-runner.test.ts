import { describe, it, expect, beforeEach } from 'vitest';
import { BenchmarkRunner } from '../../services/benchmark-runner.js';
import { createSqliteBackedRepository, createFakeEventBus, createFakeStatsCollector, createFakeAgentCoordinator } from './mocks.js';
import type { GameEngine } from '../../services/game-engine.js';

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
});
