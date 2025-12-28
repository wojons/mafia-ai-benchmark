/**
 * Model Metadata Service
 * 
 * Dynamically fetches model capabilities and pricing from the models.dev API.
 * Provides caching and fallback defaults for reliability.
 * Pricing is in $/million tokens (standard format from API).
 * 
 * IMPORTANT: Pricing is fetched ONLY from models.dev API.
 * If a model is not found in the API, its price is set to NO_PRICING_MARKER (-6.66).
 */

import { ProviderCapabilities } from './index.js';

// Marker for models without pricing data
export const NO_PRICING_MARKER = -6.66;

// Cache for model metadata and pricing
let modelCache: Map<string, ModelMetadata> = new Map();
let pricingCache: Map<string, ModelPricing> = new Map();
let cacheTimestamp: number = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour cache

export interface ModelPricing {
  inputPerMillion: number;  // $/million input tokens (0 if NO_PRICING_MARKER)
  outputPerMillion: number; // $/million output tokens (0 if NO_PRICING_MARKER)
  cacheReadPerMillion?: number; // $/million cache read tokens
  hasPricing: boolean;
  isMissingPricing: boolean; // true if price was not in API
}

export interface ModelMetadata {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  maxOutput: number;
  pricing: ModelPricing;
  capabilities: {
    streaming: boolean;
    functionCalling: boolean;
    systemPrompt: boolean;
  };
  architecture: string;
  topProviders: string[];
  releaseDate?: string;
}

export interface ModelSearchResult {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  maxOutput: number;
  capabilities: ProviderCapabilities;
  pricing?: ModelPricing;
}

// Popular models to prioritize (these are commonly used)
const POPULAR_MODEL_IDS = [
  // OpenAI
  'gpt-4o-mini', 'gpt-4o', 'gpt-4o-2024-08-06', 'gpt-4o-2024-11-20',
  'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'gpt-5-nano', 'gpt-5-mini',
  // Anthropic  
  'claude-sonnet-4-20250514', 'claude-haiku-4-20250514', 'claude-3-5-sonnet-20241022',
  'claude-3-haiku-20240307', 'claude-3-5-haiku-latest',
  // Google
  'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro',
  'gemini-2.0-flash', 'gemini-flash-latest',
  // Groq
  'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-70b-8192',
  'llama3-8b-8192', 'qwen-qwq-32b', 'deepseek-r1-distill-llama-70b',
  // DeepSeek
  'deepseek-chat', 'deepseek-reasoner',
  // xAI
  'grok-3', 'grok-2', 'grok-3-fast', 'grok-2-latest',
  // Other popular
  'moonshotai/kimi-k2-instruct', 'qwen/qwen3-32b',
];

// Provider display names
const PROVIDER_NAMES: Record<string, string> = {
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'google': 'Google',
  'groq': 'Groq',
  'deepseek': 'DeepSeek',
  'xai': 'xAI',
  'meta': 'Meta',
  'qwen': 'Qwen',
  'moonshotai': 'Moonshot AI',
};

/**
 * Fetch model metadata from models.dev API with caching
 * API structure: { providerId: { models: { modelId: { cost: { input, output }, limit: { context, output } } } } }
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
    
    // Parse provider-based structure
    // API format: { "providerId": { "models": { "modelId": { "cost": {...}, "limit": {...} } } } }
    modelCache.clear();
    pricingCache.clear();
    
    for (const [providerId, providerData] of Object.entries(data as Record<string, any>)) {
      if (!providerData?.models) continue;
      
      const providerName = PROVIDER_NAMES[providerId] || providerId;
      
      for (const [modelId, modelDataRecord] of Object.entries(providerData.models)) {
        // Type assertion for model data
        const modelData = modelDataRecord as {
          cost?: { input?: number; output?: number; cache_read?: number };
          limit?: { context?: number; output?: number };
          name?: string;
          temperature?: boolean;
          tool_call?: boolean;
          family?: string;
          release_date?: string;
        };
        
        // Extract pricing
        const cost = modelData.cost || {};
        const pricing: ModelPricing = {
          inputPerMillion: cost.input || 0,
          outputPerMillion: cost.output || 0,
          cacheReadPerMillion: cost.cache_read,
          hasPricing: cost.input !== undefined || cost.output !== undefined,
        };
        
        // Extract limits
        const limit = modelData.limit || {};
        const contextLength = limit.context || 32768;
        const maxOutput = limit.output || 4096;
        
        // Build model metadata
        const metadata: ModelMetadata = {
          id: modelId,
          name: modelData.name || modelId,
          provider: providerName,
          contextLength,
          maxOutput,
          pricing,
          capabilities: {
            streaming: modelData.temperature ?? true,
            functionCalling: modelData.tool_call ?? modelData.tool_call ?? false,
            systemPrompt: true, // Most providers support system prompts
          },
          architecture: modelData.family || '',
          topProviders: [providerId],
          releaseDate: modelData.release_date,
        };
        
        modelCache.set(modelId, metadata);
        pricingCache.set(modelId, pricing);
      }
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
 * Get pricing for a specific model
 * Returns NO_PRICING_MARKER (-6.66) if price not found in API
 */
export async function getModelPricing(modelId: string): Promise<ModelPricing> {
  // Ensure cache is populated
  await fetchModelMetadata();
  
  // Try exact match first
  if (pricingCache.has(modelId)) {
    return pricingCache.get(modelId)!;
  }
  
  // Try to find by partial match
  for (const [id, pricing] of pricingCache) {
    if (id.includes(modelId) || modelId.includes(id)) {
      return pricing;
    }
  }
  
  // Return NO_PRICING_MARKER - no pricing available
  return {
    inputPerMillion: 0,
    outputPerMillion: 0,
    hasPricing: false,
    isMissingPricing: true,
  };
}

/**
 * Calculate cost for a request
 * @param modelId - The model ID
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @returns Cost details
 */
export function calculateCost(
  modelId: string, 
  inputTokens: number, 
  outputTokens: number
): { cost: number; pricing: ModelPricing; formatted: string } {
  const pricing = pricingCache.get(modelId);
  
  if (!pricing?.hasPricing) {
    return {
      cost: 0,
      pricing: {
        modelId,
        inputPerMillion: -6.66,
        outputPerMillion: -6.66,
        hasPricing: false,
        isMissingPricing: true,
        noPricingMarker: -6.66,
      },
      formatted: 'No pricing data available',
    };
  }
  
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const totalCost = inputCost + outputCost;
  
  const formatted = totalCost < 0.01 
    ? `$${(totalCost * 1000).toFixed(4)} (${inputTokens} in, ${outputTokens} out)`
    : `$${totalCost.toFixed(4)} (${inputTokens} in, ${outputTokens} out)`;
  
  return {
    cost: totalCost,
    pricing,
    formatted,
  };
}

/**
 * Get cost estimate for a model (no API call, uses cache)
 */
export function getCachedCostEstimate(
  modelId: string, 
  inputTokens: number, 
  outputTokens: number
): { cost: number; formatted: string; hasPricing: boolean } {
  const pricing = pricingCache.get(modelId);
  
  if (!pricing?.hasPricing) {
    return {
      cost: 0,
      formatted: 'No pricing data',
      hasPricing: false,
    };
  }
  
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const totalCost = inputCost + outputCost;
  
  const formatted = totalCost < 0.01 
    ? `$${(totalCost * 1000).toFixed(4)}`
    : `$${totalCost.toFixed(4)}`;
  
  return {
    cost: totalCost,
    formatted,
    hasPricing: true,
  };
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
 * Get popular models (filtered list of commonly used models)
 */
export async function getPopularModels(provider?: string, limit = 10): Promise<ModelSearchResult[]> {
  await fetchModelMetadata();
  
  const results: ModelSearchResult[] = [];
  
  for (const modelId of POPULAR_MODEL_IDS) {
    const model = modelCache.get(modelId);
    if (!model) continue;
    
    // Filter by provider if specified
    if (provider && !model.provider.toLowerCase().includes(provider.toLowerCase())) {
      continue;
    }
    
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
      pricing: model.pricing,
    });
    
    if (results.length >= limit) break;
  }
  
  return results;
}

/**
 * Search for models by provider
 */
export async function searchModelsByProvider(provider: string): Promise<ModelSearchResult[]> {
  await fetchModelMetadata();
  
  const results: ModelSearchResult[] = [];
  const providerLower = provider.toLowerCase();
  
  for (const [id, model] of modelCache) {
    if (model.provider.toLowerCase().includes(providerLower)) {
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
        pricing: model.pricing,
      });
    }
  }
  
  return results;
}

/**
 * Default model metadata as fallback
 * IMPORTANT: Uses NO_PRICING_MARKER (-6.66) for models without API pricing
 * This ensures we don't fall back to static prices - only API prices are trusted
 */
function getDefaultModels(): Map<string, ModelMetadata> {
  const defaults = new Map<string, ModelMetadata>();
  
  // Only include a minimal set - these should all be fetched from API in practice
  // If they're not in the API, they'll have NO_PRICING_MARKER
  const minimalModels: ModelMetadata[] = [
    {
      id: 'unknown-model',
      name: 'Unknown Model',
      provider: 'Unknown',
      contextLength: 32768,
      maxOutput: 4096,
      pricing: { 
        inputPerMillion: 0, 
        outputPerMillion: 0, 
        hasPricing: false,
        isMissingPricing: true,
      },
      capabilities: { streaming: true, functionCalling: false, systemPrompt: true },
      architecture: 'transformer',
      topProviders: [],
    },
  ];
  
  for (const model of minimalModels) {
    defaults.set(model.id, model);
    pricingCache.set(model.id, model.pricing);
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
  pricingCache.clear();
  cacheTimestamp = 0;
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; age: number; valid: boolean; pricingCount: number } {
  return {
    size: modelCache.size,
    age: Date.now() - cacheTimestamp,
    valid: Date.now() - cacheTimestamp < CACHE_DURATION,
    pricingCount: pricingCache.size,
  };
}

/**
 * Get all cached models
 */
export function getAllCachedModels(): ModelMetadata[] {
  return Array.from(modelCache.values());
}

/**
 * Get models by provider
 */
export function getModelsByProvider(provider: string): ModelMetadata[] {
  const providerLower = provider.toLowerCase();
  return Array.from(modelCache.values()).filter(
    m => m.provider.toLowerCase().includes(providerLower)
  );
}
