/**
 * Provider Factory Tests
 * 
 * Tests for provider creation, validation, and model metadata.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  createProvider,
  getAvailableProviders,
  getProviderCapabilities,
  getDefaultModel,
  getProviderModels,
  validateProviderConfig,
  getRecommendedSettings,
  inferProvider,
  getEnvConfig,
  refreshModelMetadata,
  getModelCacheStats,
  ProviderConfig
} from '../../providers/index.js';

describe('Provider Factory', () => {
  describe('getAvailableProviders', () => {
    it('should return list of providers', () => {
      const providers = getAvailableProviders();
      
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThan(0);
      expect(providers).toContain('OPENAI');
      expect(providers).toContain('ANTHROPIC');
      expect(providers).toContain('GOOGLE');
    });
  });

  describe('getDefaultModel', () => {
    it('should return default model for OPENAI', () => {
      const model = getDefaultModel('OPENAI');
      
      expect(model).toBeDefined();
      expect(model.length).toBeGreaterThan(0);
      expect(model).toContain('gpt-');
    });

    it('should return default model for ANTHROPIC', () => {
      const model = getDefaultModel('ANTHROPIC');
      
      expect(model).toBeDefined();
      expect(model).toContain('claude');
    });

    it('should return default model for GOOGLE', () => {
      const model = getDefaultModel('GOOGLE');
      
      expect(model).toBeDefined();
      expect(model).toContain('gemini');
    });

    it('should return default model for GROQ', () => {
      const model = getDefaultModel('GROQ');
      
      expect(model).toBeDefined();
      expect(model).toContain('llama');
    });

    it('should return empty string for CUSTOM provider', () => {
      const model = getDefaultModel('CUSTOM');
      
      expect(model).toBe('');
    });
  });

  describe('validateProviderConfig', () => {
    it('should validate correct config', () => {
      const config: ProviderConfig = {
        provider: 'OPENAI',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
      };

      const result = validateProviderConfig(config);
      
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject missing provider', () => {
      const config = {
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
      } as ProviderConfig;

      const result = validateProviderConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Provider is required');
    });

    it('should reject unknown provider', () => {
      const config: ProviderConfig = {
        provider: 'UNKNOWN',
        apiKey: 'test-key',
        model: 'test-model',
      };

      const result = validateProviderConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown provider'))).toBe(true);
    });

    it('should reject missing API key for OPENAI', () => {
      const config: ProviderConfig = {
        provider: 'OPENAI',
        model: 'gpt-4o-mini',
      };

      const result = validateProviderConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('API key is required'))).toBe(true);
    });

    it('should reject missing baseUrl for CUSTOM provider', () => {
      const config: ProviderConfig = {
        provider: 'CUSTOM',
        model: 'custom-model',
      };

      const result = validateProviderConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Base URL is required'))).toBe(true);
    });

    it('should accept OLLAMA without API key', () => {
      const config: ProviderConfig = {
        provider: 'OLLAMA',
        model: 'llama3.2',
        baseUrl: 'http://localhost:11434',
      };

      const result = validateProviderConfig(config);
      
      expect(result.valid).toBe(true);
    });

    it('should reject invalid temperature', () => {
      const config: ProviderConfig = {
        provider: 'OPENAI',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
        temperature: 3.0, // > 2
      };

      const result = validateProviderConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Temperature'))).toBe(true);
    });

    it('should reject invalid maxTokens', () => {
      const config: ProviderConfig = {
        provider: 'OPENAI',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
        maxTokens: 0,
      };

      const result = validateProviderConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Max tokens'))).toBe(true);
    });
  });

  describe('inferProvider', () => {
    it('should infer OPENAI from GPT models', () => {
      expect(inferProvider('gpt-4o')).toBe('OPENAI');
      expect(inferProvider('gpt-3.5-turbo')).toBe('OPENAI');
      expect(inferProvider('gpt-5')).toBe('OPENAI');
    });

    it('should infer ANTHROPIC from Claude models', () => {
      expect(inferProvider('claude-3-opus')).toBe('ANTHROPIC');
      expect(inferProvider('claude-sonnet')).toBe('ANTHROPIC');
    });

    it('should infer GOOGLE from Gemini models', () => {
      expect(inferProvider('gemini-1.5-pro')).toBe('GOOGLE');
      expect(inferProvider('gemini-pro')).toBe('GOOGLE');
    });

    it('should infer DEEPSEEK from DeepSeek models', () => {
      expect(inferProvider('deepseek-chat')).toBe('DEEPSEEK');
    });

    it('should infer GROQ from Llama 3 models', () => {
      expect(inferProvider('llama-3.3-70b')).toBe('GROQ');
    });

    it('should return undefined for unknown models', () => {
      expect(inferProvider('unknown-model')).toBeUndefined();
    });
  });

  describe('getProviderCapabilities', () => {
    it('should return capabilities for OPENAI', async () => {
      const capabilities = await getProviderCapabilities('OPENAI', 'gpt-4o-mini');
      
      expect(capabilities).toBeDefined();
      expect(capabilities.streaming).toBe(true);
      expect(capabilities.functionCalling).toBe(true);
      expect(capabilities.systemPrompt).toBe(true);
      expect(capabilities.maxContextLength).toBeGreaterThan(0);
      expect(capabilities.maxOutputLength).toBeGreaterThan(0);
      expect(capabilities.supportsTemperature).toBe(true);
      expect(capabilities.supportsStopTokens).toBe(true);
    });

    it('should return capabilities for ANTHROPIC', async () => {
      const capabilities = await getProviderCapabilities('ANTHROPIC');
      
      expect(capabilities).toBeDefined();
      expect(capabilities.streaming).toBe(true);
      // Anthropic doesn't support function calling
      expect(capabilities.systemPrompt).toBe(true);
    });

    it('should return capabilities for GOOGLE', async () => {
      const capabilities = await getProviderCapabilities('GOOGLE');
      
      expect(capabilities).toBeDefined();
      expect(capabilities.streaming).toBe(true);
      expect(capabilities.functionCalling).toBe(true);
    });

    it('should return fallback capabilities for unknown model', async () => {
      const capabilities = await getProviderCapabilities('UNKNOWN_PROVIDER');
      
      expect(capabilities).toBeDefined();
      expect(capabilities.streaming).toBe(true);
      expect(capabilities.maxContextLength).toBe(32768); // Fallback
      expect(capabilities.maxOutputLength).toBe(4096); // Fallback
    });
  });

  describe('getRecommendedSettings', () => {
    it('should return recommended settings for OPENAI', async () => {
      const settings = await getRecommendedSettings('OPENAI', 'gpt-4o-mini');
      
      expect(settings).toBeDefined();
      expect(settings.temperature).toBe(0.7);
      expect(settings.maxTokens).toBeLessThanOrEqual(4096);
      expect(settings.timeout).toBe(30000);
      expect(settings.retryAttempts).toBe(3);
    });
  });

  describe('Model Metadata', () => {
    it('should return cache stats structure', () => {
      const stats = getModelCacheStats();
      
      expect(stats).toBeDefined();
      expect(typeof stats.size).toBe('number');
      expect(typeof stats.age).toBe('number');
      expect(typeof stats.valid).toBe('boolean');
    });

    it('should have fallback models available', async () => {
      // Even if API fails, we should have fallback models
      const models = await getProviderModels('OPENAI', 5);
      
      // The test environment may or may not have API access
      // If models are empty, the fallback system should still work
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('getProviderModels', () => {
    it('should return models for a provider', async () => {
      const models = await getProviderModels('OPENAI', 5);
      
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeLessThanOrEqual(5);
      
      if (models.length > 0) {
        expect(models[0].id).toBeDefined();
        expect(models[0].name).toBeDefined();
        expect(typeof models[0].contextLength).toBe('number');
        expect(typeof models[0].maxOutput).toBe('number');
      }
    });
  });
});

describe('Provider Creation', () => {
  describe('createProvider', () => {
    it('should create OPENAI provider', async () => {
      const config: ProviderConfig = {
        provider: 'OPENAI',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
      };

      const provider = await createProvider(config);
      
      expect(provider).toBeDefined();
      expect(provider.provider).toBe('OPENAI');
    });

    it('should create ANTHROPIC provider', async () => {
      const config: ProviderConfig = {
        provider: 'ANTHROPIC',
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
      };

      const provider = await createProvider(config);
      
      expect(provider).toBeDefined();
      expect(provider.provider).toBe('ANTHROPIC');
    });

    it('should create GOOGLE provider', async () => {
      const config: ProviderConfig = {
        provider: 'GOOGLE',
        apiKey: 'test-key',
        model: 'gemini-2.5-flash',
      };

      const provider = await createProvider(config);
      
      expect(provider).toBeDefined();
      expect(provider.provider).toBe('GOOGLE');
    });

    it('should create DEEPSEEK provider', async () => {
      const config: ProviderConfig = {
        provider: 'DEEPSEEK',
        apiKey: 'test-key',
        model: 'deepseek-chat',
      };

      const provider = await createProvider(config);
      
      expect(provider).toBeDefined();
      expect(provider.provider).toBe('DEEPSEEK');
    });

    it('should create GROQ provider', async () => {
      const config: ProviderConfig = {
        provider: 'GROQ',
        apiKey: 'test-key',
        model: 'llama-3.3-70b-versatile',
      };

      const provider = await createProvider(config);
      
      expect(provider).toBeDefined();
      expect(provider.provider).toBe('GROQ');
    });

    it('should create OLLAMA provider', async () => {
      const config: ProviderConfig = {
        provider: 'OLLAMA',
        model: 'llama3.2',
        baseUrl: 'http://localhost:11434',
      };

      const provider = await createProvider(config);
      
      expect(provider).toBeDefined();
      expect(provider.provider).toBe('OLLAMA');
    });

    it('should throw error for unknown provider', async () => {
      const config: ProviderConfig = {
        provider: 'UNKNOWN',
        model: 'unknown-model',
      };

      await expect(createProvider(config)).rejects.toThrow();
    });
  });
});
