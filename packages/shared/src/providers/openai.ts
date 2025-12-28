/**
 * OpenAI Provider Adapter
 * 
 * Implementation for OpenAI models (GPT-4, GPT-3.5-Turbo, etc.)
 */

import { 
  LLMProviderAdapter, 
  ProviderConfig, 
  ChatRequest, 
  ChatResponse, 
  ChatMessage,
  StreamResponse,
  StreamChunk,
  ProviderStats,
  LLMError,
  ERROR_CODES,
  calculateCost
} from './index.js';

export class OpenAIProvider implements LLMProviderAdapter {
  readonly provider: string = 'OPENAI';
  
  get capabilities() {
    return {
      streaming: true,
      functionCalling: true,
      systemPrompt: true,
      maxContextLength: 128000,
      maxOutputLength: 4096,
      supportsTemperature: true,
      supportsStopTokens: true,
    };
  }
  
  private config: ProviderConfig;
  private stats: ProviderStats;
  private baseUrl: string = 'https://api.openai.com/v1';
  
  constructor(config: ProviderConfig) {
    this.config = config;
    this.stats = {
      provider: 'OPENAI',
      model: config.model,
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      avgLatency: 0,
      errorRate: 0,
      lastUsed: new Date(),
    };
  }
  
  configure(config: ProviderConfig): void {
    this.config = { ...this.config, ...config };
  }
  
  getConfig(): ProviderConfig {
    return { ...this.config };
  }
  
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    this.stats.totalRequests++;
    
    try {
      // Build request payload
      const payload = this.buildPayload(request);
      
      // Make API call
      const response = await this.makeRequest(payload);
      
      // Update stats
      const latency = Date.now() - startTime;
      this.updateStats(response, latency);
      
      return response;
    } catch (error) {
      this.handleError(error, startTime);
      throw error;
    }
  }
  
  async stream(request: ChatRequest): Promise<StreamResponse> {
    const startTime = Date.now();
    this.stats.totalRequests++;
    
    try {
      const payload = this.buildPayload(request, true);
      
      const response = await this.makeStreamingRequest(payload);
      
      this.stats.lastUsed = new Date();
      
      return {
        id: `stream-${Date.now()}`,
        model: this.config.model,
        provider: 'OPENAI',
        chunks: this.createChunkIterator(response),
      };
    } catch (error) {
      this.handleError(error, startTime);
      throw error;
    }
  }
  
  private buildPayload(request: ChatRequest, streaming: boolean = false): object {
    const messages: ChatMessage[] = [];
    
    // Add system prompt if provided
    if (request.systemPrompt) {
      messages.push({
        role: 'system',
        content: request.systemPrompt,
      });
    }
    
    // Add user messages
    messages.push(...request.messages);
    
    const payload: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: request.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? this.config.maxTokens ?? 2000,
      stream: streaming,
    };
    
    if (request.stop) {
      payload.stop = request.stop;
    }
    
    return payload;
  }
  
  private async makeRequest(payload: object): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'User-Agent': 'Mafia-AI-Benchmark/1.0',
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      await this.handleHttpError(response);
    }
    
    const data = await response.json();
    
    return this.parseResponse(data);
  }
  
  private async makeStreamingRequest(payload: object): Promise<ReadableStream> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'User-Agent': 'Mafia-AI-Benchmark/1.0',
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      await this.handleHttpError(response);
    }
    
    if (!response.body) {
      throw new LLMError(
        'No response body',
        ERROR_CODES.STREAMING_ERROR,
        'OPENAI'
      );
    }
    
    return response.body;
  }
  
  private async *createChunkIterator(stream: ReadableStream): AsyncGenerator<StreamChunk> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              return;
            }
            
            try {
              const chunk = JSON.parse(data);
              const streamChunk = this.parseStreamChunk(chunk);
              
              if (streamChunk) {
                yield streamChunk;
              }
            } catch {
              // Ignore parsing errors for incomplete chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  
  private parseResponse(data: Record<string, unknown>): ChatResponse {
    const response = data as {
      id: string;
      object: string;
      created: number;
      model: string;
      choices: Array<{
        index: number;
        message: {
          role: string;
          content: string;
        };
        finish_reason: string;
      }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };
    
    const choices = response.choices.map((choice, index) => ({
      index,
      message: {
        role: choice.message.role as 'system' | 'user' | 'assistant' | 'function',
        content: choice.message.content,
      },
      finishReason: choice.finish_reason,
    }));
    
    return {
      id: response.id,
      object: response.object,
      created: response.created,
      model: response.model,
      choices,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      provider: 'OPENAI',
    };
  }
  
  private parseStreamChunk(data: Record<string, unknown>): StreamChunk | null {
    const chunk = data as {
      id: string;
      object: string;
      created: number;
      model: string;
      choices: Array<{
        index: number;
        delta: {
          role?: string;
          content?: string;
        };
        finish_reason: string | null;
      }>;
    };
    
    if (!chunk.choices || chunk.choices.length === 0) {
      return null;
    }
    
    return {
      id: chunk.id,
      object: chunk.object,
      created: chunk.created,
      model: chunk.model,
      choices: chunk.choices.map((choice, index) => ({
        index,
        delta: {
          role: choice.delta.role as 'system' | 'user' | 'assistant' | 'function',
          content: choice.delta.content || '',
        },
        finishReason: choice.finish_reason,
      })),
    };
  }
  
  private async handleHttpError(response: Response): Promise<void> {
    const status = response.status;
    const data = await response.json().catch(() => ({}));
    
    let code = ERROR_CODES.SERVER_ERROR;
    let message = `HTTP ${status}: ${response.statusText}`;
    
    if (data.error) {
      const error = data.error as { type?: string; message?: string };
      message = error.message || message;
      
      if (status === 401) {
        code = ERROR_CODES.AUTHENTICATION_FAILED;
      } else if (status === 429) {
        code = ERROR_CODES.RATE_LIMITED;
      } else if (status === 400) {
        code = ERROR_CODES.INVALID_REQUEST;
      }
    }
    
    throw new LLMError(
      message,
      code,
      'OPENAI',
      status,
      data
    );
  }
  
  private handleError(error: unknown, startTime: number): void {
    const latency = Date.now() - startTime;
    
    this.stats.avgLatency = 
      (this.stats.avgLatency * (this.stats.totalRequests - 1) + latency) / 
      this.stats.totalRequests;
    
    this.stats.errorRate = 
      (this.stats.errorRate * (this.stats.totalRequests - 1) + 1) / 
      this.stats.totalRequests;
    
    if (error instanceof LLMError) {
      throw error;
    }
    
    throw new LLMError(
      error instanceof Error ? error.message : 'Unknown error',
      ERROR_CODES.UNKNOWN_ERROR,
      'OPENAI'
    );
  }
  
  private updateStats(response: ChatResponse, latency: number): void {
    this.stats.lastUsed = new Date();
    
    this.stats.avgLatency = 
      (this.stats.avgLatency * (this.stats.totalRequests - 1) + latency) / 
      this.stats.totalRequests;
    
    if (response.usage) {
      this.stats.totalTokens += response.usage.totalTokens;
      
      const cost = calculateCost(
        'OPENAI',
        this.config.model,
        response.usage.promptTokens,
        response.usage.completionTokens
      );
      this.stats.totalCost += cost;
    }
  }
  
  countTokens(text: string): number {
    // Rough estimate: 4 characters per token on average
    return Math.ceil(text.length / 4);
  }
  
  estimateCost(promptTokens: number, completionTokens: number): number {
    return calculateCost('OPENAI', this.config.model, promptTokens, completionTokens);
  }
  
  validateConfig(): boolean {
    if (!this.config.apiKey) {
      return false;
    }
    
    if (!this.config.model) {
      return false;
    }
    
    return true;
  }
  
  getStats(): ProviderStats {
    return { ...this.stats };
  }
  
  resetStats(): void {
    this.stats = {
      provider: 'OPENAI',
      model: this.config.model,
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      avgLatency: 0,
      errorRate: 0,
      lastUsed: new Date(),
    };
  }
}
