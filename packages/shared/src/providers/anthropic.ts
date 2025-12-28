/**
 * Anthropic Provider Adapter
 * 
 * Implementation for Anthropic Claude models (Claude 3 Opus, Sonnet, Haiku, etc.)
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

export class AnthropicProvider implements LLMProviderAdapter {
  readonly provider: string = 'ANTHROPIC';
  
  get capabilities() {
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
  
  private config: ProviderConfig;
  private stats: ProviderStats;
  private baseUrl: string = 'https://api.anthropic.com/v1';
  
  constructor(config: ProviderConfig) {
    this.config = config;
    this.stats = {
      provider: 'ANTHROPIC',
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
      const payload = this.buildPayload(request);
      const response = await this.makeRequest(payload);
      
      const latency = Date.now() - startTime;
      this.updateStats(response, latency);
      
      return response;
    } catch (error) {
      this.handleError(error, startTime);
      throw error;
    }
  }
  
  async stream(request: ChatRequest): Promise<StreamResponse> {
    // Anthropic streaming support depends on model version
    const startTime = Date.now();
    this.stats.totalRequests++;
    
    try {
      const payload = this.buildPayload(request);
      const stream = await this.makeStreamingRequest(payload);
      
      this.stats.lastUsed = new Date();
      
      return {
        id: `stream-${Date.now()}`,
        model: this.config.model,
        provider: 'ANTHROPIC',
        chunks: this.createChunkIterator(stream),
      };
    } catch (error) {
      this.handleError(error, startTime);
      throw error;
    }
  }
  
  private buildPayload(request: ChatRequest): object {
    // Anthropic uses a different message format
    const messages: Array<{ role: string; content: string }> = [];
    
    // Combine system prompt into first user message if provided
    if (request.systemPrompt) {
      messages.push({
        role: 'user',
        content: `${request.systemPrompt}\n\n${request.messages.map(m => m.content).join('\n\n')}`,
      });
    } else {
      messages.push(...request.messages.map(m => ({
        role: m.role === 'function' ? 'user' : m.role,
        content: m.content,
      })));
    }
    
    return {
      model: this.config.model,
      messages,
      max_tokens: request.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature: request.temperature ?? this.config.temperature ?? 0.7,
      stream: true, // Enable streaming
    };
  }
  
  private async makeRequest(payload: object): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey!,
        'anthropic-version': '2023-06-01',
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
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey!,
        'anthropic-version': '2023-06-01',
        'User-Agent': 'Mafia-AI-Benchmark/1.0',
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      await this.handleHttpError(response);
    }
    
    return response.body!;
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
        
        // Process complete lines
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
              // Skip incomplete chunks
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
      type: string;
      role: string;
      content: Array<{ type: string; text: string }>;
      usage: {
        input_tokens: number;
        output_tokens: number;
      };
    };
    
    const content = response.content.find(c => c.type === 'text')?.text || '';
    
    return {
      id: response.id,
      object: response.type,
      created: Date.now(),
      model: this.config.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finishReason: 'stop',
      }],
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      provider: 'ANTHROPIC',
    };
  }
  
  private parseStreamChunk(data: Record<string, unknown>): StreamChunk | null {
    const chunk = data as {
      id: string;
      type: string;
      role: string;
      content: Array<{ type: string; text: string }>;
      delta?: { type: string; text: string };
    };
    
    if (!chunk.content && !chunk.delta) {
      return null;
    }
    
    const content = chunk.content?.find(c => c.type === 'text')?.text || 
                    chunk.delta?.text || '';
    
    return {
      id: chunk.id,
      object: chunk.type,
      created: Date.now(),
      model: this.config.model,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content,
        },
        finishReason: null,
      }],
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
    
    throw new LLMError(message, code, 'ANTHROPIC', status, data);
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
      'ANTHROPIC'
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
        'ANTHROPIC',
        this.config.model,
        response.usage.promptTokens,
        response.usage.completionTokens
      );
      this.stats.totalCost += cost;
    }
  }
  
  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
  
  estimateCost(promptTokens: number, completionTokens: number): number {
    return calculateCost('ANTHROPIC', this.config.model, promptTokens, completionTokens);
  }
  
  validateConfig(): boolean {
    return !!(this.config.apiKey && this.config.model);
  }
  
  getStats(): ProviderStats {
    return { ...this.stats };
  }
  
  resetStats(): void {
    this.stats = {
      provider: 'ANTHROPIC',
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
