/**
 * Shared Package Test Setup
 * 
 * Configuration and mocks for shared package tests.
 */

// Mock console for cleaner test output
const mockConsole = {
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// @ts-ignore
global.console = mockConsole;

// Set test timeout
vi.setConfig({ testTimeout: 30000 });

// Mock environment variables
process.env.NODE_ENV = 'test';

// Export test utilities
export const createMockPlayer = (overrides = {}) => ({
  id: `player-${Date.now()}`,
  name: `Test Player ${Math.random().toString(36).substr(2, 9)}`,
  role: 'VILLAGER',
  isAlive: true,
  connectionId: `conn-${Date.now()}`,
  ...overrides,
});

export const createMockAgent = (overrides = {}) => ({
  id: `agent-${Date.now()}`,
  name: `Test Agent ${Math.random().toString(36).substr(2, 9)}`,
  provider: 'OPENAI',
  model: 'gpt-4',
  apiKey: 'test-key',
  temperature: 0.7,
  maxTokens: 2000,
  ...overrides,
});

export const createMockGame = (overrides = {}) => ({
  id: `game-${Date.now()}`,
  name: 'Test Game',
  seed: Math.random() * 1000000,
  state: 'SETUP',
  dayNumber: 0,
  players: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  config: {
    numPlayers: 10,
    numMafia: 3,
    numDoctors: 1,
    numSheriffs: 1,
    numVigilantes: 1,
    nightDuration: 60,
    dayDuration: 300,
    votingDuration: 120,
  },
  ...overrides,
});

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const expectToThrow = async (fn: () => Promise<unknown>, errorType?: new (...args: unknown[]) => Error) => {
  try {
    await fn();
    throw new Error('Expected function to throw');
  } catch (error) {
    if (errorType && !(error instanceof errorType)) {
      throw new Error(`Expected error type ${errorType.name} but got ${error.constructor.name}`);
    }
    return error;
  }
};
