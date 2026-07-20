/**
 * Anthropic Provider Unit Tests
 *
 * Tests for AnthropicProvider: constructor, capabilities, configure,
 * getConfig, validateConfig, countTokens, estimateCost, getStats, resetStats.
 */

import { describe, it, expect } from 'vitest';
import {
  AnthropicProvider,
  ProviderConfig,
  LLMError,
  ERROR_CODES,
} from '../../providers/index.js';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    provider: 'ANTHROPIC',
    apiKey: 'test-key',
    model: 'claude-sonnet-4-20250514',
    ...overrides,
  };
}

describe('AnthropicProvider', () => {
  describe('constructor', () => {
    it('should set provider name to ANTHROPIC', () => {
      const provider = new AnthropicProvider(makeConfig());
      expect(provider.provider).toBe('ANTHROPIC');
    });

    it('should initialize stats with zero values', () => {
      const provider = new AnthropicProvider(makeConfig());
      const stats = provider.getStats();
      expect(stats.provider).toBe('ANTHROPIC');
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalCost).toBe(0);
      expect(stats.avgLatency).toBe(0);
      expect(stats.errorRate).toBe(0);
    });

    it('should set model from config', () => {
      const provider = new AnthropicProvider(makeConfig({ model: 'claude-haiku' }));
      const stats = provider.getStats();
      expect(stats.model).toBe('claude-haiku');
    });
  });

  describe('capabilities', () => {
    it('should report correct capabilities', () => {
      const provider = new AnthropicProvider(makeConfig());
      const caps = provider.capabilities;
      expect(caps.streaming).toBe(true);
      expect(caps.functionCalling).toBe(false);
      expect(caps.systemPrompt).toBe(true);
      expect(caps.maxContextLength).toBe(200000);
      expect(caps.maxOutputLength).toBe(8192);
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.supportsStopTokens).toBe(true);
    });
  });

  describe('configure', () => {
    it('should merge new config values', () => {
      const provider = new AnthropicProvider(makeConfig());
      provider.configure({ model: 'claude-haiku-4-20250514', temperature: 0.5 } as ProviderConfig);
      const config = provider.getConfig();
      expect(config.model).toBe('claude-haiku-4-20250514');
      expect(config.temperature).toBe(0.5);
      // Existing values should be preserved
      expect(config.apiKey).toBe('test-key');
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      const provider = new AnthropicProvider(makeConfig());
      const config = provider.getConfig();
      expect(config.provider).toBe('ANTHROPIC');
      expect(config.apiKey).toBe('test-key');
      expect(config.model).toBe('claude-sonnet-4-20250514');
    });

    it('should return a new object (not the same reference)', () => {
      const provider = new AnthropicProvider(makeConfig());
      const config1 = provider.getConfig();
      const config2 = provider.getConfig();
      expect(config1).not.toBe(config2);
    });
  });

  describe('validateConfig', () => {
    it('should return true with apiKey and model', () => {
      const provider = new AnthropicProvider(makeConfig());
      expect(provider.validateConfig()).toBe(true);
    });

    it('should return false without apiKey', () => {
      const provider = new AnthropicProvider(makeConfig({ apiKey: undefined }));
      expect(provider.validateConfig()).toBe(false);
    });

    it('should return false without model', () => {
      const provider = new AnthropicProvider(makeConfig({ model: '' }));
      expect(provider.validateConfig()).toBe(false);
    });
  });

  describe('countTokens', () => {
    it('should estimate tokens from text length', () => {
      const provider = new AnthropicProvider(makeConfig());
      const tokens = provider.countTokens('Hello World');
      expect(tokens).toBe(3); // 12 chars / 4 = 3
    });

    it('should round up for partial tokens', () => {
      const provider = new AnthropicProvider(makeConfig());
      expect(provider.countTokens('a')).toBe(1);
      expect(provider.countTokens('abc')).toBe(1);
      expect(provider.countTokens('abcd')).toBe(1);
      expect(provider.countTokens('abcde')).toBe(2);
    });

    it('should handle empty string', () => {
      const provider = new AnthropicProvider(makeConfig());
      expect(provider.countTokens('')).toBe(0);
    });
  });

  describe('estimateCost', () => {
    it('should return a number', () => {
      const provider = new AnthropicProvider(makeConfig());
      const cost = provider.estimateCost(1000, 500);
      expect(typeof cost).toBe('number');
    });
  });

  describe('getStats', () => {
    it('should return stats object', () => {
      const provider = new AnthropicProvider(makeConfig());
      const stats = provider.getStats();
      expect(stats.provider).toBe('ANTHROPIC');
      expect(stats.lastUsed).toBeInstanceOf(Date);
    });

    it('should return a copy', () => {
      const provider = new AnthropicProvider(makeConfig());
      const stats1 = provider.getStats();
      const stats2 = provider.getStats();
      expect(stats1).not.toBe(stats2);
    });
  });

  describe('resetStats', () => {
    it('should reset all counters to zero', () => {
      const provider = new AnthropicProvider(makeConfig());
      provider.resetStats();
      const stats = provider.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalCost).toBe(0);
      expect(stats.avgLatency).toBe(0);
      expect(stats.errorRate).toBe(0);
    });

    it('should keep current model and provider', () => {
      const provider = new AnthropicProvider(makeConfig());
      provider.resetStats();
      const stats = provider.getStats();
      expect(stats.provider).toBe('ANTHROPIC');
      expect(stats.model).toBe('claude-sonnet-4-20250514');
    });
  });
});
