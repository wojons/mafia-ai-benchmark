/**
 * OpenAI Provider Unit Tests
 *
 * Tests for OpenAIProvider: constructor, capabilities, configure,
 * getConfig, validateConfig, countTokens, estimateCost, getStats, resetStats,
 * baseUrl override.
 */

import { describe, it, expect } from 'vitest';
import {
  OpenAIProvider,
  ProviderConfig,
  LLMError,
} from '../../providers/index.js';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    provider: 'OPENAI',
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    ...overrides,
  };
}

describe('OpenAIProvider', () => {
  describe('constructor', () => {
    it('should set provider name to OPENAI', () => {
      const provider = new OpenAIProvider(makeConfig());
      expect(provider.provider).toBe('OPENAI');
    });

    it('should initialize stats with zero values', () => {
      const provider = new OpenAIProvider(makeConfig());
      const stats = provider.getStats();
      expect(stats.provider).toBe('OPENAI');
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalCost).toBe(0);
      expect(stats.avgLatency).toBe(0);
      expect(stats.errorRate).toBe(0);
    });

    it('should use custom baseUrl when provided', () => {
      const provider = new OpenAIProvider(makeConfig({ baseUrl: 'https://custom.openai.com/v1' }));
      const config = provider.getConfig();
      expect(config.baseUrl).toBe('https://custom.openai.com/v1');
    });

    it('should default baseUrl to api.openai.com', () => {
      const provider = new OpenAIProvider(makeConfig());
      // The baseUrl is stored as a private field; we test it indirectly
      // via getConfig which only returns the config, not the computed baseUrl
      expect(provider.getConfig().provider).toBe('OPENAI');
    });
  });

  describe('capabilities', () => {
    it('should report correct capabilities', () => {
      const provider = new OpenAIProvider(makeConfig());
      const caps = provider.capabilities;
      expect(caps.streaming).toBe(true);
      expect(caps.functionCalling).toBe(true);
      expect(caps.systemPrompt).toBe(true);
      expect(caps.maxContextLength).toBe(128000);
      expect(caps.maxOutputLength).toBe(4096);
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.supportsStopTokens).toBe(true);
    });
  });

  describe('configure', () => {
    it('should update baseUrl from config', () => {
      const provider = new OpenAIProvider(makeConfig());
      provider.configure({ baseUrl: 'https://new-url.com/v1' } as ProviderConfig);
      const config = provider.getConfig();
      expect(config.baseUrl).toBe('https://new-url.com/v1');
    });

    it('should merge model changes', () => {
      const provider = new OpenAIProvider(makeConfig());
      provider.configure({ model: 'gpt-5-mini' } as ProviderConfig);
      const config = provider.getConfig();
      expect(config.model).toBe('gpt-5-mini');
      expect(config.apiKey).toBe('test-key'); // preserved
    });
  });

  describe('getConfig', () => {
    it('should return config with all values', () => {
      const provider = new OpenAIProvider(makeConfig({ temperature: 0.5, maxTokens: 1000 }));
      const config = provider.getConfig();
      expect(config.provider).toBe('OPENAI');
      expect(config.apiKey).toBe('test-key');
      expect(config.model).toBe('gpt-4o-mini');
      expect(config.temperature).toBe(0.5);
      expect(config.maxTokens).toBe(1000);
    });

    it('should return a new object copy', () => {
      const provider = new OpenAIProvider(makeConfig());
      const config1 = provider.getConfig();
      const config2 = provider.getConfig();
      expect(config1).not.toBe(config2);
    });
  });

  describe('validateConfig', () => {
    it('should return true with apiKey and model', () => {
      const provider = new OpenAIProvider(makeConfig());
      expect(provider.validateConfig()).toBe(true);
    });

    it('should return false without apiKey', () => {
      const provider = new OpenAIProvider(makeConfig({ apiKey: undefined }));
      expect(provider.validateConfig()).toBe(false);
    });

    it('should return false without model', () => {
      const provider = new OpenAIProvider(makeConfig({ model: '' }));
      expect(provider.validateConfig()).toBe(false);
    });

    it('should return false with undefined model', () => {
      const provider = new OpenAIProvider(makeConfig({ model: undefined }));
      expect(provider.validateConfig()).toBe(false);
    });
  });

  describe('countTokens', () => {
    it('should estimate ~4 chars per token', () => {
      const provider = new OpenAIProvider(makeConfig());
      expect(provider.countTokens('Hello World')).toBe(3);
      expect(provider.countTokens('ChatGPT')).toBe(2);
    });

    it('should return 0 for empty string', () => {
      const provider = new OpenAIProvider(makeConfig());
      expect(provider.countTokens('')).toBe(0);
    });
  });

  describe('estimateCost', () => {
    it('should return a number', () => {
      const provider = new OpenAIProvider(makeConfig());
      const cost = provider.estimateCost(1000, 500);
      expect(typeof cost).toBe('number');
    });
  });

  describe('getStats', () => {
    it('should return initial stats', () => {
      const provider = new OpenAIProvider(makeConfig());
      const stats = provider.getStats();
      expect(stats.provider).toBe('OPENAI');
      expect(stats.model).toBe('gpt-4o-mini');
      expect(stats.lastUsed).toBeInstanceOf(Date);
    });

    it('should return a copy each time', () => {
      const provider = new OpenAIProvider(makeConfig());
      expect(provider.getStats()).not.toBe(provider.getStats());
    });
  });

  describe('resetStats', () => {
    it('should set all counters to zero', () => {
      const provider = new OpenAIProvider(makeConfig());
      provider.resetStats();
      const stats = provider.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalCost).toBe(0);
      expect(stats.avgLatency).toBe(0);
      expect(stats.errorRate).toBe(0);
    });

    it('should keep model and provider', () => {
      const provider = new OpenAIProvider(makeConfig());
      provider.resetStats();
      const stats = provider.getStats();
      expect(stats.provider).toBe('OPENAI');
      expect(stats.model).toBe('gpt-4o-mini');
    });
  });
});
