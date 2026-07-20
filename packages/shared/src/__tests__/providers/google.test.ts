/**
 * Google Provider Unit Tests
 *
 * Tests for GoogleProvider: constructor, capabilities, configure,
 * getConfig, validateConfig, countTokens, estimateCost, getStats, resetStats.
 */

import { describe, it, expect } from 'vitest';
import {
  GoogleProvider,
  ProviderConfig,
} from '../../providers/index.js';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    provider: 'GOOGLE',
    apiKey: 'test-key',
    model: 'gemini-2.5-flash',
    ...overrides,
  };
}

describe('GoogleProvider', () => {
  describe('constructor', () => {
    it('should set provider name to GOOGLE', () => {
      const provider = new GoogleProvider(makeConfig());
      expect(provider.provider).toBe('GOOGLE');
    });

    it('should initialize stats at zero', () => {
      const provider = new GoogleProvider(makeConfig());
      const stats = provider.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
    });
  });

  describe('capabilities', () => {
    it('should report Gemini capabilities', () => {
      const provider = new GoogleProvider(makeConfig());
      const caps = provider.capabilities;
      expect(caps.streaming).toBe(true);
      expect(caps.functionCalling).toBe(true);
      expect(caps.systemPrompt).toBe(true);
      expect(caps.maxContextLength).toBe(1000000);
      expect(caps.maxOutputLength).toBe(8192);
    });
  });

  describe('configure', () => {
    it('should update model', () => {
      const provider = new GoogleProvider(makeConfig());
      provider.configure({ model: 'gemini-2.5-pro' } as ProviderConfig);
      expect(provider.getConfig().model).toBe('gemini-2.5-pro');
    });
  });

  describe('getConfig', () => {
    it('should return config with API key', () => {
      const provider = new GoogleProvider(makeConfig());
      const config = provider.getConfig();
      expect(config.provider).toBe('GOOGLE');
      expect(config.apiKey).toBe('test-key');
    });
  });

  describe('validateConfig', () => {
    it('should return true with valid config', () => {
      const provider = new GoogleProvider(makeConfig());
      expect(provider.validateConfig()).toBe(true);
    });

    it('should return false without apiKey', () => {
      const provider = new GoogleProvider(makeConfig({ apiKey: undefined }));
      expect(provider.validateConfig()).toBe(false);
    });

    it('should return false without model', () => {
      const provider = new GoogleProvider(makeConfig({ model: '' }));
      expect(provider.validateConfig()).toBe(false);
    });
  });

  describe('countTokens', () => {
    it('should estimate ~4 chars per token', () => {
      const provider = new GoogleProvider(makeConfig());
      expect(provider.countTokens('Hello World')).toBe(3);
    });
  });

  describe('estimateCost', () => {
    it('should return a number', () => {
      const provider = new GoogleProvider(makeConfig());
      const cost = provider.estimateCost(1000, 500);
      expect(typeof cost).toBe('number');
    });
  });

  describe('getStats', () => {
    it('should return stats with model', () => {
      const provider = new GoogleProvider(makeConfig({ model: 'gemini-1.5-pro' }));
      const stats = provider.getStats();
      expect(stats.provider).toBe('GOOGLE');
      expect(stats.model).toBe('gemini-1.5-pro');
    });
  });

  describe('resetStats', () => {
    it('should reset all counters', () => {
      const provider = new GoogleProvider(makeConfig());
      provider.resetStats();
      const stats = provider.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalCost).toBe(0);
      expect(stats.avgLatency).toBe(0);
      expect(stats.errorRate).toBe(0);
    });
  });
});
