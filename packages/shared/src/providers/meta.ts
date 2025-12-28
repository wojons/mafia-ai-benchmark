/**
 * Meta (Llama) Provider Adapter
 * 
 * Implementation for Meta's Llama models (Llama 4 Scout, etc.)
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

export class MetaProvider implements LLMProviderAdapter {
  readonly provider: string = 'META';
  
  get capabilities() {
    return {
      streaming: true,
      functionCalling: false,
      systemPrompt: true,
      maxContextLength: 128000,
      maxOutputLength: 4096,
      supportsTemperature: true,
      supportsStopTokens: true,
    };
  }
  
  private config: ProviderConfig;
  private stats: ProviderStats;
  private baseUrl: string;
  
  constructor(config: ProviderConfig) {
    this.config = config;
    // Meta uses different endpoints depending on deployment (Ollama, LM Studio, or direct API)
    this.baseUrl = config.baseUrl || 'https://api.meta.ai/v1';
    
    this.stats = {
      provider: 'META',
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
    const startTime = Date.now();
    this.stats.totalRequests++;
    
    try {
      const payload = this.buildPayload(request, true);
      const stream = await this.makeStreamingRequest(payload);
      
      this.stats.lastUsed = new Date();
      
      return {
        id: `stream-${Date.now()}`,
        model: this.config.model,
        provider: 'META',
        chunks: this.createChunkIterator(stream),
      };
    } catch (error) {
      this.handleError(error, startTime);
      throw error;
    }
  }
  
  private buildPayload(request: ChatRequest, streaming: boolean = false): object {
    const messages: Array<{ role: string; content: string }> = [];
    
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    
    messages.push(...request.messages.map(m => ({
      role: m.role,
      content: m.content,
    })));
    
    return {
      model: this.config.model,
      messages,
      temperature: request.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? this.config.maxTokens ?? 8192,
      stream,
    };
  }
  
  private async makeRequest(payload: object): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
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
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      await this.handleHttpError(response);
    }
    
    return response.body!;
  }
  
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Mafia-AI-Benchmark/1.0',
    };
    
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    
    return headers;
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
            if (data === '[DONE]') return;
            
            try {
              const chunk = JSON.parse(data);
              const streamChunk = this.parseStreamChunk(chunk);
              if (streamChunk) yield streamChunk;
            } catch {}
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
        message: { role: string; content: string };
        finish_reason: string;
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    
    return {
      id: response.id,
      object: response.object,
      created: response.created,
      model: response.model,
      choices: response.choices.map((choice, index) => ({
        index,
        message: { role: choice.message.role as 'assistant', content: choice.message.content },
        finishReason: choice.finish_reason,
      })),
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      provider: 'META',
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
        delta: { role?: string; content?: string };
        finish_reason: string | null;
      }>;
    };
    
    return {
      id: chunk.id,
      object: chunk.object,
      created: chunk.created,
      model: chunk.model,
      choices: chunk.choices.map((choice, index) => ({
        index,
        delta: { role: choice.delta?.role as 'assistant', content: choice.delta?.content || '' },
        finishReason: choice.finish_reason,
      })),
    };
  }
  
  private async handleHttpError(response: Response): Promise<void> {
    const status = response.status;
    const data = await response.json().catch(() => ({}));
    
    let code: keyof typeof ERROR_CODES = 'SERVER_ERROR';
    let message = `HTTP ${status}: ${response.statusText}`;
    
    if (data.error) {
      const error = data.error as { message?: string };
      message = error.message || message;
      
      if (status === 401) code = ERROR_CODES.AUTHENTICATION_FAILED;
      else if (status === 429) code = ERROR_CODES.RATE_LIMITED;
      else if (status === 400) code = ERROR_CODES.INVALID_REQUEST;
    }
    
    throw new LLMError(message, code, 'META', status, data);
  }
  
  private handleError(error: unknown, startTime: number): void {
    const latency = Date.now() - startTime;
    this.stats.avgLatency = (this.stats.avgLatency * (this.stats.totalRequests - 1) + latency) / this.stats.totalRequests;
    this.stats.errorRate = (this.stats.errorRate * (this.stats.totalRequests - 1) + 1) / this.stats.totalRequests;
    
    if (error instanceof LLMError) throw error;
    throw new LLMError(error instanceof Error ? error.message : 'Unknown error', ERROR_CODES.UNKNOWN_ERROR, 'META');
  }
  
  private updateStats(response: ChatResponse, latency: number): void {
    this.stats.lastUsed = new Date();
    this.stats.avgLatency = (this.stats.avgLatency * (this.stats.totalRequests - 1) + latency) / this.stats.totalRequests;
    
    if (response.usage) {
      this.stats.totalTokens += response.usage.totalTokens;
      const cost = calculateCost('META', this.config.model, response.usage.promptTokens, response.usage.completionTokens);
      this.stats.totalCost += cost.cost;
    }
  }
  
  countTokens(text: string): number { return Math.ceil(text.length / 4); }
  estimateCost(promptTokens: number, completionTokens: number): number {
    return calculateCost('META', this.config.model, promptTokens, completionTokens);
  }
  validateConfig(): boolean { return !!this.config.model; }
  getStats(): ProviderStats { return { ...this.stats }; }
  resetStats(): void {
    this.stats = { provider: 'META', model: this.config.model, totalRequests: 0, totalTokens: 0, totalCost: 0, avgLatency: 0, errorRate: 0, lastUsed: new Date() };
  }
}
