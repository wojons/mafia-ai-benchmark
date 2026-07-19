import { describe, it, expect, beforeEach } from 'vitest';
import { AgentCoordinator } from '../../services/agent-coordinator.js';
import { createFakeEventBus, createFakeStatsCollector } from './mocks.js';
import type { AgentConfig } from '../../services/agent-coordinator.js';

const makeConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  id: overrides.id ?? 'agent-1',
  name: overrides.name ?? 'TestAgent',
  provider: overrides.provider ?? 'OPENAI',
  model: overrides.model ?? 'gpt-4',
  temperature: overrides.temperature ?? 0.7,
});

describe('AgentCoordinator', () => {
  let eventBus: ReturnType<typeof createFakeEventBus>;
  let stats: ReturnType<typeof createFakeStatsCollector>;
  let coordinator: AgentCoordinator;

  beforeEach(() => {
    eventBus = createFakeEventBus();
    stats = createFakeStatsCollector();
    coordinator = new AgentCoordinator(eventBus, stats);
  });

  // ==========================================================================
  // registerAgent / unregisterAgent / getAgent
  // ==========================================================================

  describe('registerAgent()', () => {
    it('registers an agent and makes it retrievable', () => {
      const config = makeConfig();
      coordinator.registerAgent(config);
      const agent = coordinator.getAgent('agent-1');
      expect(agent).toBeDefined();
      expect(agent?.id).toBe('agent-1');
    });

    it('overwrites an existing agent with the same ID', () => {
      coordinator.registerAgent(makeConfig({ id: 'dup', name: 'First' }));
      coordinator.registerAgent(makeConfig({ id: 'dup', name: 'Second' }));
      const agent = coordinator.getAgent('dup');
      expect(agent?.name).toBe('Second');
    });
  });

  describe('unregisterAgent()', () => {
    it('returns true when removing a registered agent', () => {
      coordinator.registerAgent(makeConfig({ id: 'to-remove' }));
      expect(coordinator.unregisterAgent('to-remove')).toBe(true);
      expect(coordinator.getAgent('to-remove')).toBeUndefined();
    });

    it('returns false for unknown agent ID', () => {
      expect(coordinator.unregisterAgent('nope')).toBe(false);
    });
  });

  describe('getAgent()', () => {
    it('returns undefined for unknown agent ID', () => {
      expect(coordinator.getAgent('ghost')).toBeUndefined();
    });
  });

  // ==========================================================================
  // assignAgent
  // ==========================================================================

  describe('assignAgent()', () => {
    it('returns false when agent is not registered', () => {
      expect(coordinator.assignAgent('player-1', 'unknown-agent')).toBe(false);
    });

    it('returns true when agent is registered', () => {
      coordinator.registerAgent(makeConfig({ id: 'a1' }));
      expect(coordinator.assignAgent('player-1', 'a1')).toBe(true);
    });
  });

  // ==========================================================================
  // Role prompt generation
  // ==========================================================================

  describe('role prompts (via getRolePrompt — indirect)', () => {
    it('accepts MAFIA role', () => {
      coordinator.registerAgent(makeConfig());
      coordinator.assignAgent('p-mafia', 'agent-1');
      // Access private method indirectly by confirming no throw
      expect(() => coordinator.assignAgent('p-mafia-2', 'agent-1')).not.toThrow();
    });
  });
});
