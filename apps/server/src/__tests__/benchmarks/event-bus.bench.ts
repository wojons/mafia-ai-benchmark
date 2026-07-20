import { bench, describe } from 'vitest';
import type { GameEvent } from '@mafia/shared/types';
import { EventBus } from '../../services/event-bus.js';

const event: GameEvent = {
  id: 'benchmark-event',
  gameId: 'benchmark-game',
  type: 'GAME_CREATED',
  timestamp: new Date(0),
  visibility: 'PUBLIC',
  data: {},
  metadata: {
    turnNumber: 1,
    dayNumber: 1,
    phase: 'SETUP',
    sequence: 1,
  },
};

function createPublishBenchmark(subscriberCount: number): () => void {
  const eventBus = new EventBus();
  const handler = () => undefined;

  for (let index = 0; index < subscriberCount; index += 1) {
    eventBus.subscribe(event.type, handler);
  }

  return () => eventBus.publish(event);
}

describe('EventBus benchmarks', () => {
  bench('publish() with 0 subscribers', createPublishBenchmark(0));
  bench('publish() with 10 subscribers', createPublishBenchmark(10));
  bench('publish() with 100 subscribers', createPublishBenchmark(100));

  const eventBus = new EventBus();
  const handler = () => undefined;

  bench('subscribe() + unsubscribe() cycle', () => {
    const unsubscribe = eventBus.subscribe(event.type, handler);
    unsubscribe();
  });
});
