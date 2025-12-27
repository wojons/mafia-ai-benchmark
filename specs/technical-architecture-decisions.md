# Technical Architecture Decisions

## Executive Summary

This document specifies all framework, tool, and infrastructure decisions for the Mafia AI Benchmark project. All decisions are made with consideration for:
- **Extensibility**: Easy to add new LLM providers, models, and features
- **Performance**: Real-time streaming for optimal user experience
- **Simplicity**: Avoid over-engineering while maintaining quality
- **Portability**: Works locally without complex infrastructure
- **Cost**: Avoid paid APIs in default build

---

## 1. LLM Communication Layer

### 1.1 Multi-Provider Architecture

```typescript
// LLM Provider Interface - supports any API-compatible service
interface LLMProvider {
  name: string;
  version: string;
  baseUrl: string;
  
  // Authentication
  authType: 'api_key' | 'bearer' | 'basic' | 'none';
  getAuthHeaders(): Record<string, string>;
  
  // Communication
  async complete(prompt: string, options: LLMOptions): Promise<LLMResponse>;
  async streamComplete(prompt: string, options: LLMOptions): AsyncGenerator<LLMChunk>;
  
  // Capabilities
  supportsStreaming: boolean;
  supportsFunctions: boolean;
  maxContextLength: number;
  maxOutputLength: number;
}

interface LLMOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  stream?: boolean;
}

interface LLMResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'tool_use' | 'content_filter' | 'error';
  model: string;
  timestamp: number;
}

interface LLMChunk {
  chunk: string;
  finished: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}
```

### 1.2 Supported Providers

```typescript
// Provider Configuration
const SUPPORTED_PROVIDERS: ProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    supportsStreaming: true,
    supportsFunctions: true,
    maxContextLength: 128000  // gpt-4-turbo
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    authType: 'bearer',
    models: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
    supportsStreaming: true,
    supportsFunctions: false,  // Coming soon
    maxContextLength: 200000  // Claude 3
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authType: 'api_key',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'],
    supportsStreaming: true,
    supportsFunctions: true,
    maxContextLength: 2000000  // Gemini 1.5
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    authType: 'bearer',
    models: ['deepseek-chat'],
    supportsStreaming: true,
    supportsFunctions: false,
    maxContextLength: 128000
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    authType: 'bearer',
    models: ['llama2-70b-4096', 'mixtral-8x7b-32768', 'gemma-7b-it'],
    supportsStreaming: true,
    supportsFunctions: false,
    maxContextLength: 32768
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',  // OpenAI-compatible API
    authType: 'none',
    models: ['llama2', 'mistral', 'codellama', 'orca-2', 'neural-chat'],
    supportsStreaming: true,
    supportsFunctions: false,
    maxContextLength: 131072  // Depends on model
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    baseUrl: 'http://localhost:1234/v1',  // OpenAI-compatible API
    authType: 'none',
    models: ['*'],  // All loaded models
    supportsStreaming: true,
    supportsFunctions: false,
    maxContextLength: 131072  // Depends on model
  },
  {
    id: 'custom',
    name: 'Custom Provider',
    baseUrl: '${CUSTOM_API_URL}',
    authType: '${CUSTOM_AUTH_TYPE}',
    models: ['*'],
    supportsStreaming: true,
    supportsFunctions: false,
    maxContextLength: 131072
  }
];

// Provider selection by environment
const getProviderConfig = (providerId: string, customBaseUrl?: string): ProviderConfig => {
  const provider = SUPPORTED_PROVIDERS.find(p => p.id === providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  
  if (providerId === 'custom' && customBaseUrl) {
    return { ...provider, baseUrl: customBaseUrl };
  }
  
  return provider;
};
```

### 1.3 Base URL Configuration (Non-Popular Providers)

```typescript
// Custom provider with base URL override
interface CustomProviderConfig {
  providerId: 'custom';
  baseUrl: string;  // e.g., 'https://api.myservice.com/v1'
  apiKey?: string;
  models: string[];
  supportsStreaming: boolean;
  supportsFunctions: boolean;
}

// Examples of non-popular/custom providers
const CUSTOM_PROVIDER_EXAMPLES = [
  {
    name: 'LocalAI',
    baseUrl: 'http://localhost:8080/v1',
    authType: 'none',
    models: ['llama2-70b', 'mistral-7b', 'starcoder']
  },
  {
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    authType: 'bearer',
    models: ['llama2-70b-chat', 'mistral-7b-instruct', 'orca-2-7b']
  },
  {
    name: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    authType: 'bearer',
    models: ['llama2-70b-chat', 'mixtral-8x7b-instruct']
  },
  {
    name: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai',
    authType: 'bearer',
    models: ['pplx-7b-online', 'pplx-70b-online', 'sonar-small-online']
  },
  {
    name: 'Mistral API',
    baseUrl: 'https://api.mistral.ai/v1',
    authType: 'bearer',
    models: ['mistral-small', 'mistral-medium', 'mistral-large', 'open-mistral-7b']
  },
  {
    name: 'Cohere',
    baseUrl: 'https://api.cohere.ai/v1',
    authType: 'bearer',
    models: ['command', 'command-light', 'command-r', 'command-r-plus']
  },
  {
    name: 'Azure OpenAI',
    baseUrl: 'https://${resource}.openai.azure.com/openai/deployments/${deployment}',
    authType: 'bearer',
    models: ['gpt-4', 'gpt-35-turbo']
  }
];
```

### 1.4 LLM Provider Manager

```typescript
class LLMProviderManager {
  private providers: Map<string, LLMProvider> = new Map();
  private defaultProvider: string = 'openai';
  
  constructor() {
    // Initialize built-in providers
    this.registerProvider('openai', new OpenAIProvider());
    this.registerProvider('anthropic', new AnthropicProvider());
    this.registerProvider('google', new GoogleProvider());
    this.registerProvider('deepseek', new DeepSeekProvider());
    this.registerProvider('groq', new GroqProvider());
    this.registerProvider('ollama', new OllamaProvider());
    this.registerProvider('lmstudio', new LMStudioProvider());
  }
  
  registerProvider(id: string, provider: LLMProvider): void {
    this.providers.set(id, provider);
  }
  
  getProvider(id: string): LLMProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider not registered: ${id}`);
    }
    return provider;
  }
  
  async complete(
    providerId: string,
    prompt: string,
    options: LLMOptions
  ): Promise<LLMResponse> {
    const provider = this.getProvider(providerId);
    return provider.complete(prompt, options);
  }
  
  async *streamComplete(
    providerId: string,
    prompt: string,
    options: LLMOptions
  ): AsyncGenerator<LLMChunk> {
    const provider = this.getProvider(providerId);
    if (!provider.supportsStreaming) {
      // Fallback to non-streaming
      const response = await provider.complete(prompt, options);
      yield { chunk: response.content, finished: true, usage: response.usage };
    } else {
      yield* provider.streamComplete(prompt, options);
    }
  }
  
  setDefaultProvider(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(`Unknown provider: ${id}`);
    }
    this.defaultProvider = id;
  }
  
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
  
  getProviderCapabilities(id: string): ProviderCapabilities {
    const provider = this.getProvider(id);
    return {
      models: provider.models,
      streaming: provider.supportsStreaming,
      functions: provider.supportsFunctions,
      maxContext: provider.maxContextLength
    };
  }
}

// Provider capabilities for UI
interface ProviderCapabilities {
  models: string[];
  streaming: boolean;
  functions: boolean;
  maxContext: number;
}
```

### 1.5 Streaming Architecture

```typescript
// Streaming architecture for real-time responses
interface StreamingConfig {
  chunkSize: number;           // Characters per chunk (default: 10)
  throttleMs: number;          // Throttle render updates (default: 50)
  bufferSize: number;          // Buffer chunks before emitting (default: 5)
  timeoutMs: number;           // Max time to wait for complete (default: 30000)
}

class StreamingLLMService {
  private config: StreamingConfig;
  private buffer: string[] = [];
  
  constructor(config: Partial<StreamingConfig> = {}) {
    this.config = {
      chunkSize: config.chunkSize || 10,
      throttleMs: config.throttleMs || 50,
      bufferSize: config.bufferSize || 5,
      timeoutMs: config.timeoutMs || 30000
    };
  }
  
  async *streamAgentResponse(
    provider: LLMProvider,
    prompt: string,
    options: LLMOptions,
    onChunk?: (chunk: string) => void,
    onComplete?: (fullResponse: string) => void
  ): AsyncGenerator<string> {
    const startTime = Date.now();
    this.buffer = [];
    
    for await (const llmChunk of provider.streamComplete(prompt, options)) {
      // Add to buffer
      this.buffer.push(llmChunk.chunk);
      
      // Throttle: only emit when buffer is full
      if (this.buffer.length >= this.config.bufferSize) {
        const chunk = this.buffer.join('');
        this.buffer = [];  // Clear buffer
        
        yield chunk;
        onChunk?.(chunk);
      }
      
      // Timeout check
      if (Date.now() - startTime > this.config.timeoutMs) {
        break;
      }
    }
    
    // Emit remaining buffer
    if (this.buffer.length > 0) {
      const chunk = this.buffer.join('');
      this.buffer = [];
      yield chunk;
      onChunk?.(chunk);
    }
    
    // Notify completion
    const fullResponse = this.buffer.join('');
    onComplete?.(fullResponse);
  }
  
  // For shorter responses (agent turns), use non-streaming
  async getCompleteResponse(
    provider: LLMProvider,
    prompt: string,
    options: LLMOptions
  ): Promise<LLMResponse> {
    return provider.complete(prompt, options);
  }
}
```

---

## 2. API Architecture

### 2.1 REST API (Backend Server)

```typescript
// API Versioning
const API_VERSION = 'v1';
const BASE_PATH = `/api/${API_VERSION}`;

// Endpoints
const API_ENDPOINTS = {
  // Games
  'POST /games': 'Create a new game',
  'GET /games': 'List all games',
  'GET /games/:id': 'Get game status',
  'PUT /games/:id': 'Update game configuration',
  'DELETE /games/:id': 'Delete a game',
  
  // Game Control
  'POST /games/:id/start': 'Start a game',
  'POST /games/:id/pause': 'Pause a game',
  'POST /games/:id/resume': 'Resume a game',
  'POST /games/:id/step': 'Execute one step (debug)',
  
  // Events
  'GET /games/:id/events': 'Get game events (paginated)',
  'GET /games/:id/events/stream': 'Server-sent events stream',
  'GET /games/:id/export': 'Export game as JSONL',
  
  // Players
  'GET /games/:id/players': 'List players',
  'POST /games/:id/players': 'Add a player',
  'DELETE /games/:id/players/:playerId': 'Remove a player',
  
  // Configuration
  'GET /config': 'Get server configuration',
  'GET /providers': 'List available LLM providers',
  'GET /models': 'List available models',
  
  // Health
  'GET /health': 'Health check',
  'GET /ready': 'Readiness check'
};

// Request/Response Types
interface CreateGameRequest {
  config: GameConfig;
  players: PlayerConfig[];
  provider?: string;           // LLM provider for all
  model?: string;              // Default model
  webhookUrl?: string;         // Webhook for events
}

interface CreateGameResponse {
  gameId: string;
  status: 'created' | 'running' | 'error';
  players: PlayerStatus[];
  links: {
    self: string;
    ws: string;
    status: string;
    export: string;
  };
}

interface GameStatusResponse {
  gameId: string;
  status: 'created' | 'running' | 'paused' | 'finished' | 'error';
  phase: string;
  dayNumber: number;
  roundNumber: number;
  players: PlayerStatus[];
  config: GameConfig;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

interface PlayerStatus {
  id: string;
  name: string;
  role: string;
  status: 'alive' | 'dead' | 'eliminated';
  model: string;
  provider: string;
}

interface GameConfig {
  roles: {
    mafia: number;
    doctor: number;
    sheriff: number;
    vigilante: number;
    villagers: number;
  };
  timing: {
    nightTimeout: number;
    dayDiscussionTime: number;
    votingTime: number;
  };
  rules: {
    doctorCanSelfProtect: boolean;
    doctorCannotRepeatProtect: boolean;
    vigilanteShots: number;
    tieBreaker: 'rng' | 'no_elimination';
  };
  seed?: number;
}

// Express.js Implementation
import express from 'express';
import { Server } from 'http';
import { WebSocketServer } from 'ws';

class GameServer {
  private app: express.Application;
  private server: Server;
  private wsServer: WebSocketServer;
  private gameManager: GameManager;
  private llmManager: LLMProviderManager;
  
  constructor(port: number = 3000) {
    this.app = express();
    this.gameManager = new GameManager();
    this.llmManager = new LLMProviderManager();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    
    this.server = this.app.listen(port, () => {
      console.log(`Game server running on port ${port}`);
    });
  }
  
  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(cors());
    this.app.use(requestLogger());
  }
  
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });
    
    // Config endpoints
    this.app.get('/api/v1/config', (req, res) => {
      res.json({
        providers: this.llmManager.getAvailableProviders(),
        defaultProvider: 'openai',
        serverVersion: '1.0.0'
      });
    });
    
    this.app.get('/api/v1/providers/:provider/models', (req, res) => {
      const capabilities = this.llmManager.getProviderCapabilities(req.params.provider);
      res.json(capabilities);
    });
    
    // Game endpoints
    this.app.post('/api/v1/games', this.createGame.bind(this));
    this.app.get('/api/v1/games', this.listGames.bind(this));
    this.app.get('/api/v1/games/:id', this.getGame.bind(this));
    this.app.delete('/api/v1/games/:id', this.deleteGame.bind(this));
    
    // Game control
    this.app.post('/api/v1/games/:id/start', this.startGame.bind(this));
    this.app.post('/api/v1/games/:id/pause', this.pauseGame.bind(this));
    this.app.post('/api/v1/games/:id/resume', this.resumeGame.bind(this));
    this.app.post('/api/v1/games/:id/step', this.stepGame.bind(this));
    
    // Events
    this.app.get('/api/v1/games/:id/events', this.getEvents.bind(this));
    this.app.get('/api/v1/games/:id/export', this.exportGame.bind(this));
    
    // Players
    this.app.get('/api/v1/games/:id/players', this.getPlayers.bind(this));
    this.app.post('/api/v1/games/:id/players', this.addPlayer.bind(this));
    this.app.delete('/api/v1/games/:id/players/:playerId', this.removePlayer.bind(this));
  }
  
  private setupWebSocket(): void {
    this.wsServer = new WebSocketServer({ path: '/ws' });
    
    this.wsServer.on('connection', (ws, req) => {
      const url = new URL(req.url!, `ws://localhost`);
      const gameId = url.pathname.split('/').pop();
      
      if (!gameId) {
        ws.close(1008, 'Game ID required');
        return;
      }
      
      // Subscribe to game events
      const subscription = this.gameManager.subscribe(gameId, ws);
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(ws, gameId, message, subscription);
        } catch (error) {
          ws.send(JSON.stringify({ error: 'Invalid message format' }));
        }
      });
      
      ws.on('close', () => {
        this.gameManager.unsubscribe(gameId, subscription);
      });
    });
  }
  
  private async createGame(req: express.Request, res: express.Response): Promise<void> {
    try {
      const game = await this.gameManager.createGame(req.body);
      res.status(201).json(game);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
  
  // ... other route handlers
}
```

### 2.2 WebSocket Protocol (Real-time)

```typescript
// WebSocket message types
type WSMessageType = 
  | 'subscribe'
  | 'unsubscribe'
  | 'ping'
  | 'pause'
  | 'resume'
  | 'step'
  | 'send_message';

interface WSMessage {
  type: WSMessageType;
  gameId?: string;
  payload?: Record<string, any>;
}

interface WSEvent {
  type: 'think_chunk' | 'say_chunk' | 'vote' | 'phase_change' | 'elimination' | 'game_over';
  gameId: string;
  timestamp: number;
  playerId?: string;
  data: any;
}

class WebSocketHandler {
  private connections: Map<string, Set<WebSocket>> = new Map();
  private eventBuffer: Map<string, WSEvent[]> = new Map();
  private readonly BUFFER_SIZE = 1000;
  
  subscribe(gameId: string, ws: WebSocket): Subscription {
    if (!this.connections.has(gameId)) {
      this.connections.set(gameId, new Set());
      this.eventBuffer.set(gameId, []);
    }
    
    this.connections.get(gameId)!.add(ws);
    
    // Send buffered events
    const bufferedEvents = this.eventBuffer.get(gameId)!;
    bufferedEvents.forEach(event => {
      ws.send(JSON.stringify(event));
    });
    
    return {
      gameId,
      unsubscribe: () => {
        this.connections.get(gameId)?.delete(ws);
      }
    };
  }
  
  broadcast(gameId: string, event: WSEvent): void {
    // Add to buffer
    const buffer = this.eventBuffer.get(gameId);
    if (buffer) {
      buffer.push(event);
      if (buffer.length > this.BUFFER_SIZE) {
        buffer.shift();  // Remove oldest
      }
    }
    
    // Broadcast to all connections
    const connections = this.connections.get(gameId);
    if (connections) {
      const message = JSON.stringify(event);
      connections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }
  
  handleMessage(ws: WebSocket, message: WSMessage): void {
    switch (message.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
        
      case 'pause':
        this.handlePause(message.gameId);
        break;
        
      case 'resume':
        this.handleResume(message.gameId);
        break;
        
      case 'step':
        this.handleStep(message.gameId);
        break;
        
      case 'send_message':
        this.handlePlayerMessage(message.gameId, message.payload);
        break;
    }
  }
}
```

### 2.3 CLI API Client

```typescript
// CLI uses REST API to communicate with server
class APIClient {
  private baseUrl: string;
  private apiKey?: string;
  private httpClient: fetch;
  
  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.httpClient = fetch;
  }
  
  private async request<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    
    const response = await this.httpClient(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }
    
    return response.json();
  }
  
  // Game management
  async createGame(config: CreateGameRequest): Promise<CreateGameResponse> {
    return this.request<CreateGameResponse>('POST', '/api/v1/games', config);
  }
  
  async listGames(): Promise<GameStatusResponse[]> {
    return this.request<GameStatusResponse[]>('GET', '/api/v1/games');
  }
  
  async getGame(gameId: string): Promise<GameStatusResponse> {
    return this.request<GameStatusResponse>('GET', `/api/v1/games/${gameId}`);
  }
  
  async deleteGame(gameId: string): Promise<void> {
    return this.request<void>('DELETE', `/api/v1/games/${gameId}`);
  }
  
  // Game control
  async startGame(gameId: string): Promise<void> {
    return this.request<void>('POST', `/api/v1/games/${gameId}/start`);
  }
  
  async pauseGame(gameId: string): Promise<void> {
    return this.request<void>('POST', `/api/v1/games/${gameId}/pause`);
  }
  
  async resumeGame(gameId: string): Promise<void> {
    return this.request<void>('POST', `/api/v1/games/${gameId}/resume`);
  }
  
  async stepGame(gameId: string, count: number = 1): Promise<void> {
    return this.request<void>('POST', `/api/v1/games/${gameId}/step`, { count });
  }
  
  // Events
  async getEvents(gameId: string, fromSeq?: number): Promise<WSEvent[]> {
    const query = fromSeq ? `?fromSeq=${fromSeq}` : '';
    return this.request<WSEvent[]>(`GET', `/api/v1/games/${gameId}/events${query}`);
  }
  
  async exportGame(gameId: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/v1/games/${gameId}/export`);
    return response.text();
  }
  
  // Streaming
  async *streamEvents(gameId: string): AsyncGenerator<WSEvent> {
    const response = await fetch(`${this.baseUrl}/api/v1/games/${gameId}/events/stream`);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    if (!reader) throw new Error('No stream available');
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.trim()) {
          yield JSON.parse(line);
        }
      }
    }
  }
  
  // Configuration
  async getProviders(): Promise<string[]> {
    return this.request<string[]>('GET', '/api/v1/config/providers');
  }
  
  async getProviderModels(provider: string): Promise<string[]> {
    return this.request<string[]>(`GET', `/api/v1/providers/${provider}/models`);
  }
}

// CLI command integration
class CLICommand {
  constructor(private client: APIClient) {}
  
  async execute(args: string[]): Promise<void> {
    const command = args[0];
    
    switch (command) {
      case 'new':
        await this.handleNew(args.slice(1));
        break;
      case 'attach':
        await this.handleAttach(args.slice(1));
        break;
      case 'status':
        await this.handleStatus(args.slice(1));
        break;
      case 'pause':
        await this.handlePause(args.slice(1));
        break;
      // ... other commands
    }
  }
  
  private async handleAttach(args: string[]): Promise<void> {
    const gameId = args[0];
    const follow = args.includes('--follow');
    
    console.log(`Attaching to game ${gameId}...`);
    
    for await (const event of this.client.streamEvents(gameId)) {
      console.log(formatEvent(event));
      
      if (!follow) break;
    }
  }
}
```

---

## 3. Programming Language & Tech Stack

### 3.1 Language Selection

```typescript
// Core Language: TypeScript 5.x
// Justification:
// - Type safety for complex game state
// - Shared types between server and client
// - Excellent ecosystem for AI/LLM integration
// - Native ESM support
// - Strict mode catches errors early

const TYPESCRIPT_CONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'node',
    lib: ['ES2022'],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    outDir: './dist',
    rootDir: './src',
    declaration: true,
    sourceMap: true
  },
  include: ['src/**/*'],
  exclude: ['node_modules', 'dist', '**/*.test.ts']
};
```

### 3.2 Backend Stack

```typescript
// Server Runtime: Node.js 20+ (LTS)
const BACKEND_STACK = {
  runtime: 'node@20',
  
  // Web Framework: Express.js
  webFramework: 'express@4.18',
  
  // WebSocket: ws (native, fast)
  websocket: 'ws@8.16',
  
  // HTTP Client: fetch (native in Node 20)
  httpClient: 'native-fetch',
  
  // Validation: Zod
  validation: 'zod@3.22',
  
  // Database: better-sqlite3 (synchronous, fast)
  database: 'better-sqlite3@9.2',
  
  // CLI: Commander.js
  cli: 'commander@12',
  
  // Colors: Chalk
  colors: 'chalk@5.3',
  
  // Configuration: dotenv
  config: 'dotenv@16.3',
  
  // Logging: Pino
  logging: 'pino@8.17',
  
  // Testing: Vitest
  testing: 'vitest@1.2',
  
  // Build: tsup (fast TypeScript bundler)
  build: 'tsup@8.0'
};
```

### 3.3 Frontend Stack

```typescript
// Frontend: React 18 + TypeScript
const FRONTEND_STACK = {
  framework: 'react@18',
  language: 'typescript@5',
  
  // Build Tool: Vite
  buildTool: 'vite@5',
  
  // State Management: Zustand
  stateManagement: 'zustand@4.5',
  
  // Routing: React Router
  routing: 'react-router-dom@6',
  
  // Styling: Tailwind CSS
  styling: 'tailwindcss@3.4',
  
  // HTTP Client: Axios
  httpClient: 'axios@1.6',
  
  // WebSocket: native (browser)
  websocket: 'native-websocket',
  
  // 3D Graphics: Three.js
  graphics3D: 'three@0.161',
  
  // 3D React: React Three Fiber
  graphicsReact: '@react-three/fiber@8',
  graphicsDrei: '@react-three/drei@9',
  
  // UI Components: Custom (per spec) or Shadcn UI
  uiComponents: 'custom-implementation',
  
  // Icons: Lucide React
  icons: 'lucide-react@0.312',
  
  // Animations: Framer Motion
  animations: 'framer-motion@11',
  
  // Virtualization: react-window (for feeds)
  virtualization: 'react-window@1.8',
  
  // Testing: Vitest + React Testing Library
  testing: ['vitest@1.2', '@testing-library/react@14']
};
```

### 3.4 Monorepo Structure

```typescript
// pnpm workspace configuration
const WORKSPACE_CONFIG = {
  packages: [
    'packages/shared',
    'apps/server',
    'apps/web',
    'apps/cli',
    'packages/llm-providers',
    'packages/visualization'
  ],
  
  // Shared dependencies
  sharedDependencies: [
    'typescript@5',
    'zod@3.22'
  ]
};

// Root package.json
const ROOT_PACKAGE_JSON = {
  name: 'mafia-ai-benchmark',
  version: '1.0.0',
  private: true,
  type: 'module',
  
  scripts: {
    // Build all packages
    build: 'pnpm -r run build',
    
    // Start all services
    dev: 'concurrently "pnpm dev:server" "pnpm dev:web" "pnpm dev:cli"',
    'dev:server': 'cd apps/server && pnpm dev',
    'dev:web': 'cd apps/web && pnpm dev',
    'dev:cli': 'cd apps/cli && pnpm dev',
    
    // Test all packages
    test: 'pnpm -r run test',
    
    // Lint all packages
    lint: 'pnpm -r run lint',
    
    // Clean build artifacts
    clean: 'pnpm -r run clean'
  },
  
  devDependencies: {
    'concurrently': '^8.2',
    'typescript': '^5.3'
  }
};
```

---

## 4. Database Architecture

### 4.1 Database Selection

```typescript
// Primary Database: SQLite (better-sqlite3)
const DATABASE_CONFIG = {
  engine: 'SQLite',
  driver: 'better-sqlite3',
  filePath: './data/mafia.db',
  
  // For production scaling, we can add:
  // - Redis for caching and pub/sub
  // - PostgreSQL adapter for larger deployments
  
  whySQLite: [
    'Simple file-based (no server needed)',
    'Fast for single-connection writes',
    'ACID compliant',
    'JSON support (for event payloads)',
    'Great TypeScript support',
    'Easy backup (just copy the file)',
    'Perfect for local development'
  ]
};

// Schema Definition
const DATABASE_SCHEMA = {
  games: `
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      seed INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('created', 'running', 'paused', 'finished', 'error')),
      phase TEXT CHECK (phase IN ('setup', 'night_actions', 'morning_reveal', 'day_discussion', 'day_voting', 'resolution', 'end')),
      day_number INTEGER DEFAULT 0,
      round_number INTEGER DEFAULT 0,
      config_json TEXT NOT NULL,
      players_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      metadata_json TEXT
    )
  `,
  
  events: `
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      private INTEGER DEFAULT 0,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      UNIQUE (game_id, sequence)
    )
  `,
  
  players: `
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('alive', 'dead', 'eliminated')),
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      eliminated_at INTEGER,
      flip_role TEXT,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `,
  
  snapshots: `
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      UNIQUE (game_id, sequence)
    )
  `,
  
  // Indexes for performance
  indexes: [
    `CREATE INDEX IF NOT EXISTS idx_events_game_sequence ON events(game_id, sequence)`,
    `CREATE INDEX IF NOT EXISTS idx_events_type ON events(game_id, event_type)`,
    `CREATE INDEX IF NOT EXISTS idx_players_game ON players(game_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_snapshots_game ON snapshots(game_id, sequence)`
  ]
};
```

### 4.2 Database Operations

```typescript
// Database access layer
class Database {
  private db: Database.Database;
  
  constructor(dbPath: string = './data/mafia.db') {
    this.db = new Database.Database(dbPath);
    this.initialize();
  }
  
  private initialize(): void {
    // Create tables
    Object.values(DATABASE_SCHEMA).forEach(sql => {
      this.db.exec(sql);
    });
  }
  
  // Game operations
  createGame(game: Game): void {
    const stmt = this.db.prepare(`
      INSERT INTO games (id, seed, status, config_json, players_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      game.id,
      game.seed,
      game.status,
      JSON.stringify(game.config),
      JSON.stringify(game.players),
      Date.now()
    );
  }
  
  getGame(gameId: string): Game | null {
    const stmt = this.db.prepare('SELECT * FROM games WHERE id = ?');
    const row = stmt.get(gameId) as any;
    
    if (!row) return null;
    
    return {
      ...row,
      config: JSON.parse(row.config_json),
      players: JSON.parse(row.players_json)
    };
  }
  
  // Event operations
  appendEvent(gameId: string, event: GameEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (game_id, sequence, event_type, timestamp_ms, private, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      gameId,
      event.sequence,
      event.eventType,
      event.timestamp,
      event.private ? 1 : 0,
      JSON.stringify(event.payload)
    );
  }
  
  getEvents(gameId: string, fromSequence: number = 0, limit: number = 100): GameEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE game_id = ? AND sequence >= ?
      ORDER BY sequence ASC
      LIMIT ?
    `);
    
    const rows = stmt.all(gameId, fromSequence, limit) as any[];
    
    return rows.map(row => ({
      sequence: row.sequence,
      eventType: row.event_type,
      timestamp: row.timestamp_ms,
      private: row.private === 1,
      payload: JSON.parse(row.payload_json)
    }));
  }
  
  // Snapshot operations
  createSnapshot(gameId: string, sequence: number, state: GameState): void {
    const stmt = this.db.prepare(`
      INSERT INTO snapshots (game_id, sequence, state_json, created_at)
      VALUES (?, ?, ?, ?)
    `);
    
    stmt.run(gameId, sequence, JSON.stringify(state), Date.now());
  }
  
  getLatestSnapshot(gameId: string): { sequence: number; state: GameState } | null {
    const stmt = this.db.prepare(`
      SELECT * FROM snapshots
      WHERE game_id = ?
      ORDER BY sequence DESC
      LIMIT 1
    `);
    
    const row = stmt.get(gameId) as any;
    if (!row) return null;
    
    return {
      sequence: row.sequence,
      state: JSON.parse(row.state_json)
    };
  }
  
  // Analytics
  getGameStats(): {
    totalGames: number;
    runningGames: number;
    finishedGames: number;
    avgDuration: number;
  } {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total_games,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running_games,
        SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) as finished_games,
        AVG(CASE 
          WHEN finished_at IS NOT NULL AND started_at IS NOT NULL 
          THEN finished_at - started_at 
          ELSE NULL 
        END) as avg_duration_ms
      FROM games
    `).get() as any;
    
    return {
      totalGames: stats.total_games,
      runningGames: stats.running_games,
      finishedGames: stats.finished_games,
      avgDuration: stats.avg_duration_ms || 0
    };
  }
}
```

---

## 5. Visualization Architecture

### 5.2 2D vs 3D Decision

```typescript
// HYBRID APPROACH: Both 2D and 3D supported
interface VisualizationConfig {
  mode: '2d' | '3d' | 'hybrid';
  renderer: 'webgl' | 'canvas' | 'svg';
  
  // 3D Settings
  threejs?: {
    enabled: boolean;
    shadows: boolean;
    antialias: boolean;
    maxFPS: number;
  };
  
  // 2D Settings
  twoD?: {
    style: 'minimal' | 'detailed' | 'cyber';
    animations: boolean;
    particleEffects: boolean;
  };
}

// Default: 2D for performance, 3D for immersion
const DEFAULT_VISUALIZATION: VisualizationConfig = {
  mode: '2d',  // Start with 2D for reliability
  renderer: 'webgl',
  
  threejs: {
    enabled: false,  // Can be enabled via flag
    shadows: false,
    antialias: true,
    maxFPS: 30
  },
  
  twoD: {
    style: 'detailed',
    animations: true,
    particleEffects: true
  }
};

// Enable 3D with: --visualization 3d
const VISUALIZATION_MODES = {
  '2d': {
    description: 'Fast, reliable 2D rendering',
    tech: 'React + Canvas/WebGL',
    performance: '60 FPS guaranteed',
    features: ['Agent cards', 'Chat bubbles', 'Animations', 'Vote display']
  },
  '3d': {
    description: 'Immersive 3D experience',
    tech: 'Three.js + React Three Fiber',
    performance: '30-60 FPS depending on hardware',
    features: ['3D avatars', 'Environment', 'Spatial audio', 'Camera controls']
  },
  'hybrid': {
    description: 'Best of both worlds',
    tech: 'Three.js embedded in 2D layout',
    performance: '45-60 FPS',
    features: ['3D avatars in 2D grid', 'Smooth transitions', 'Progressive enhancement']
  }
};
```

### 5.3 Asset Generation

```typescript
// Asset Types and Sources
interface AssetConfig {
  type: 'generated' | 'external' | 'procedural';
  format: 'glb' | 'gltf' | 'png' | 'svg';
  source: string;
  fallback?: string;
}

// Asset categories
const ASSET_CATEGORIES = {
  avatars: {
    type: 'procedural',
    format: 'glb',
    source: 'Character generation system',
    description: 'Simple geometric avatars with customizable colors and accessories',
    
    // Procedural generation parameters
    parameters: {
      bodyType: ['humanoid', 'stylized', 'abstract'],
      color: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'],
      accessories: ['hat', 'glasses', 'mask', 'headphones'],
      expression: ['neutral', 'suspicious', 'confident', 'nervous', 'lying']
    }
  },
  
  environment: {
    type: 'procedural',
    format: 'gltf',
    source: 'Three.js primitives',
    description: 'Simple geometric environment (table, chairs, lighting)',
    
    elements: ['round_table', 'chairs', 'lighting fixtures', 'particles']
  },
  
  uiElements: {
    type: 'procedural',
    format: 'svg',
    source: 'React components + Lucide icons',
    description: 'Icons, indicators, and UI components',
    
    elements: ['role_icons', 'status_indicators', 'chat_bubbles', 'vote_arrows']
  },
  
  effects: {
    type: 'procedural',
    format: 'webgl',
    source: 'Three.js shaders',
    description: 'Visual effects and animations',
    
    effects: ['death_particles', 'vote_highlight', 'phase_transition', 'suspicion_glow']
  }
};

// Asset generation system
class AssetGenerator {
  async generateAvatar(config: AvatarConfig): Promise<string> {
    // Returns URL to generated 3D model or 2D SVG
    
    // For 3D: Use procedural generation with Three.js
    const mesh = this.createProceduralAvatar(config);
    const glb = await this.exportToGLB(mesh);
    return URL.createObjectURL(glb);
    
    // For 2D: Generate SVG avatar
    const svg = this.generateSVGAvatar(config);
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
  
  private createProceduralAvatar(config: AvatarConfig): THREE.Group {
    const group = new THREE.Group();
    
    // Body (simple capsule)
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 1, 4, 8),
      new THREE.MeshStandardMaterial({ color: config.color })
    );
    group.add(body);
    
    // Head (simple sphere)
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 16, 16),
      new THREE.MeshStandardMaterial({ color: config.skinColor || '#FFE4C4' })
    );
    head.position.y = 1;
    group.add(head);
    
    // Expression (based on config)
    if (config.expression === 'suspicious') {
      // Add eyebrows that angle down
      const eyebrow = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.05, 0.05),
        new THREE.MeshStandardMaterial({ color: '#333' })
      );
      eyebrow.position.set(0.15, 1.2, 0.35);
      eyebrow.rotation.z = -0.3;
      group.add(eyebrow);
    }
    
    // Accessories
    if (config.accessories.includes('hat')) {
      const hat = new THREE.Mesh(
        new THREE.ConeGeometry(0.3, 0.4, 8),
        new THREE.MeshStandardMaterial({ color: '#333' })
      );
      hat.position.y = 1.5;
      group.add(hat);
    }
    
    return group;
  }
  
  private generateSVGAvatar(config: AvatarConfig): string {
    // Simple circular avatar with color and icon
    return `
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="48" fill="${config.color}" />
        <circle cx="50" cy="40" r="15" fill="${config.skinColor || '#FFE4C4'}" />
        <rect x="25" y="60" width="50" height="40" rx="15" fill="${config.color}" />
        ${config.accessories.includes('hat') ? 
          '<polygon points="30,25 50,5 70,25" fill="#333" />' : ''}
      </svg>
    `;
  }
}
```

### 5.4 Text-to-Speech (Voice Synthesis)

```typescript
// TTS Configuration
interface TTSConfig {
  engine: 'browser' | 'external' | 'elevenlabs' | 'google' | 'openai';
  
  // Browser TTS (free, no API)
  browser?: {
    defaultVoice: string;
    rate: number;      // 0.5 - 2.0
    pitch: number;     // 0.5 - 2.0
    volume: number;    // 0 - 1
  };
  
  // External TTS (paid, better quality)
  external?: {
    provider: 'elevenlabs' | 'google' | 'openai';
    apiKey?: string;
    voiceId?: string;
    model?: string;
  };
  
  // Per-character voice mapping
  characterVoices: Map<string, VoiceConfig>;
}

interface VoiceConfig {
  voiceId: string;
  pitch: number;
  speed: number;
  emotion?: string;
}

// Voice selection for characters
const DEFAULT_VOICE_MAP: Map<string, VoiceConfig> = new Map([
  ['mafia_aggressive', { voiceId: 'deep_male', pitch: 0.8, speed: 1.1 }],
  ['mafia_subtle', { voiceId: 'smooth_male', pitch: 1.0, speed: 0.9 }],
  ['doctor', { voiceId: 'calm_female', pitch: 1.1, speed: 1.0 }],
  ['sheriff', { voiceId: 'authoritative', pitch: 0.9, speed: 1.0 }],
  ['vigilante', { voiceId: 'mysterious_male', pitch: 0.85, speed: 0.95 }],
  ['villager', { voiceId: 'neutral_male', pitch: 1.0, speed: 1.0 }]
]);

// TTS Service
class TTSService {
  private config: TTSConfig;
  
  constructor(config: TTSConfig) {
    this.config = config;
  }
  
  async speak(text: string, characterId: string): Promise<AudioBuffer> {
    const voiceConfig = this.config.characterVoices.get(characterId) || 
      this.config.characterVoices.get('villager')!;
    
    switch (this.config.engine) {
      case 'browser':
        return this.speakWithBrowser(text, voiceConfig);
        
      case 'elevenlabs':
        return this.speakWithElevenLabs(text, voiceConfig);
        
      case 'openai':
        return this.speakWithOpenAI(text, voiceConfig);
        
      default:
        return this.speakWithBrowser(text, voiceConfig);
    }
  }
  
  private async speakWithBrowser(text: string, voiceConfig: VoiceConfig): Promise<AudioBuffer> {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Find matching voice
      const voices = speechSynthesis.getVoices();
      const matchingVoice = voices.find(v => 
        v.name.toLowerCase().includes(voiceConfig.voiceId)
      );
      if (matchingVoice) {
        utterance.voice = matchingVoice;
      }
      
      utterance.rate = voiceConfig.speed;
      utterance.pitch = voiceConfig.pitch;
      
      // Create audio context
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      
      utterance.onend = () => {
        // Convert stream to buffer
        resolve(audioContext.createBuffer(1, 0, 44100));  // Placeholder
      };
      
      speechSynthesis.speak(utterance);
    });
  }
  
  private async speakWithElevenLabs(text: string, voiceConfig: VoiceConfig): Promise<AudioBuffer> {
    const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceConfig.voiceId, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.config.external!.apiKey!
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true
        }
      })
    });
    
    const audioBlob = await response.blob();
    const arrayBuffer = await audioBlob.arrayBuffer();
    
    const audioContext = new AudioContext();
    return audioContext.decodeAudioData(arrayBuffer);
  }
  
  private async speakWithOpenAI(text: string, voiceConfig: VoiceConfig): Promise<AudioBuffer> {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.external!.apiKey}`
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: voiceConfig.voiceId,
        speed: voiceConfig.speed,
        response_format: 'opus'
      })
    });
    
    const audioBlob = await response.blob();
    const arrayBuffer = await audioBlob.arrayBuffer();
    
    const audioContext = new AudioContext();
    return audioContext.decodeAudioData(arrayBuffer);
  }
  
  // Get available voices
  async getAvailableVoices(): Promise<VoiceInfo[]> {
    switch (this.config.engine) {
      case 'browser':
        return speechSynthesis.getVoices().map(v => ({
          id: v.name,
          name: v.name,
          lang: v.lang,
          localService: v.localService
        }));
        
      case 'elevenlabs':
        // Fetch from ElevenLabs API
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
          headers: { 'xi-api-key': this.config.external!.apiKey! }
        });
        const data = await response.json();
        return data.voices.map((v: any) => ({
          id: v.voice_id,
          name: v.name,
          lang: 'en',
          localService: false
        }));
        
      default:
        return [];
    }
  }
}
```

---

## 6. Game State Management

### 6.1 Streaming vs Batch Decision

```typescript
// DECISION: HYBRID APPROACH
// - THINK streams: Real-time (chunk by chunk)
// - SAY streams: Real-time (chunk by chunk)
// - ACTIONS: Batch (submit on timeout or confirmation)
// - GAME STATE: Event-sourced (immutable append-only)

interface GameStateManager {
  // Event sourcing for game state
  events: EventStream;
  
  // Real-time state for UI
  state$: BehaviorSubject<GameState>;
  
  // Streaming handlers
  thinkStreams: Map<string, AsyncGenerator<string>>;
  sayStreams: Map<string, AsyncGenerator<string>>;
}

// Event sourcing (immutable, replayable)
class EventStream {
  private events: GameEvent[] = [];
  private subscribers: Set<(event: GameEvent) => void> = new Set();
  
  append(event: GameEvent): void {
    this.events.push(event);
    this.subscribers.forEach(cb => cb(event));
  }
  
  getAll(): GameEvent[] {
    return [...this.events];
  }
  
  replay(): GameState {
    let state = initialState;
    for (const event of this.events) {
      state = reduce(state, event);
    }
    return state;
  }
  
  subscribe(callback: (event: GameEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
}

// Real-time state (for UI updates)
class ReactiveGameState {
  private state$ = new BehaviorSubject<GameState>(initialState);
  private stateHistory: GameState[] = [];
  private readonly MAX_HISTORY = 100;
  
  getState(): GameState {
    return this.state$.value;
  }
  
  getState$(): Observable<GameState> {
    return this.state$.asObservable();
  }
  
  update(reducer: (state: GameState) => GameState): void {
    const newState = reducer(this.state$.value);
    this.state$.next(newState);
    
    // Maintain history for undo/redo
    this.stateHistory.push(newState);
    if (this.stateHistory.length > this.MAX_HISTORY) {
      this.stateHistory.shift();
    }
  }
  
  // Time-travel debugging
  getStateAt(index: number): GameState {
    return this.stateHistory[index];
  }
  
  // Export for serialization
  serialize(): string {
    return JSON.stringify({
      current: this.state$.value,
      history: this.stateHistory
    });
  }
}
```

### 6.2 Real-time Communication Flow

```typescript
// COMPLETE REAL-TIME FLOW

interface RealTimeFlow {
  // 1. Agent generates THINK (streamed to admin only)
  agent.think(prompt).subscribe(chunk => {
    // Send to WebSocket (admin only)
    ws.send({
      type: 'think_chunk',
      playerId: agent.id,
      chunk,
      private: true
    });
  });
  
  // 2. Agent generates SAY (streamed to all)
  agent.say(prompt).subscribe(chunk => {
    // Send to WebSocket (all viewers)
    ws.send({
      type: 'say_chunk',
      playerId: agent.id,
      chunk,
      private: false
    });
    
    // Update UI in real-time
    ui.updateAgentSay(agent.id, chunk);
  });
  
  // 3. Game events (phase changes, votes, etc.)
  gameEngine.on('event', event => {
    ws.send({
      type: 'game_event',
      event
    });
    
    ui.updateGameState(event);
  });
  
  // 4. Final actions (batch submission)
  agent.submitAction(action).then(() => {
    ws.send({
      type: 'action_submitted',
      playerId: agent.id,
      action
    });
  });
}

// Frontend integration
function useRealTimeGame(gameId: string) {
  const [gameState, setGameState] = useState<GameState>(initialState);
  const [agentStatements, setAgentStatements] = useState<Map<string, string>>(new Map());
  const [events, setEvents] = useState<GameEvent[]>([]);
  
  useEffect(() => {
    const ws = connectWebSocket(gameId);
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'think_chunk':
          // Admin only - update internal monologue display
          if (isAdmin()) {
            updateInternalMonologue(message.playerId, message.chunk);
          }
          break;
          
        case 'say_chunk':
          // Real-time streaming to UI
          setAgentStatements(prev => {
            const updated = new Map(prev);
            const current = updated.get(message.playerId) || '';
            updated.set(message.playerId, current + message.chunk);
            return updated;
          });
          break;
          
        case 'game_event':
          // Update game state
          setEvents(prev => [...prev, message.event]);
          setGameState(reduce(gameState, message.event));
          break;
      }
    };
    
    return () => ws.close();
  }, [gameId]);
  
  return { gameState, agentStatements, events };
}
```

---

## 7. Configuration Management

### 7.1 Configuration Files

```typescript
// 1. Game Configuration (per game)
interface GameConfiguration {
  gameId: string;
  seed: number;
  
  roles: {
    mafia: number;
    doctor: number;
    sheriff: number;
    vigilante: number;
    villagers: number;
  };
  
  timing: {
    nightTimeout: number;
    dayDiscussionTime: number;
    votingTime: number;
  };
  
  rules: {
    doctorCanSelfProtect: boolean;
    doctorCannotRepeatProtect: boolean;
    vigilanteShots: number;
    tieBreaker: 'rng' | 'no_elimination';
  };
  
  players: PlayerConfiguration[];
}

// 2. Server Configuration (environment)
interface ServerConfiguration {
  port: number;
  host: string;
  
  database: {
    path: string;
    backupInterval: number;
  };
  
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'pretty';
  };
  
  cors: {
    origin: string | string[];
    credentials: boolean;
  };
  
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
}

// 3. Provider Configuration
interface ProviderConfiguration {
  providers: {
    [providerId: string]: {
      enabled: boolean;
      baseUrl?: string;
      apiKey?: string;
      defaultModel?: string;
      models?: string[];
    };
  };
  
  defaults: {
    provider: string;
    model: string;
  };
}

// 4. Visualization Configuration
interface VisualizationConfiguration {
  mode: '2d' | '3d' | 'hybrid';
  
  twoD: {
    theme: 'dark' | 'light' | 'cyber';
    animations: boolean;
    particleEffects: boolean;
  };
  
  threeD: {
    enabled: boolean;
    shadows: boolean;
    maxFPS: number;
  };
  
  voices: {
    enabled: boolean;
    engine: 'browser' | 'external';
    volume: number;
    perCharacter: boolean;
  };
}

// Default configurations
const DEFAULT_SERVER_CONFIG: ServerConfiguration = {
  port: 3000,
  host: '0.0.0.0',
  
  database: {
    path: './data/mafia.db',
    backupInterval: 3600000  // 1 hour
  },
  
  logging: {
    level: 'info',
    format: 'pretty'
  },
  
  cors: {
    origin: '*',
    credentials: true
  },
  
  rateLimit: {
    windowMs: 60000,
    maxRequests: 100
  }
};

const DEFAULT_VISUALIZATION: VisualizationConfiguration = {
  mode: '2d',
  
  twoD: {
    theme: 'dark',
    animations: true,
    particleEffects: true
  },
  
  threeD: {
    enabled: false,
    shadows: false,
    maxFPS: 30
  },
  
  voices: {
    enabled: false,
    engine: 'browser',
    volume: 0.5,
    perCharacter: false
  }
};

// Configuration loading
function loadConfiguration(): {
  server: ServerConfiguration;
  providers: ProviderConfiguration;
  visualization: VisualizationConfiguration;
} {
  // Load from environment variables with defaults
  const server: ServerConfiguration = {
    port: parseInt(process.env.PORT || '3000'),
    host: process.env.HOST || '0.0.0.0',
    
    database: {
      path: process.env.DB_PATH || './data/mafia.db',
      backupInterval: parseInt(process.env.DB_BACKUP_INTERVAL || '3600000')
    },
    
    logging: {
      level: (process.env.LOG_LEVEL as any) || 'info',
      format: process.env.LOG_FORMAT || 'pretty'
    },
    
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || '*',
      credentials: process.env.CORS_CREDENTIALS === 'true'
    },
    
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'),
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100')
    }
  };
  
  // Load provider configs from environment
  const providers: ProviderConfiguration = {
    providers: {
      openai: {
        enabled: !!process.env.OPENAI_API_KEY,
        apiKey: process.env.OPENAI_API_KEY,
        defaultModel: 'gpt-4-turbo'
      },
      anthropic: {
        enabled: !!process.env.ANTHROPIC_API_KEY,
        apiKey: process.env.ANTHROPIC_API_KEY,
        defaultModel: 'claude-3-opus-20240229'
      },
      ollama: {
        enabled: true,
        baseUrl: process.env.OLLAMA_URL || 'http://localhost:11434/v1',
        defaultModel: 'llama2'
      }
    },
    
    defaults: {
      provider: process.env.DEFAULT_PROVIDER || 'ollama',
      model: process.env.DEFAULT_MODEL || 'llama2'
    }
  };
  
  const visualization: VisualizationConfiguration = {
    mode: (process.env.VISUALIZATION_MODE as any) || '2d',
    
    twoD: {
      theme: (process.env.UI_THEME as any) || 'dark',
      animations: process.env.UI_ANIMATIONS !== 'false',
      particleEffects: process.env.UI_PARTICLES !== 'false'
    },
    
    threeD: {
      enabled: process.env.THREEJS_ENABLED === 'true',
      shadows: process.env.THREEJS_SHADOWS === 'true',
      maxFPS: parseInt(process.env.THREEJS_MAX_FPS || '30')
    },
    
    voices: {
      enabled: process.env.VOICES_ENABLED === 'true',
      engine: (process.env.VOICE_ENGINE as any) || 'browser',
      volume: parseFloat(process.env.VOICE_VOLUME || '0.5'),
      perCharacter: process.env.VOICE_PER_CHARACTER === 'true'
    }
  };
  
  return { server, providers, visualization };
}
```

---

## 8. Summary of Technical Decisions

### Quick Reference Table

| Category | Decision | Justification |
|----------|----------|---------------|
| **Language** | TypeScript 5.x | Type safety, shared types, ecosystem |
| **LLM Providers** | Multi-provider with adapter pattern | Extensibility, custom base URLs |
| **API Style** | REST + WebSocket | Standard, well-understood |
| **Database** | SQLite (better-sqlite3) | Simple, fast, file-based |
| **Backend Framework** | Express.js | Mature, flexible, good ecosystem |
| **Frontend Framework** | React 18 + Vite | Modern, fast, great DX |
| **3D Graphics** | Three.js + React Three Fiber | Best React 3D integration |
| **State Management** | Event sourcing + Zustand | Replayability + reactivity |
| **TTS** | Browser native (free) + External (optional) | Cost vs quality tradeoff |
| **Streaming** | Hybrid (chunked real-time) | Performance + UX |
| **Configuration** | Environment variables + files | Flexibility + portability |
| **CLI** | Commander.js | Standard Node.js CLI pattern |

### Framework Dependencies Summary

```json
{
  "backend": {
    "express": "^4.18",
    "ws": "^8.16",
    "better-sqlite3": "^9.2",
    "zod": "^3.22",
    "commander": "^12.0",
    "pino": "^8.17"
  },
  
  "frontend": {
    "react": "^18",
    "vite": "^5",
    "zustand": "^4.5",
    "three": "^0.161",
    "@react-three/fiber": "^8",
    "framer-motion": "^11"
  },
  
  "shared": {
    "typescript": "^5.3",
    "zod": "^3.22"
  },
  
  "dev": {
    "vitest": "^1.2",
    "eslint": "^8.56"
  }
}
```

---

## 9. Next Steps for Implementation

### Immediate Actions
1. ✅ All technical decisions documented
2. ✅ Framework stack finalized
3. ✅ API architecture specified
4. ✅ Database schema defined
5. ✅ LLM provider pattern designed
6. ✅ Visualization approach decided
7. ✅ Configuration management planned

### Ready to Implement
The project is now fully specified from a technical perspective. You can:

1. **Create the monorepo structure** using the pnpm workspace config
2. **Set up the backend** with Express, SQLite, and WebSocket
3. **Build the LLM provider manager** with the adapter pattern
4. **Create the frontend** with React and visualization options
5. **Implement the CLI** using Commander.js

All technical decisions are documented in this file and ready for implementation!