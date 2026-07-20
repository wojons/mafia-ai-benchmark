import { bench, describe } from 'vitest';
import { StatsCollector } from '../../services/stats-collector/index.js';
import {
  createFakeEventBus,
  createFakeGameRepository as createFakeRepository,
  makeTestConfig,
} from '../services/mocks.js';

function createGetGameStatsBenchmark(eventCount: number): () => void {
  const repository = createFakeRepository();
  const eventBus = createFakeEventBus();
  const game = repository.createGame(makeTestConfig());
  repository.updateGameStatus(game.id, 'ENDED');

  for (let index = 0; index < eventCount; index += 1) {
    const isFinalEvent = index === eventCount - 1;
    const event = repository.addEvent(game.id, {
      type: 'PHASE_CHANGED',
      visibility: 'PUBLIC',
      data: isFinalEvent ? { winner: 'TOWN' } : { index },
      metadata: {
        turnNumber: index + 1,
        dayNumber: 1,
        phase: isFinalEvent ? 'GAME_OVER' : 'DAY_DISCUSSION',
        sequence: index + 1,
      },
    });
    eventBus.publish(event);
  }

  const statsCollector = new StatsCollector(repository);
  return () => {
    statsCollector.getGameStats();
  };
}

describe('StatsCollector benchmarks', () => {
  bench('getGameStats() with 10 events', createGetGameStatsBenchmark(10));
  bench('getGameStats() with 100 events', createGetGameStatsBenchmark(100));
  bench('getGameStats() with 1000 events', createGetGameStatsBenchmark(1000));
});
