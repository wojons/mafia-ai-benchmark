/**
 * Ollama Provider Unit Tests
 *
 * Tests for OllamaProvider: constructor, capabilities, configure,
 * getConfig, validateConfig, countTokens, estimateCost, getStats, resetStats,
 * default baseUrl.
 */

import { describe, it, expect } from 'vitest';
import {
  OllamaProvider,
  ProviderConfig,
} from '../../providers/index.js';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    provider: 'OLLAMA',
    model: 'llama3.2',
    ...overrides,
  };
}

describe('OllamaProvider', () => {
  describe('constructor', () => {
    it('should set provider name to OLLAMA', () => {
      const provider = new OllamaProvider(makeConfig());
      expect(provider.provider).toBe('OLLAMA');
    });

    it('should initialize stats', () => {
      const provider = new OllamaProvider(makeConfig());
      const stats = provider.getStats();
      expect(stats.provider).toBe('OLLAMA');
      expect(stats.totalRequests).toBe(0);
    });

    it('should use custom baseUrl when provided', () => {
      const provider = new OllamaProvider(makeConfig({ baseUrl: 'http://my-gpu:11434/v1' }));
      const config = provider.getConfig();
      expect(config.baseUrl).toBe('http://my-gpu:11434/v1');
    });

    it('should not require API key', () => {
      const provider = new OllamaProvider(makeConfig());
      expect(provider.provider).toBe('OLLAMA');
    });
  });

  describe('capabilities', () => {
    it('should report Ollama capabilities', () => {
      const provider = new OllamaProvider(makeConfig());
      const caps = provider.capabilities;
      expect(caps.streaming).toBe(true);
      expect(caps.functionCalling).toBe(false);
      expect(caps.systemPrompt).toBe(true);
      expect(caps.maxContextLength).toBe(16384);
      expect(caps.maxOutputLength).toBe(4096);
    });
  });

  describe('configure', () => {
    it('should update baseUrl', () => {
      const provider = new OllamaProvider(makeConfig());
      provider.configure({ baseUrl: 'http://other-host:11434/v1' } as ProviderConfig);
      const config = provider.getConfig();
      expect(config.baseUrl).toBe('http://other-host:11434/v1');
    });

    it('should update model', () => {
      const provider = new OllamaProvider(makeConfig());
      provider.configure({ model: 'llama3.1' } as ProviderConfig);
      expect(provider.getConfig().model).toBe('llama3.1');
    });
  });

  describe('getConfig', () => {
    it('should return config', () => {
      const provider = new OllamaProvider(makeConfig());
      const config = provider.getConfig();
      expect(config.provider).toBe('OLLAMA');
      expect(config.model).toBe('llama3.2');
    });
  });

  describe('validateConfig', () => {
    it('should return true with model (no API key needed)', () => {
      const provider = new OllamaProvider(makeConfig());
      expect(provider.validateConfig()).toBe(true);
    });

    it('should return false without model', () => {
      const provider = new OllamaProvider(makeConfig({ model: '' }));
      expect(provider.validateConfig()).toBe(false);
    });
  });

  describe('countTokens', () => {
    it('should estimate tokens', () => {
      const provider = new OllamaProvider(makeConfig());
      expect(provider.countTokens('Ollama local model')).toBe(5);
    });
  });

  describe('estimateCost', () => {
    it('should return 0 (free for local, no args)', () => {
      const provider = new OllamaProvider(makeConfig());
      expect(provider.estimateCost()).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return stats with model', () => {
      const provider = new OllamaProvider(makeConfig({ model: 'mistral' }));
      const stats = provider.getStats();
      expect(stats.provider).toBe('OLLAMA');
      expect(stats.model).toBe('mistral');
    });
  });

  describe('resetStats', () => {
    it('should zero out stats', () => {
      const provider = new OllamaProvider(makeConfig());
      provider.resetStats();
      const stats = provider.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalCost).toBe(0);
    });
  });
});
