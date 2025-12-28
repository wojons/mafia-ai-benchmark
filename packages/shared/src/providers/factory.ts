/**
 * LLM Provider Factory
 * 
 * Factory for creating LLM provider adapters with unified interface.
 * Uses dynamic model metadata for up-to-date capabilities.
 */

import { 
  ProviderConfig, 
  LLMProviderAdapter,
  LLMError,
  ERROR_CODES
} from './index.js';
import { 
  getModelCapabilities, 
  getPopularModels, 
  fetchModelMetadata,
  getCacheStats 
} from './model-metadata.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GoogleProvider } from './google.js';
import { DeepSeekProvider } from './deepseek.js';
import { GroqProvider } from './groq.js';
import { OllamaProvider } from './ollama.js';
import { LMStudioProvider } from './lmstudio.js';
import { CustomProvider } from './custom.js';
import { MetaProvider } from './meta.js';
import { QwenProvider } from './qwen.js';
import { XaiProvider } from './xai.js';

// Provider registry
const PROVIDERS: Map<string, new (config: ProviderConfig) => LLMProviderAdapter> = new Map([
  ['OPENAI', OpenAIProvider],
  ['ANTHROPIC', AnthropicProvider],
  ['GOOGLE', GoogleProvider],
  ['DEEPSEEK', DeepSeekProvider],
  ['GROQ', GroqProvider],
  ['OLLAMA', OllamaProvider],
  ['LM_STUDIO', LMStudioProvider],
  ['CUSTOM', CustomProvider],
  ['META', MetaProvider],
  ['QWEN', QwenProvider],
  ['XAI', XaiProvider],
]);

// Provider metadata (minimal, just names and defaults)
const PROVIDER_INFO: Map<string, { name: string; defaultModel: string }> = new Map([
  ['OPENAI', { name: 'OpenAI', defaultModel: 'gpt-4o-mini' }],
  ['ANTHROPIC', { name: 'Anthropic', defaultModel: 'claude-sonnet-4-20250514' }],
  ['GOOGLE', { name: 'Google', defaultModel: 'gemini-2.5-flash' }],
  ['DEEPSEEK', { name: 'DeepSeek', defaultModel: 'deepseek-chat' }],
  ['GROQ', { name: 'Groq', defaultModel: 'llama-3.3-70b-versatile' }],
  ['OLLAMA', { name: 'Ollama', defaultModel: 'llama3.2' }],
  ['LM_STUDIO', { name: 'LM Studio', defaultModel: 'llama-3.2-3b-instruct' }],
  ['CUSTOM', { name: 'Custom', defaultModel: '' }],
  ['META', { name: 'Meta', defaultModel: 'llama-4-scout' }],
  ['QWEN', { name: 'Qwen', defaultModel: 'qwen-qwq-32b' }],
  ['XAI', { name: 'xAI', defaultModel: 'grok-4' }],
]);

/**
 * Create an LLM provider adapter from configuration
 */
export async function createProvider(config: ProviderConfig): Promise<LLMProviderAdapter> {
  const ProviderClass = PROVIDERS.get(config.provider);
  
  if (!ProviderClass) {
    throw new LLMError(
      `Unknown provider: ${config.provider}`,
      ERROR_CODES.MODEL_NOT_FOUND,
      config.provider
    );
  }
  
  return new ProviderClass(config);
}

/**
 * Get provider information
 */
export function getProviderInfo(provider: string): { name: string; defaultModel: string } | undefined {
  return PROVIDER_INFO.get(provider);
}

/**
 * Get all available providers
 */
export function getAvailableProviders(): string[] {
  return Array.from(PROVIDER_INFO.keys());
}

/**
 * Get provider capabilities using dynamic model metadata
 */
export async function getProviderCapabilities(provider: string, model?: string): Promise<{
  streaming: boolean;
  functionCalling: boolean;
  systemPrompt: boolean;
  maxContextLength: number;
  maxOutputLength: number;
  supportsTemperature: boolean;
  supportsStopTokens: boolean;
}> {
  // Get the default model for this provider if not specified
  const modelId = model || PROVIDER_INFO.get(provider)?.defaultModel;
  
  if (modelId) {
    return getModelCapabilities(modelId);
  }
  
  // Fallback defaults
  return {
    streaming: true,
    functionCalling: false,
    systemPrompt: true,
    maxContextLength: 32768,
    maxOutputLength: 4096,
    supportsTemperature: true,
    supportsStopTokens: true,
  };
}

/**
 * Get default model for provider
 */
export function getDefaultModel(provider: string): string {
  return PROVIDER_INFO.get(provider)?.defaultModel || '';
}

/**
 * Get popular models for a provider
 */
export async function getProviderModels(provider: string, limit = 5): Promise<Array<{
  id: string;
  name: string;
  contextLength: number;
  maxOutput: number;
}>> {
  return getPopularModels(provider, limit);
}

/**
 * Validate provider configuration
 */
export function validateProviderConfig(config: ProviderConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!config.provider) {
    errors.push('Provider is required');
    return { valid: false, errors };
  }
  
  const info = PROVIDER_INFO.get(config.provider);
  if (!info) {
    errors.push(`Unknown provider: ${config.provider}`);
    return { valid: false, errors };
  }
  
  // Provider-specific validation
  const apiRequiredProviders = ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'DEEPSEEK', 'GROQ'];
  if (apiRequiredProviders.includes(config.provider) && !config.apiKey) {
    errors.push(`API key is required for ${info.name}`);
  }
  
  if (config.provider === 'CUSTOM' && !config.baseUrl) {
    errors.push('Base URL is required for custom provider');
  }
  
  if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
    errors.push('Temperature must be between 0 and 2');
  }
  
  if (config.maxTokens !== undefined && config.maxTokens < 1) {
    errors.push('Max tokens must be at least 1');
  }
  
  if (config.retryAttempts !== undefined && config.retryAttempts < 0) {
    errors.push('Retry attempts must be non-negative');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get recommended settings for a provider
 */
export async function getRecommendedSettings(provider: string, model?: string): Promise<Partial<ProviderConfig>> {
  const capabilities = await getProviderCapabilities(provider, model);
  
  return {
    temperature: 0.7,
    maxTokens: Math.min(capabilities.maxOutputLength, 4096),
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 1000,
  };
}

/**
 * Parse provider from model name
 */
export function inferProvider(modelName: string): string | undefined {
  const modelToProvider: Record<string, string> = {
    'gpt-': 'OPENAI',
    'claude': 'ANTHROPIC',
    'gemini': 'GOOGLE',
    'deepseek': 'DEEPSEEK',
    'llama-3': 'GROQ',
    'llama-4': 'META',
    'mixtral': 'GROQ',
    'gemma': 'GOOGLE',
    'qwen': 'QWEN',
    'qwq': 'QWEN',
    'grok': 'XAI',
  };
  
  for (const [pattern, provider] of Object.entries(modelToProvider)) {
    if (modelName.toLowerCase().includes(pattern.toLowerCase())) {
      return provider;
    }
  }
  
  return undefined;
}

/**
 * Get environment variable configuration for provider
 */
export function getEnvConfig(provider: string): Partial<ProviderConfig> {
  const envMap: Record<string, { key: string; urlEnv?: string }> = {
    OPENAI: { key: 'OPENAI_API_KEY' },
    ANTHROPIC: { key: 'ANTHROPIC_API_KEY' },
    GOOGLE: { key: 'GOOGLE_API_KEY' },
    DEEPSEEK: { key: 'DEEPSEEK_API_KEY' },
    GROQ: { key: 'GROQ_API_KEY' },
    OLLAMA: { key: 'OLLAMA_BASE_URL', urlEnv: 'OLLAMA_BASE_URL' },
    LM_STUDIO: { key: 'LM_STUDIO_BASE_URL', urlEnv: 'LM_STUDIO_BASE_URL' },
    CUSTOM: { key: 'CUSTOM_API_KEY', urlEnv: 'CUSTOM_BASE_URL' },
    META: { key: 'META_API_KEY' },
    QWEN: { key: 'QWEN_API_KEY' },
    XAI: { key: 'XAI_API_KEY' },
  };
  
  const env = envMap[provider];
  const config: Partial<ProviderConfig> = {};
  
  if (env) {
    const process = globalThis as { env?: Record<string, string> };
    const apiKey = process.env?.[env.key];
    if (apiKey) {
      config.apiKey = apiKey;
    }
    
    if (env.urlEnv) {
      const baseUrl = process.env?.[env.urlEnv];
      if (baseUrl) {
        config.baseUrl = baseUrl;
      }
    }
  }
  
  return config;
}

/**
 * Refresh model metadata from API
 */
export async function refreshModelMetadata(): Promise<void> {
  await fetchModelMetadata(true);
}

/**
 * Get model metadata cache stats
 */
export function getModelCacheStats(): { size: number; age: number; valid: boolean } {
  return getCacheStats();
}

// Export factory functions as ProviderFactory for backward compatibility
export const ProviderFactory = {
  create: createProvider,
  getInfo: getProviderInfo,
  getAvailable: getAvailableProviders,
  getCapabilities: getProviderCapabilities,
  getDefaultModel: getDefaultModel,
  getProviderModels: getProviderModels,
  validateConfig: validateProviderConfig,
  getRecommended: getRecommendedSettings,
  inferProvider: inferProvider,
  getEnvConfig: getEnvConfig,
  refreshModelMetadata: refreshModelMetadata,
  getCacheStats: getModelCacheStats,
};
