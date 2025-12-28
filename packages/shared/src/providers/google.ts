/**
 * Google Provider Adapter
 * 
 * Implementation for Google Gemini models (Gemini 1.5 Pro, Flash, etc.)
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

export class GoogleProvider implements LLMProviderAdapter {
  readonly provider: string = 'GOOGLE';
  
  get capabilities() {
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
  
  private config: ProviderConfig;
  private stats: ProviderStats;
  private baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta';
  
  constructor(config: ProviderConfig) {
    this.config = config;
    this.stats = {
      provider: 'GOOGLE',
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
      const payload = this.buildPayload(request);
      const stream = await this.makeStreamingRequest(payload);
      
      this.stats.lastUsed = new Date();
      
      return {
        id: `stream-${Date.now()}`,
        model: this.config.model,
        provider: 'GOOGLE',
        chunks: this.createChunkIterator(stream),
      };
    } catch (error) {
      this.handleError(error, startTime);
      throw error;
    }
  }
  
  private buildPayload(request: ChatRequest): object {
    const contents = request.messages.map(m => ({
      role: m.role === 'user' ? 'user' : m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    
    const generationConfig: Record<string, unknown> = {
      temperature: request.temperature ?? this.config.temperature ?? 0.7,
      maxOutputTokens: request.maxTokens ?? this.config.maxTokens ?? 4096,
    };
    
    if (request.stop) {
      generationConfig.stopSequences = request.stop;
    }
    
    return {
      contents,
      generationConfig,
      systemInstruction: request.systemPrompt ? {
        role: 'system',
        parts: [{ text: request.systemPrompt }],
      } : undefined,
    };
  }
  
  private async makeRequest(payload: object): Promise<ChatResponse> {
    const url = `${this.baseUrl}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
    const url = `${this.baseUrl}/models/${this.config.model}:streamGenerateContent?key=${this.config.apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
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
      candidates?: Array<{
        content: {
          parts: Array<{ text: string }>;
          role: string;
        };
        finishReason: string;
        safetyRatings?: unknown;
      }>;
      usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
      };
    };
    
    const candidate = response.candidates?.[0];
    const content = candidate?.content.parts[0]?.text || '';
    
    return {
      id: `gemini-${Date.now()}`,
      object: 'chat.completion',
      created: Date.now(),
      model: this.config.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finishReason: candidate?.finishReason || 'stop',
      }],
      usage: response.usageMetadata ? {
        promptTokens: response.usageMetadata.promptTokenCount,
        completionTokens: response.usageMetadata.candidatesTokenCount,
        totalTokens: response.usageMetadata.totalTokenCount,
      } : undefined,
      provider: 'GOOGLE',
    };
  }
  
  private parseStreamChunk(data: Record<string, unknown>): StreamChunk | null {
    const chunk = data as {
      candidates?: Array<{
        content: {
          parts: Array<{ text: string }>;
        };
        delta?: { parts: Array<{ text: string }> };
      }>;
    };
    
    const candidate = chunk.candidates?.[0];
    const content = candidate?.content?.parts[0]?.text || 
                    candidate?.delta?.parts[0]?.text || '';
    
    if (!content) return null;
    
    return {
      id: `gemini-stream-${Date.now()}`,
      object: 'chat.completion.chunk',
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
    
    let code: keyof typeof ERROR_CODES = 'SERVER_ERROR';
    let message = `HTTP ${status}: ${response.statusText}`;
    
    if (data.error) {
      const error = data.error as { status?: string; message?: string };
      message = error.message || message;
      
      if (status === 401 || error.status === 'PERMISSION_DENIED') {
        code = ERROR_CODES.AUTHENTICATION_FAILED;
      } else if (status === 429) {
        code = ERROR_CODES.RATE_LIMITED;
      } else if (status === 400) {
        code = ERROR_CODES.INVALID_REQUEST;
      }
    }
    
    throw new LLMError(message, code, 'GOOGLE', status, data);
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
      'GOOGLE'
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
        'GOOGLE',
        this.config.model,
        response.usage.promptTokens,
        response.usage.completionTokens
      );
      this.stats.totalCost += cost.cost;
    }
  }
  
  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
  
  estimateCost(promptTokens: number, completionTokens: number): number {
    return calculateCost('GOOGLE', this.config.model, promptTokens, completionTokens);
  }
  
  validateConfig(): boolean {
    return !!(this.config.apiKey && this.config.model);
  }
  
  getStats(): ProviderStats {
    return { ...this.stats };
  }
  
  resetStats(): void {
    this.stats = {
      provider: 'GOOGLE',
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
