/**
 * Factory Unit Tests
 *
 * Tests for provider factory functions: createProvider, getProviderInfo,
 * getAvailableProviders, validateProviderConfig, inferProvider, getEnvConfig,
 * getDefaultModel, getRecommendedSettings, ProviderFactory namespace.
 */

import { describe, it, expect } from 'vitest';
import {
  createProvider,
  getProviderInfo,
  getAvailableProviders,
  validateProviderConfig,
  inferProvider,
  getEnvConfig,
  getDefaultModel,
  getRecommendedSettings,
  getProviderCapabilities,
  getProviderModels,
  refreshModelMetadata,
  getModelCacheStats,
  ProviderFactory,
  ProviderConfig,
} from '../../providers/index.js';

describe('Factory Functions', () => {
  describe('getAvailableProviders', () => {
    it('should return all 11 providers', () => {
      const providers = getAvailableProviders();
      expect(providers).toContain('OPENAI');
      expect(providers).toContain('ANTHROPIC');
      expect(providers).toContain('GOOGLE');
      expect(providers).toContain('DEEPSEEK');
      expect(providers).toContain('GROQ');
      expect(providers).toContain('OLLAMA');
      expect(providers).toContain('LM_STUDIO');
      expect(providers).toContain('CUSTOM');
      expect(providers).toContain('META');
      expect(providers).toContain('QWEN');
      expect(providers).toContain('XAI');
      expect(providers.length).toBe(11);
    });
  });

  describe('getProviderInfo', () => {
    it('should return info for OPENAI', () => {
      const info = getProviderInfo('OPENAI');
      expect(info).toBeDefined();
      expect(info?.name).toBe('OpenAI');
      expect(info?.defaultModel).toBe('gpt-4o-mini');
    });

    it('should return info for ANTHROPIC', () => {
      const info = getProviderInfo('ANTHROPIC');
      expect(info?.name).toBe('Anthropic');
      expect(info?.defaultModel).toBe('claude-sonnet-4-20250514');
    });

    it('should return undefined for unknown provider', () => {
      expect(getProviderInfo('UNKNOWN')).toBeUndefined();
    });
  });

  describe('getDefaultModel', () => {
    it('should return correct defaults', () => {
      expect(getDefaultModel('OPENAI')).toBe('gpt-4o-mini');
      expect(getDefaultModel('ANTHROPIC')).toContain('claude');
      expect(getDefaultModel('GOOGLE')).toContain('gemini');
      expect(getDefaultModel('DEEPSEEK')).toBe('deepseek-chat');
      expect(getDefaultModel('GROQ')).toContain('llama');
      expect(getDefaultModel('OLLAMA')).toBe('llama3.2');
      expect(getDefaultModel('LM_STUDIO')).toContain('llama');
      expect(getDefaultModel('CUSTOM')).toBe('');
      expect(getDefaultModel('META')).toContain('llama');
      expect(getDefaultModel('QWEN')).toContain('qwen');
      expect(getDefaultModel('XAI')).toContain('grok');
    });

    it('should return empty string for unknown provider', () => {
      expect(getDefaultModel('UNKNOWN')).toBe('');
    });
  });

  describe('validateProviderConfig', () => {
    it('should validate correct OPENAI config', () => {
      const result = validateProviderConfig({
        provider: 'OPENAI',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject empty provider string', () => {
      const result = validateProviderConfig({
        provider: '',
        apiKey: 'test',
        model: 'test',
      } as ProviderConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Provider is required');
    });

    it('should reject missing provider field', () => {
      const result = validateProviderConfig({
        apiKey: 'test',
        model: 'test',
      } as ProviderConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Provider is required');
    });

    it('should reject unknown provider', () => {
      const result = validateProviderConfig({
        provider: 'NONEXISTENT',
        apiKey: 'test',
        model: 'test',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown provider'))).toBe(true);
    });

    it('should require API key for OPENAI', () => {
      const result = validateProviderConfig({
        provider: 'OPENAI',
        model: 'gpt-4o-mini',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('API key'))).toBe(true);
    });

    it('should require API key for ANTHROPIC', () => {
      const result = validateProviderConfig({
        provider: 'ANTHROPIC',
        model: 'claude-sonnet-4-20250514',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('API key'))).toBe(true);
    });

    it('should require API key for GOOGLE', () => {
      const result = validateProviderConfig({
        provider: 'GOOGLE',
        model: 'gemini-2.5-flash',
      });
      expect(result.valid).toBe(false);
    });

    it('should require API key for DEEPSEEK', () => {
      const result = validateProviderConfig({
        provider: 'DEEPSEEK',
        model: 'deepseek-chat',
      });
      expect(result.valid).toBe(false);
    });

    it('should require API key for GROQ', () => {
      const result = validateProviderConfig({
        provider: 'GROQ',
        model: 'llama-3.3-70b-versatile',
      });
      expect(result.valid).toBe(false);
    });

    it('should NOT require API key for OLLAMA', () => {
      const result = validateProviderConfig({
        provider: 'OLLAMA',
        model: 'llama3.2',
      });
      expect(result.valid).toBe(true);
    });

    it('should NOT require API key for LM_STUDIO', () => {
      const result = validateProviderConfig({
        provider: 'LM_STUDIO',
        model: 'test-model',
      });
      expect(result.valid).toBe(true);
    });

    it('should require baseUrl for CUSTOM', () => {
      const result = validateProviderConfig({
        provider: 'CUSTOM',
        model: 'custom-model',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Base URL'))).toBe(true);
    });

    it('should accept CUSTOM with baseUrl and no API key', () => {
      const result = validateProviderConfig({
        provider: 'CUSTOM',
        model: 'custom-model',
        baseUrl: 'https://custom.api.com',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject temperature > 2', () => {
      const result = validateProviderConfig({
        provider: 'OPENAI',
        apiKey: 'test',
        model: 'gpt-4',
        temperature: 2.1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Temperature'))).toBe(true);
    });

    it('should accept temperature at 2.0', () => {
      const result = validateProviderConfig({
        provider: 'OPENAI',
        apiKey: 'test',
        model: 'gpt-4',
        temperature: 2.0,
      });
      expect(result.valid).toBe(true);
    });

    it('should accept temperature at 0', () => {
      const result = validateProviderConfig({
        provider: 'OPENAI',
        apiKey: 'test',
        model: 'gpt-4',
        temperature: 0,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject negative temperature', () => {
      const result = validateProviderConfig({
        provider: 'OPENAI',
        apiKey: 'test',
        model: 'gpt-4',
        temperature: -0.1,
      });
      expect(result.valid).toBe(false);
    });

    it('should reject maxTokens < 1', () => {
      const result = validateProviderConfig({
        provider: 'OPENAI',
        apiKey: 'test',
        model: 'gpt-4',
        maxTokens: 0,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Max tokens'))).toBe(true);
    });

    it('should reject negative maxTokens', () => {
      const result = validateProviderConfig({
        provider: 'OPENAI',
        apiKey: 'test',
        model: 'gpt-4',
        maxTokens: -1,
      });
      expect(result.valid).toBe(false);
    });

    it('should accept maxTokens at 1', () => {
      const result = validateProviderConfig({
        provider: 'OPENAI',
        apiKey: 'test',
        model: 'gpt-4',
        maxTokens: 1,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject negative retryAttempts', () => {
      const result = validateProviderConfig({
        provider: 'OPENAI',
        apiKey: 'test',
        model: 'gpt-4',
        retryAttempts: -1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Retry attempts'))).toBe(true);
    });

    it('should accept retryAttempts at 0', () => {
      const result = validateProviderConfig({
        provider: 'OPENAI',
        apiKey: 'test',
        model: 'gpt-4',
        retryAttempts: 0,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('inferProvider', () => {
    it('should infer OPENAI from gpt- models', () => {
      expect(inferProvider('gpt-4o')).toBe('OPENAI');
      expect(inferProvider('gpt-3.5-turbo')).toBe('OPENAI');
      expect(inferProvider('gpt-4o-mini')).toBe('OPENAI');
      expect(inferProvider('gpt-5-nano')).toBe('OPENAI');
    });

    it('should infer ANTHROPIC from claude models', () => {
      expect(inferProvider('claude-3-opus')).toBe('ANTHROPIC');
      expect(inferProvider('claude-sonnet-4')).toBe('ANTHROPIC');
      expect(inferProvider('claude-haiku')).toBe('ANTHROPIC');
    });

    it('should infer GOOGLE from gemini/gemma models', () => {
      expect(inferProvider('gemini-2.5-flash')).toBe('GOOGLE');
      expect(inferProvider('gemini-1.5-pro')).toBe('GOOGLE');
      expect(inferProvider('gemma-7b')).toBe('GOOGLE');
    });

    it('should infer DEEPSEEK from deepseek models', () => {
      expect(inferProvider('deepseek-chat')).toBe('DEEPSEEK');
      expect(inferProvider('deepseek-reasoner')).toBe('DEEPSEEK');
    });

    it('should infer GROQ from llama-3/mixtral models', () => {
      expect(inferProvider('llama-3.3-70b')).toBe('GROQ');
      expect(inferProvider('llama-3.1-8b')).toBe('GROQ');
      expect(inferProvider('mixtral-8x7b')).toBe('GROQ');
    });

    it('should infer META from llama-4 models', () => {
      expect(inferProvider('llama-4-scout')).toBe('META');
      expect(inferProvider('llama-4-maverick')).toBe('META');
    });

    it('should infer QWEN from qwen models', () => {
      expect(inferProvider('qwen-72b')).toBe('QWEN');
      expect(inferProvider('qwq-32b')).toBe('QWEN');
    });

    it('should infer XAI from grok models', () => {
      expect(inferProvider('grok-3')).toBe('XAI');
      expect(inferProvider('grok-2-latest')).toBe('XAI');
    });

    it('should return undefined for unknown models', () => {
      expect(inferProvider('unknown-model')).toBeUndefined();
      expect(inferProvider('random-text')).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      expect(inferProvider('GPT-4')).toBe('OPENAI');
      expect(inferProvider('Claude-3')).toBe('ANTHROPIC');
      expect(inferProvider('GEMINI-flash')).toBe('GOOGLE');
    });
  });

  describe('getEnvConfig', () => {
    it('should return empty config for unknown provider', () => {
      const config = getEnvConfig('UNKNOWN');
      expect(config).toEqual({});
    });

    it('should return key and urlEnv for OLLAMA', () => {
      const config = getEnvConfig('OLLAMA');
      // Returns empty unless environment variables are set
      expect(typeof config).toBe('object');
    });

    it('should return key for OPENAI', () => {
      const config = getEnvConfig('OPENAI');
      expect(typeof config).toBe('object');
    });
  });

  describe('createProvider', () => {
    it('should create OPENAI provider', async () => {
      const provider = await createProvider({
        provider: 'OPENAI',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
      });
      expect(provider.provider).toBe('OPENAI');
      expect(provider.capabilities).toBeDefined();
    });

    it('should create ANTHROPIC provider', async () => {
      const provider = await createProvider({
        provider: 'ANTHROPIC',
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
      });
      expect(provider.provider).toBe('ANTHROPIC');
    });

    it('should create GOOGLE provider', async () => {
      const provider = await createProvider({
        provider: 'GOOGLE',
        apiKey: 'test-key',
        model: 'gemini-2.5-flash',
      });
      expect(provider.provider).toBe('GOOGLE');
    });

    it('should create DEEPSEEK provider', async () => {
      const provider = await createProvider({
        provider: 'DEEPSEEK',
        apiKey: 'test-key',
        model: 'deepseek-chat',
      });
      expect(provider.provider).toBe('DEEPSEEK');
    });

    it('should create GROQ provider', async () => {
      const provider = await createProvider({
        provider: 'GROQ',
        apiKey: 'test-key',
        model: 'llama-3.3-70b-versatile',
      });
      expect(provider.provider).toBe('GROQ');
    });

    it('should create OLLAMA provider', async () => {
      const provider = await createProvider({
        provider: 'OLLAMA',
        model: 'llama3.2',
      });
      expect(provider.provider).toBe('OLLAMA');
    });

    it('should create LM_STUDIO provider', async () => {
      const provider = await createProvider({
        provider: 'LM_STUDIO',
        model: 'llama-3.2-3b-instruct',
      });
      expect(provider.provider).toBe('LM_STUDIO');
    });

    it('should create CUSTOM provider', async () => {
      const provider = await createProvider({
        provider: 'CUSTOM',
        model: 'test-model',
        baseUrl: 'https://custom.api.com',
      });
      expect(provider.provider).toBe('CUSTOM');
    });

    it('should create META provider', async () => {
      const provider = await createProvider({
        provider: 'META',
        apiKey: 'test-key',
        model: 'llama-4-scout',
      });
      expect(provider.provider).toBe('META');
    });

    it('should create QWEN provider', async () => {
      const provider = await createProvider({
        provider: 'QWEN',
        apiKey: 'test-key',
        model: 'qwen-qwq-32b',
      });
      expect(provider.provider).toBe('QWEN');
    });

    it('should create XAI provider', async () => {
      const provider = await createProvider({
        provider: 'XAI',
        apiKey: 'test-key',
        model: 'grok-4',
      });
      expect(provider.provider).toBe('XAI');
    });

    it('should throw for unknown provider', async () => {
      await expect(createProvider({
        provider: 'UNKNOWN',
        model: 'test',
      })).rejects.toThrow();
    });

    it('should throw with MODEL_NOT_FOUND code for unknown provider', async () => {
      try {
        await createProvider({ provider: 'NONEXISTENT', model: 'test' });
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe('MODEL_NOT_FOUND');
      }
    });
  });

  describe('getRecommendedSettings', () => {
    it('should return sensible defaults for OPENAI', async () => {
      const settings = await getRecommendedSettings('OPENAI', 'gpt-4o-mini');
      expect(settings.temperature).toBe(0.7);
      expect(settings.maxTokens).toBeLessThanOrEqual(4096);
      expect(settings.timeout).toBe(30000);
      expect(settings.retryAttempts).toBe(3);
      expect(settings.retryDelay).toBe(1000);
    });
  });

  describe('getProviderCapabilities', () => {
    it('should return fallback for unknown provider', async () => {
      const caps = await getProviderCapabilities('UNKNOWN');
      expect(caps.streaming).toBe(true);
      expect(caps.maxContextLength).toBe(32768);
      expect(caps.maxOutputLength).toBe(4096);
    });
  });
});

describe('ProviderFactory namespace', () => {
  it('should expose create as a function', () => {
    expect(typeof ProviderFactory.create).toBe('function');
  });

  it('should expose getInfo as a function', () => {
    expect(typeof ProviderFactory.getInfo).toBe('function');
  });

  it('should expose getAvailable as a function', () => {
    expect(typeof ProviderFactory.getAvailable).toBe('function');
  });

  it('should expose getCapabilities as a function', () => {
    expect(typeof ProviderFactory.getCapabilities).toBe('function');
  });

  it('should expose getDefaultModel as a function', () => {
    expect(typeof ProviderFactory.getDefaultModel).toBe('function');
  });

  it('should expose validateConfig as a function', () => {
    expect(typeof ProviderFactory.validateConfig).toBe('function');
  });

  it('should expose inferProvider as a function', () => {
    expect(typeof ProviderFactory.inferProvider).toBe('function');
  });

  it('should expose getEnvConfig as a function', () => {
    expect(typeof ProviderFactory.getEnvConfig).toBe('function');
  });

  it('should expose getCacheStats as a function', () => {
    expect(typeof ProviderFactory.getCacheStats).toBe('function');
  });

  it('ProviderFactory.create should work same as createProvider', async () => {
    const provider = await ProviderFactory.create({
      provider: 'OPENAI',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    });
    expect(provider.provider).toBe('OPENAI');
  });

  it('ProviderFactory.getAvailable should return providers', () => {
    const providers = ProviderFactory.getAvailable();
    expect(providers).toContain('OPENAI');
  });

  it('ProviderFactory.getInfo should return info', () => {
    const info = ProviderFactory.getInfo('OPENAI');
    expect(info?.name).toBe('OpenAI');
  });
});
