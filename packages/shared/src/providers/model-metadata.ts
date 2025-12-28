/**
 * Model Metadata Service
 * 
 * Dynamically fetches model capabilities from the OpenRouter API.
 * Provides caching and fallback defaults for reliability.
 */

import { ProviderCapabilities } from './index.js';

// Cache for model metadata
let modelCache: Map<string, ModelMetadata> = new Map();
let cacheTimestamp: number = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour cache

export interface ModelMetadata {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  maxOutput: number;
  pricing: {
    prompt: number;
    completion: number;
    image: number;
  };
  capabilities: {
    streaming: boolean;
    functionCalling: boolean;
    systemPrompt: boolean;
  };
  architecture: string;
  topProviders: string[];
}

export interface ModelSearchResult {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  maxOutput: number;
  capabilities: ProviderCapabilities;
}

/**
 * Fetch model metadata from API with caching
 */
export async function fetchModelMetadata(forceRefresh = false): Promise<Map<string, ModelMetadata>> {
  // Return cached data if still valid
  if (!forceRefresh && Date.now() - cacheTimestamp < CACHE_DURATION && modelCache.size > 0) {
    return modelCache;
  }
  
  try {
    const response = await fetch('https://models.dev/api.json');
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    const data = await response.json();
    
    // Parse the data structure (it's typically an array of models)
    const models = Array.isArray(data) ? data : data.data || [];
    
    // Build cache
    modelCache.clear();
    for (const model of models) {
      const metadata: ModelMetadata = {
        id: model.id || model.slug || '',
        name: model.name || model.id || '',
        provider: detectProvider(model.id || model.slug || ''),
        contextLength: model.context_length || model.contextLength || 32768,
        maxOutput: model.max_output_tokens || model.maxOutput || 4096,
        pricing: {
          prompt: model.pricing?.prompt || model.pricing?.input || 0,
          completion: model.pricing?.completion || model.pricing?.output || 0,
          image: model.pricing?.image || 0,
        },
        capabilities: {
          streaming: model.capabilities?.streaming ?? true,
          functionCalling: model.capabilities?.function_calling ?? model.capabilities?.functions ?? false,
          systemPrompt: model.capabilities?.system ?? true,
        },
        architecture: model.architecture || '',
        topProviders: model.top_providers || [],
      };
      
      modelCache.set(metadata.id, metadata);
    }
    
    cacheTimestamp = Date.now();
    console.log(`[ModelMetadata] Cached ${modelCache.size} models from API`);
    return modelCache;
  } catch (error) {
    console.warn('[ModelMetadata] Failed to fetch from API, using defaults:', error);
    return modelCache.size > 0 ? modelCache : getDefaultModels();
  }
}

/**
 * Detect provider from model ID
 */
function detectProvider(modelId: string): string {
  const modelIdLower = modelId.toLowerCase();
  
  if (modelIdLower.includes('openai') || modelIdLower.includes('gpt-')) {
    return 'OPENAI';
  }
  if (modelIdLower.includes('anthropic') || modelIdLower.includes('claude')) {
    return 'ANTHROPIC';
  }
  if (modelIdLower.includes('google') || modelIdLower.includes('gemini')) {
    return 'GOOGLE';
  }
  if (modelIdLower.includes('deepseek')) {
    return 'DEEPSEEK';
  }
  if (modelIdLower.includes('groq') || modelIdLower.includes('llama-3') || modelIdLower.includes('mixtral')) {
    return 'GROQ';
  }
  if (modelIdLower.includes('qwen') || modelIdLower.includes('qwq')) {
    return 'QWEN';
  }
  if (modelIdLower.includes('meta') || modelIdLower.includes('llama-4')) {
    return 'META';
  }
  if (modelIdLower.includes('xai') || modelIdLower.includes('grok')) {
    return 'XAI';
  }
  
  return 'CUSTOM';
}

/**
 * Get capabilities for a specific model
 */
export async function getModelCapabilities(modelId: string): Promise<ProviderCapabilities> {
  // Ensure cache is populated
  await fetchModelMetadata();
  
  const model = modelCache.get(modelId);
  if (model) {
    return {
      streaming: model.capabilities.streaming,
      functionCalling: model.capabilities.functionCalling,
      systemPrompt: model.capabilities.systemPrompt,
      maxContextLength: model.contextLength,
      maxOutputLength: model.maxOutput,
      supportsTemperature: true,
      supportsStopTokens: true,
    };
  }
  
  // Try to find by partial match
  for (const [id, model] of modelCache) {
    if (id.includes(modelId) || modelId.includes(id)) {
      return {
        streaming: model.capabilities.streaming,
        functionCalling: model.capabilities.functionCalling,
        systemPrompt: model.capabilities.systemPrompt,
        maxContextLength: model.contextLength,
        maxOutputLength: model.maxOutput,
        supportsTemperature: true,
        supportsStopTokens: true,
      };
    }
  }
  
  // Return sensible defaults
  return getDefaultCapabilities(modelId);
}

/**
 * Search for models by provider
 */
export async function searchModelsByProvider(provider: string): Promise<ModelSearchResult[]> {
  await fetchModelMetadata();
  
  const results: ModelSearchResult[] = [];
  
  for (const [id, model] of modelCache) {
    if (model.provider === provider || id.toLowerCase().includes(provider.toLowerCase())) {
      results.push({
        id: model.id,
        name: model.name,
        provider: model.provider,
        contextLength: model.contextLength,
        maxOutput: model.maxOutput,
        capabilities: {
          streaming: model.capabilities.streaming,
          functionCalling: model.capabilities.functionCalling,
          systemPrompt: model.capabilities.systemPrompt,
          maxContextLength: model.contextLength,
          maxOutputLength: model.maxOutput,
          supportsTemperature: true,
          supportsStopTokens: true,
        },
      });
    }
  }
  
  return results;
}

/**
 * Get popular models for a provider
 */
export async function getPopularModels(provider: string, limit = 5): Promise<ModelSearchResult[]> {
  const allModels = await searchModelsByProvider(provider);
  
  // Sort by context length (prefer longer context)
  allModels.sort((a, b) => b.contextLength - a.contextLength);
  
  return allModels.slice(0, limit);
}

/**
 * Default model metadata as fallback
 */
function getDefaultModels(): Map<string, ModelMetadata> {
  const defaults = new Map<string, ModelMetadata>();
  
  // Common models with sensible defaults
  const commonModels: ModelMetadata[] = [
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      provider: 'OPENAI',
      contextLength: 128000,
      maxOutput: 16384,
      pricing: { prompt: 0.00015, completion: 0.0006, image: 0 },
      capabilities: { streaming: true, functionCalling: true, systemPrompt: true },
      architecture: 'transformer',
      topProviders: ['openai'],
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'OPENAI',
      contextLength: 128000,
      maxOutput: 16384,
      pricing: { prompt: 0.005, completion: 0.015, image: 0 },
      capabilities: { streaming: true, functionCalling: true, systemPrompt: true },
      architecture: 'transformer',
      topProviders: ['openai'],
    },
    {
      id: 'claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      provider: 'ANTHROPIC',
      contextLength: 200000,
      maxOutput: 8192,
      pricing: { prompt: 0.003, completion: 0.015, image: 0 },
      capabilities: { streaming: true, functionCalling: false, systemPrompt: true },
      architecture: 'transformer',
      topProviders: ['anthropic'],
    },
    {
      id: 'claude-haiku-4-20250514',
      name: 'Claude Haiku 4',
      provider: 'ANTHROPIC',
      contextLength: 200000,
      maxOutput: 8192,
      pricing: { prompt: 0.00025, completion: 0.00125, image: 0 },
      capabilities: { streaming: true, functionCalling: false, systemPrompt: true },
      architecture: 'transformer',
      topProviders: ['anthropic'],
    },
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      provider: 'GOOGLE',
      contextLength: 1000000,
      maxOutput: 8192,
      pricing: { prompt: 0.000075, completion: 0.0003, image: 0 },
      capabilities: { streaming: true, functionCalling: true, systemPrompt: true },
      architecture: 'transformer',
      topProviders: ['google'],
    },
    {
      id: 'deepseek-chat',
      name: 'DeepSeek Chat',
      provider: 'DEEPSEEK',
      contextLength: 64000,
      maxOutput: 8192,
      pricing: { prompt: 0.00014, completion: 0.00028, image: 0 },
      capabilities: { streaming: true, functionCalling: true, systemPrompt: true },
      architecture: 'transformer',
      topProviders: ['deepseek'],
    },
    {
      id: 'llama-3.3-70b-versatile',
      name: 'Llama 3.3 70B',
      provider: 'GROQ',
      contextLength: 128000,
      maxOutput: 32768,
      pricing: { prompt: 0.00059, completion: 0.00079, image: 0 },
      capabilities: { streaming: true, functionCalling: false, systemPrompt: true },
      architecture: 'transformer',
      topProviders: ['groq'],
    },
    {
      id: 'qwen-qwq-32b',
      name: 'QwQ 32B',
      provider: 'QWEN',
      contextLength: 131072,
      maxOutput: 32768,
      pricing: { prompt: 0.00029, completion: 0.00039, image: 0 },
      capabilities: { streaming: true, functionCalling: true, systemPrompt: true },
      architecture: 'transformer',
      topProviders: ['qwen'],
    },
  ];
  
  for (const model of commonModels) {
    defaults.set(model.id, model);
  }
  
  return defaults;
}

/**
 * Default capabilities for unknown models
 */
function getDefaultCapabilities(modelId: string): ProviderCapabilities {
  // Try to infer from model ID
  const idLower = modelId.toLowerCase();
  
  if (idLower.includes('gpt-4') || idLower.includes('gpt-5')) {
    return {
      streaming: true,
      functionCalling: true,
      systemPrompt: true,
      maxContextLength: 128000,
      maxOutputLength: 16384,
      supportsTemperature: true,
      supportsStopTokens: true,
    };
  }
  
  if (idLower.includes('claude')) {
    return {
      streaming: true,
      functionCalling: false,
      systemPrompt: true,
      maxContextLength: 200000,
      maxOutputLength: 8192,
      supportsTemperature: true,
      supportsStopTokens: true,
    };
  }
  
  if (idLower.includes('gemini')) {
    return {
      streaming: true,
      functionCalling: true,
      systemPrompt: true,
      maxContextLength: 1000000,
      maxOutputLength: 8192,
      supportsTemperature: true,
      supportsStopTokens: true,
    };
  }
  
  // Generic defaults
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
 * Clear the model cache
 */
export function clearModelCache(): void {
  modelCache.clear();
  cacheTimestamp = 0;
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; age: number; valid: boolean } {
  return {
    size: modelCache.size,
    age: Date.now() - cacheTimestamp,
    valid: Date.now() - cacheTimestamp < CACHE_DURATION,
  };
}
