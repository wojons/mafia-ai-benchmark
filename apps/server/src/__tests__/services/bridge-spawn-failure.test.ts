import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';
import { BenchmarkRunner } from '../../services/benchmark-runner.js';
import {
  createSqliteBackedRepository,
  createFakeEventBus,
  createFakeStatsCollector,
  createFakeAgentCoordinator,
} from './mocks.js';
import type { GameEngine } from '../../services/game-engine.js';
import type { GameEvent } from '@mafia/shared/events';

/**
 * QA-MAFIA-AI-BENCHMARK-13 — bridge spawn failure must not strand a run.
 *
 * Two layers:
 *  1. bridgeScriptPath must point at a REAL legacy-bridge.js for both the
 *     src/ (tsx dev) and dist/ (node production start) layouts — the
 *     shipped defect was `Cannot find module .../dist/services/legacy-bridge.js`
 *     because the CommonJS bridge files never reached dist/.
 *  2. a legacy bridge child that exits nonzero WITHOUT publishing any
 *     terminal event (the failed require() shape) must mark the
 *     benchmark_games row errored so the run reaches a terminal status
 *     instead of staying RUNNING forever.
 */

// Intercept child_process.spawn — only legacy-game-adapter.ts imports it in
// this module graph (same file-wide mock pattern as legacy-game-adapter.test.ts).
const spawnHarness = vi.hoisted(() => {
  // Mutable list of "close" listeners the test installs/invokes.
  const closeListeners: Array<(code: number | null) => void> = [];
  const stub = () => ({ on: vi.fn(), once: vi.fn(), removeListener: vi.fn() });
  return {
    closeListeners,
    spawnMock: vi.fn(() => ({
      pid: 4242,
      stdout: stub(),
      stderr: stub(),
      kill: vi.fn(),
      on(event: string, fn: (...args: unknown[]) => void) {
        if (event === 'close') closeListeners.push(fn as (code: number | null) => void);
      },
      once: vi.fn(),
    })),
  };
});

vi.mock('child_process', () => ({
  spawn: spawnHarness.spawnMock,
}));

function terminalEvent(gameId: string, type: 'GAME_ENDED', winner: string): GameEvent {
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

describe('QA-MAFIA-AI-BENCHMARK-13 bridge spawn failure', () => {
  beforeEach(() => {
    spawnHarness.spawnMock.mockClear();
    spawnHarness.closeListeners.length = 0;
  });

  it('bridgeScriptPath resolves to a real legacy-bridge.js in the dist layout (production start)', () => {
    const repo = createSqliteBackedRepository();
    const adapter = new LegacyGameAdapter(createFakeEventBus(), repo as any);
    const bridgePath = (adapter as any).bridgeScriptPath as string;

    // The path must point INTO this package (src/ or dist/), and the file
    // must exist on disk. After a real build both layouts hold it:
    // src/services/legacy-bridge.js (tsx dev) and dist/services/legacy-bridge.js
    // (node dist start — the file the copy step places there).
    expect(bridgePath.endsWith('legacy-bridge.js')).toBe(true);
    expect(bridgePath.includes('services')).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    expect(fs.existsSync(bridgePath)).toBe(true);
  });

  it('a bridge child that exits nonzero with zero events marks the game errored and the run FAILED', () => {
    const repo = createSqliteBackedRepository();
    const eventBus = createFakeEventBus();
    const adapter = new LegacyGameAdapter(eventBus, repo as any);
    const runner = new BenchmarkRunner({
      gameEngine: {} as GameEngine,
      agentCoordinator: createFakeAgentCoordinator(),
      eventBus,
      statsCollector: createFakeStatsCollector(),
      gameRepository: repo as any,
      legacyAdapter: adapter,
    });

    const result = runner.start({
      models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
      gamesPerPairing: 1,
      numPlayers: 5,
    });
    const gameId = (adapter as any).activeGames.keys().next().value as string;
    expect(gameId).toBeTruthy();
    expect(runner.getStatus(result.runId)!.status).toBe('RUNNING');

    // Simulate the shipped failure: child dies at require() with code 1,
    // no bridge messages, no GAME_ENDED event.
    expect(spawnHarness.closeListeners.length).toBeGreaterThan(0);
    for (const fn of spawnHarness.closeListeners) fn(1);

    const row = (repo as any).db
      .prepare('SELECT * FROM benchmark_games WHERE game_id = ?')
      .get(gameId) as any;
    expect(row.error).toBeTruthy();
    expect(row.error).toContain('exited with code 1');

    const status = runner.getStatus(result.runId)!;
    expect(status.status).toBe('FAILED');
    expect(status.completedAt).not.toBeNull();
  });

  it('a nonzero exit AFTER a terminal event does not overwrite the completed result', () => {
    const repo = createSqliteBackedRepository();
    const eventBus = createFakeEventBus();
    const adapter = new LegacyGameAdapter(eventBus, repo as any);
    const runner = new BenchmarkRunner({
      gameEngine: {} as GameEngine,
      agentCoordinator: createFakeAgentCoordinator(),
      eventBus,
      statsCollector: createFakeStatsCollector(),
      gameRepository: repo as any,
      legacyAdapter: adapter,
    });

    const result = runner.start({
      models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
      gamesPerPairing: 1,
      numPlayers: 5,
    });
    const gameId = (adapter as any).activeGames.keys().next().value as string;

    // The game completes normally, THEN the child closes (e.g. cleanup exit).
    eventBus.publish(terminalEvent(gameId, 'GAME_ENDED', 'TOWN'));
    for (const fn of spawnHarness.closeListeners) fn(0);

    const row = (repo as any).db
      .prepare('SELECT * FROM benchmark_games WHERE game_id = ?')
      .get(gameId) as any;
    expect(row.error).toBeNull();
    expect(row.winner).toBe('TOWN');
    expect(runner.getStatus(result.runId)!.status).toBe('COMPLETED');
  });
});
