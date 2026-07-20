/**
 * Groq Provider Unit Tests
 *
 * Tests for GroqProvider: constructor, capabilities, configure,
 * getConfig, validateConfig, countTokens, estimateCost, getStats, resetStats.
 */

import { describe, it, expect } from 'vitest';
import {
  GroqProvider,
  ProviderConfig,
} from '../../providers/index.js';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    provider: 'GROQ',
    apiKey: 'test-key',
    model: 'llama-3.3-70b-versatile',
    ...overrides,
  };
}

describe('GroqProvider', () => {
  describe('constructor', () => {
    it('should set provider name to GROQ', () => {
      const provider = new GroqProvider(makeConfig());
      expect(provider.provider).toBe('GROQ');
    });

    it('should initialize stats', () => {
      const provider = new GroqProvider(makeConfig());
      const stats = provider.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
    });
  });

  describe('capabilities', () => {
    it('should report Groq capabilities', () => {
      const provider = new GroqProvider(makeConfig());
      const caps = provider.capabilities;
      expect(caps.streaming).toBe(true);
      expect(caps.functionCalling).toBe(false);
      expect(caps.systemPrompt).toBe(true);
      expect(caps.maxContextLength).toBe(128000);
      expect(caps.maxOutputLength).toBe(4096);
    });
  });

  describe('configure', () => {
    it('should update model', () => {
      const provider = new GroqProvider(makeConfig());
      provider.configure({ model: 'llama3-70b-8192' } as ProviderConfig);
      expect(provider.getConfig().model).toBe('llama3-70b-8192');
    });
  });

  describe('getConfig', () => {
    it('should return full config', () => {
      const provider = new GroqProvider(makeConfig());
      const config = provider.getConfig();
      expect(config.provider).toBe('GROQ');
      expect(config.model).toBe('llama-3.3-70b-versatile');
      expect(config.apiKey).toBe('test-key');
    });
  });

  describe('validateConfig', () => {
    it('should return true with apiKey and model', () => {
      const provider = new GroqProvider(makeConfig());
      expect(provider.validateConfig()).toBe(true);
    });

    it('should return false without apiKey', () => {
      const provider = new GroqProvider(makeConfig({ apiKey: undefined }));
      expect(provider.validateConfig()).toBe(false);
    });

    it('should return false without model', () => {
      const provider = new GroqProvider(makeConfig({ model: '' }));
      expect(provider.validateConfig()).toBe(false);
    });
  });

  describe('countTokens', () => {
    it('should estimate tokens', () => {
      const provider = new GroqProvider(makeConfig());
      expect(provider.countTokens('Groq fast inference')).toBe(5);
    });
  });

  describe('estimateCost', () => {
    it('should return a number', () => {
      const provider = new GroqProvider(makeConfig());
      const cost = provider.estimateCost(1000, 500);
      expect(typeof cost).toBe('number');
    });
  });

  describe('getStats', () => {
    it('should return stats', () => {
      const provider = new GroqProvider(makeConfig());
      const stats = provider.getStats();
      expect(stats.provider).toBe('GROQ');
      expect(stats.model).toBe('llama-3.3-70b-versatile');
    });
  });

  describe('resetStats', () => {
    it('should zero out stats', () => {
      const provider = new GroqProvider(makeConfig());
      provider.resetStats();
      const stats = provider.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
    });
  });
});
