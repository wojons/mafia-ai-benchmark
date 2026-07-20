/**
 * XAI (Grok) Provider Unit Tests
 *
 * Tests for XAIProvider: constructor, capabilities, configure,
 * getConfig, validateConfig, countTokens, estimateCost, getStats, resetStats.
 */

import { describe, it, expect } from 'vitest';
import {
  XAIProvider,
  ProviderConfig,
} from '../../providers/index.js';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    provider: 'XAI',
    apiKey: 'test-key',
    model: 'grok-4',
    ...overrides,
  };
}

describe('XAIProvider', () => {
  describe('constructor', () => {
    it('should set provider name to XAI', () => {
      const provider = new XAIProvider(makeConfig());
      expect(provider.provider).toBe('XAI');
    });

    it('should initialize stats at zero', () => {
      const provider = new XAIProvider(makeConfig());
      const stats = provider.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.avgLatency).toBe(0);
    });
  });

  describe('capabilities', () => {
    it('should report Grok capabilities', () => {
      const provider = new XAIProvider(makeConfig());
      const caps = provider.capabilities;
      expect(caps.streaming).toBe(true);
      expect(caps.functionCalling).toBe(false);
      expect(caps.systemPrompt).toBe(true);
      expect(caps.maxContextLength).toBe(131072);
      expect(caps.maxOutputLength).toBe(8192);
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.supportsStopTokens).toBe(true);
    });
  });

  describe('configure', () => {
    it('should update model', () => {
      const provider = new XAIProvider(makeConfig());
      provider.configure({ model: 'grok-3' } as ProviderConfig);
      expect(provider.getConfig().model).toBe('grok-3');
    });

    it('should preserve existing config values', () => {
      const provider = new XAIProvider(makeConfig());
      provider.configure({ temperature: 0.3 } as ProviderConfig);
      const config = provider.getConfig();
      expect(config.temperature).toBe(0.3);
      expect(config.apiKey).toBe('test-key');
    });
  });

  describe('getConfig', () => {
    it('should return config with API key', () => {
      const provider = new XAIProvider(makeConfig());
      const config = provider.getConfig();
      expect(config.provider).toBe('XAI');
      expect(config.model).toBe('grok-4');
      expect(config.apiKey).toBe('test-key');
    });
  });

  describe('validateConfig', () => {
    it('should return true with valid config', () => {
      const provider = new XAIProvider(makeConfig());
      expect(provider.validateConfig()).toBe(true);
    });

    it('should return false without apiKey', () => {
      const provider = new XAIProvider(makeConfig({ apiKey: undefined }));
      expect(provider.validateConfig()).toBe(false);
    });

    it('should return false without model', () => {
      const provider = new XAIProvider(makeConfig({ model: '' }));
      expect(provider.validateConfig()).toBe(false);
    });
  });

  describe('countTokens', () => {
    it('should estimate tokens', () => {
      const provider = new XAIProvider(makeConfig());
      expect(provider.countTokens('Grok from xAI')).toBe(4);
    });
  });

  describe('estimateCost', () => {
    it('should return a number', () => {
      const provider = new XAIProvider(makeConfig());
      const cost = provider.estimateCost(1000, 500);
      expect(typeof cost).toBe('number');
    });
  });

  describe('getStats', () => {
    it('should return correct provider and model', () => {
      const provider = new XAIProvider(makeConfig({ model: 'grok-3-fast' }));
      const stats = provider.getStats();
      expect(stats.provider).toBe('XAI');
      expect(stats.model).toBe('grok-3-fast');
    });
  });

  describe('resetStats', () => {
    it('should reset all counters', () => {
      const provider = new XAIProvider(makeConfig());
      provider.resetStats();
      const stats = provider.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalCost).toBe(0);
      expect(stats.errorRate).toBe(0);
    });
  });
});
