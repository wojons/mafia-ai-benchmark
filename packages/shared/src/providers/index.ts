/**
 * LLM Provider System
 * 
 * Unified adapter interface for LLM providers.
 * Supports dynamic model metadata fetching and fallback to defaults.
 */

import { LLMProvider } from '../types/index.js';

// Provider configuration
export interface ProviderConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

// Request types
export interface ChatRequest {
  messages: ChatMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  stop?: string[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;
}

// Response types
export interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Choice[];
  usage?: TokenUsage;
  provider: string;
}

export interface Choice {
  index: number;
  message: ChatMessage;
  finishReason: string;
  delta?: ChatMessage; // For streaming
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Streaming response
export interface StreamResponse {
  id: string;
  model: string;
  provider: string;
  chunks: AsyncIterable<StreamChunk>;
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: StreamChoice[];
}

export interface StreamChoice {
  index: number;
  delta: ChatMessage;
  finishReason: string | null;
}

// Error types
export class LLMError extends Error {
  public code: string;
  public provider: string;
  public statusCode?: number;
  public details?: unknown;

  constructor(
    message: string,
    code: string,
    provider: string,
    statusCode?: number,
    details?: unknown
  ) {
    super(message);
    this.name = 'LLMError';
    this.code = code;
    this.provider = provider;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// Provider statistics
export interface ProviderStats {
  provider: string;
  model: string;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  avgLatency: number;
  errorRate: number;
  lastUsed: Date;
}

// Provider capabilities
export interface ProviderCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  systemPrompt: boolean;
  maxContextLength: number;
  maxOutputLength: number;
  supportsTemperature: boolean;
  supportsStopTokens: boolean;
}

// Provider interface
export interface LLMProviderAdapter {
  // Provider identification
  readonly provider: string;
  readonly capabilities: ProviderCapabilities;
  
  // Configuration
  configure(config: ProviderConfig): void;
  getConfig(): ProviderConfig;
  
  // Core operations
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): Promise<StreamResponse>;
  
  // Utility
  countTokens(text: string): number;
  estimateCost(promptTokens: number, completionTokens: number): number;
  validateConfig(): boolean;
  
  // Statistics
  getStats(): ProviderStats;
  resetStats(): void;
}

// Provider factory interface
export interface ProviderFactory {
  create(config: ProviderConfig): Promise<LLMProviderAdapter>;
  getInfo(provider: string): { name: string; defaultModel: string } | undefined;
  getAvailable(): string[];
  getCapabilities(provider: string, model?: string): Promise<ProviderCapabilities>;
  getDefaultModel(provider: string): string;
  getProviderModels(provider: string, limit?: number): Promise<Array<{ id: string; name: string; contextLength: number; maxOutput: number }>>;
  validateConfig(config: ProviderConfig): { valid: boolean; errors: string[] };
  getRecommended(provider: string, model?: string): Promise<Partial<ProviderConfig>>;
  inferProvider(modelName: string): string | undefined;
  getEnvConfig(provider: string): Partial<ProviderConfig>;
  refreshModelMetadata(): Promise<void>;
  getCacheStats(): { size: number; age: number; valid: boolean };
}

// Common error codes
export const ERROR_CODES = {
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  INVALID_REQUEST: 'INVALID_REQUEST',
  SERVER_ERROR: 'SERVER_ERROR',
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  STREAMING_ERROR: 'STREAMING_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

// Utility function to create request from system + messages
export function buildMessages(
  systemPrompt: string,
  userMessages: string[]
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  
  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: systemPrompt,
    });
  }
  
  userMessages.forEach((content, index) => {
    messages.push({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content,
    });
  });
  
  return messages;
}

// Export all providers
export * from './openai.js';
export * from './anthropic.js';
export * from './google.js';
export * from './meta.js';
export * from './qwen.js';
export * from './xai.js';
export * from './deepseek.js';
export * from './groq.js';
export * from './ollama.js';
export * from './lmstudio.js';
export * from './custom.js';
export * from './factory.js';
export * from './model-metadata.js';
export * from './cost-tracking.js';
