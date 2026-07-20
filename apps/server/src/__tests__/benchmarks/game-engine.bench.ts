import { bench, describe } from 'vitest';
import { GameEngine } from '../../services/game-engine.js';
import {
  createFakeAgentCoordinator,
  createFakeEventBus,
  createFakeGameRepository as createFakeRepository,
  createFakeStatsCollector,
} from '../services/mocks.js';

function createEngine() {
  const repository = createFakeRepository();
  const eventBus = createFakeEventBus();
  const agentCoordinator = createFakeAgentCoordinator();
  const statsCollector = createFakeStatsCollector();
  const engine = new GameEngine(repository, agentCoordinator, eventBus, statsCollector);

  return { engine, repository };
}

let originalConsoleLog: typeof console.log;
const silentEngineLogs = {
  setup() {
    originalConsoleLog = console.log;
    console.log = () => undefined;
  },
  teardown() {
    console.log = originalConsoleLog;
  },
};

describe('GameEngine benchmarks', () => {
  for (const playerCount of [5, 10, 20]) {
    const { engine, repository } = createEngine();

    bench(`createGame() configured for ${playerCount} players`, () => {
      const game = engine.createGame({
        config: {
          numPlayers: playerCount,
          maxPlayers: playerCount,
        },
      });

      repository._state.games.delete(game.id);
      (engine as unknown as { activeGames: Map<string, unknown> }).activeGames.delete(game.id);
    }, silentEngineLogs);
  }

  const { engine: startEngine, repository: startRepository } = createEngine();
  const game = startEngine.createGame({ config: { numPlayers: 5, maxPlayers: 5 } });
  for (let index = 0; index < 5; index += 1) {
    startEngine.joinGame(game.id, `Player ${index + 1}`);
  }

  bench('startGame() after 5 players join', () => {
    const result = startEngine.startGame(game.id);
    if (!result.success) {
      throw new Error(result.error);
    }

    const storedGame = startRepository._state.games.get(game.id)!;
    storedGame.status = 'SETUP';
    storedGame.startedAt = undefined;
    storedGame.events = [];
    for (const player of storedGame.players) {
      player.role = 'UNASSIGNED';
      player.isMafia = false;
    }
    startRepository._state.events.length = 0;
    startRepository._state.sequences.set(game.id, 0);
  }, silentEngineLogs);
});
