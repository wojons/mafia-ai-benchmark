/**
 * Custom Provider Unit Tests
 *
 * Tests for CustomProvider: constructor (throws without baseUrl),
 * constructor (with baseUrl), capabilities, configure, getConfig,
 * validateConfig, countTokens, estimateCost, getStats, resetStats.
 */

import { describe, it, expect } from 'vitest';
import {
  CustomProvider,
  ProviderConfig,
  LLMError,
  ERROR_CODES,
} from '../../providers/index.js';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    provider: 'CUSTOM',
    model: 'custom-model',
    baseUrl: 'https://custom.api.com',
    ...overrides,
  };
}

describe('CustomProvider', () => {
  describe('constructor', () => {
    it('should throw LLMError when baseUrl is not provided', () => {
      expect(() => {
        new CustomProvider({ provider: 'CUSTOM', model: 'test' });
      }).toThrow(LLMError);
    });

    it('should throw with INVALID_REQUEST code when no baseUrl', () => {
      expect(() => {
        new CustomProvider({ provider: 'CUSTOM', model: 'test' });
      }).toThrow('Custom provider requires baseUrl');
    });

    it('should create when baseUrl is provided', () => {
      const provider = new CustomProvider(makeConfig());
      expect(provider.provider).toBe('CUSTOM');
    });

    it('should initialize stats with zero values', () => {
      const provider = new CustomProvider(makeConfig());
      const stats = provider.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalCost).toBe(0);
    });

    it('should accept apiKey as optional', () => {
      const provider = new CustomProvider(makeConfig({ apiKey: undefined }));
      expect(provider.provider).toBe('CUSTOM');
    });
  });

  describe('capabilities', () => {
    it('should report correct capabilities', () => {
      const provider = new CustomProvider(makeConfig());
      const caps = provider.capabilities;
      expect(caps.streaming).toBe(true);
      expect(caps.functionCalling).toBe(false);
      expect(caps.systemPrompt).toBe(true);
      expect(caps.maxContextLength).toBe(32768);
      expect(caps.maxOutputLength).toBe(4096);
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.supportsStopTokens).toBe(true);
    });
  });

  describe('configure', () => {
    it('should update baseUrl', () => {
      const provider = new CustomProvider(makeConfig());
      provider.configure({ baseUrl: 'https://new-custom.api.com' } as ProviderConfig);
      const config = provider.getConfig();
      expect(config.baseUrl).toBe('https://new-custom.api.com');
    });

    it('should merge other config values', () => {
      const provider = new CustomProvider(makeConfig());
      provider.configure({ model: 'updated-model' } as ProviderConfig);
      const config = provider.getConfig();
      expect(config.model).toBe('updated-model');
      expect(config.baseUrl).toBe('https://custom.api.com'); // preserved
    });
  });

  describe('getConfig', () => {
    it('should return full config', () => {
      const provider = new CustomProvider(makeConfig({ apiKey: 'custom-key' }));
      const config = provider.getConfig();
      expect(config.provider).toBe('CUSTOM');
      expect(config.model).toBe('custom-model');
      expect(config.baseUrl).toBe('https://custom.api.com');
      expect(config.apiKey).toBe('custom-key');
    });
  });

  describe('validateConfig', () => {
    it('should return true with baseUrl and model', () => {
      const provider = new CustomProvider(makeConfig());
      expect(provider.validateConfig()).toBe(true);
    });

    it('should return false without model', () => {
      const provider = new CustomProvider(makeConfig({ model: '' }));
      expect(provider.validateConfig()).toBe(false);
    });
  });

  describe('countTokens', () => {
    it('should estimate tokens from text', () => {
      const provider = new CustomProvider(makeConfig());
      expect(provider.countTokens('Hello World')).toBe(3);
      expect(provider.countTokens('')).toBe(0);
    });
  });

  describe('estimateCost', () => {
    it('should return a number', () => {
      const provider = new CustomProvider(makeConfig());
      expect(typeof provider.estimateCost(1000, 500)).toBe('number');
    });
  });

  describe('getStats', () => {
    it('should return stats with correct provider', () => {
      const provider = new CustomProvider(makeConfig());
      const stats = provider.getStats();
      expect(stats.provider).toBe('CUSTOM');
      expect(stats.model).toBe('custom-model');
    });
  });

  describe('resetStats', () => {
    it('should zero out counters', () => {
      const provider = new CustomProvider(makeConfig());
      provider.resetStats();
      const stats = provider.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
    });
  });
});
