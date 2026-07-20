/**
 * DeepSeek Provider Unit Tests
 *
 * Tests for DeepSeekProvider: constructor, capabilities, configure,
 * getConfig, validateConfig, countTokens, estimateCost, getStats, resetStats.
 */

import { describe, it, expect } from 'vitest';
import {
  DeepSeekProvider,
  ProviderConfig,
} from '../../providers/index.js';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    provider: 'DEEPSEEK',
    apiKey: 'test-key',
    model: 'deepseek-chat',
    ...overrides,
  };
}

describe('DeepSeekProvider', () => {
  describe('constructor', () => {
    it('should set provider name to DEEPSEEK', () => {
      const provider = new DeepSeekProvider(makeConfig());
      expect(provider.provider).toBe('DEEPSEEK');
    });

    it('should initialize stats', () => {
      const provider = new DeepSeekProvider(makeConfig());
      const stats = provider.getStats();
      expect(stats.provider).toBe('DEEPSEEK');
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe('capabilities', () => {
    it('should report correct capabilities', () => {
      const provider = new DeepSeekProvider(makeConfig());
      const caps = provider.capabilities;
      expect(caps.streaming).toBe(true);
      expect(caps.functionCalling).toBe(true);
      expect(caps.systemPrompt).toBe(true);
      expect(caps.maxContextLength).toBe(64000);
      expect(caps.maxOutputLength).toBe(4096);
    });
  });

  describe('configure', () => {
    it('should merge config values', () => {
      const provider = new DeepSeekProvider(makeConfig());
      provider.configure({ model: 'deepseek-reasoner' } as ProviderConfig);
      const config = provider.getConfig();
      expect(config.model).toBe('deepseek-reasoner');
      expect(config.apiKey).toBe('test-key');
    });
  });

  describe('getConfig', () => {
    it('should return config', () => {
      const provider = new DeepSeekProvider(makeConfig());
      const config = provider.getConfig();
      expect(config.provider).toBe('DEEPSEEK');
      expect(config.model).toBe('deepseek-chat');
    });
  });

  describe('validateConfig', () => {
    it('should return true with apiKey and model', () => {
      const provider = new DeepSeekProvider(makeConfig());
      expect(provider.validateConfig()).toBe(true);
    });

    it('should return false without apiKey', () => {
      const provider = new DeepSeekProvider(makeConfig({ apiKey: undefined }));
      expect(provider.validateConfig()).toBe(false);
    });

    it('should return false without model', () => {
      const provider = new DeepSeekProvider(makeConfig({ model: '' }));
      expect(provider.validateConfig()).toBe(false);
    });
  });

  describe('countTokens', () => {
    it('should estimate tokens', () => {
      const provider = new DeepSeekProvider(makeConfig());
      expect(provider.countTokens('Hello')).toBe(2);
    });
  });

  describe('estimateCost', () => {
    it('should return a number', () => {
      const provider = new DeepSeekProvider(makeConfig());
      expect(typeof provider.estimateCost(1000, 500)).toBe('number');
    });
  });

  describe('getStats', () => {
    it('should return stats object', () => {
      const provider = new DeepSeekProvider(makeConfig());
      const stats = provider.getStats();
      expect(stats.provider).toBe('DEEPSEEK');
      expect(stats.model).toBe('deepseek-chat');
    });
  });

  describe('resetStats', () => {
    it('should reset counters', () => {
      const provider = new DeepSeekProvider(makeConfig());
      provider.resetStats();
      const stats = provider.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalCost).toBe(0);
    });
  });
});
