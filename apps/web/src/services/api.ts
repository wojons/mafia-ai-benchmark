const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

interface FetchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

class APIError extends Error {
  constructor(message: string, public code: string, public statusCode?: number) {
    super(message);
    this.name = 'APIError';
  }
}

async function fetchAPI<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new APIError(
      error.message || `HTTP ${response.status}`,
      error.code || 'API_ERROR',
      response.status
    );
  }
  
  // Handle empty responses
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// Games API
export const gamesAPI = {
  getAll: (filters?: { status?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.limit) params.set('limit', filters.limit.toString());
    const query = params.toString();
    return fetchAPI<Array<{
      id: string;
      status: string;
      players: number;
      createdAt: string;
      config: Record<string, unknown>;
    }>>(`/games${query ? `?${query}` : ''}`);
  },
  
  get: (gameId: string) => {
    return fetchAPI<{
      id: string;
      status: string;
      players: Array<{
        id: string;
        name: string;
        role: string;
        isAlive: boolean;
        isMafia: boolean;
        joinOrder: number;
      }>;
      config: Record<string, unknown>;
      currentState: Record<string, unknown>;
    }>(`/games/${gameId}`);
  },
  
  create: (config?: Record<string, unknown>) => {
    return fetchAPI<{ id: string; status: string; config: Record<string, unknown> }>('/games', {
      method: 'POST',
      body: config,
    });
  },
  
  join: (gameId: string, playerName: string, agentConfig?: Record<string, unknown>) => {
    return fetchAPI<{ eventId: string }>(`/games/${gameId}/join`, {
      method: 'POST',
      body: { playerName, agentConfig },
    });
  },
  
  start: (gameId: string) => {
    return fetchAPI<{ eventId: string }>(`/games/${gameId}/start`, {
      method: 'POST',
    });
  },
  
  getState: (gameId: string) => {
    return fetchAPI<Record<string, unknown>>(`/games/${gameId}/state`);
  },
  
  submitNightAction: (gameId: string, playerId: string, action: string, targetId: string) => {
    return fetchAPI<{ eventId: string }>(`/games/${gameId}/night-action`, {
      method: 'POST',
      body: { playerId, action, targetId },
    });
  },
  
  submitVote: (gameId: string, voterId: string, targetId: string) => {
    return fetchAPI<{ eventId: string }>(`/games/${gameId}/vote`, {
      method: 'POST',
      body: { voterId, targetId },
    });
  },
  
  makeAccusation: (gameId: string, accuserId: string, targetId: string, accusation: string, evidence: string) => {
    return fetchAPI<{ eventId: string }>(`/games/${gameId}/accusation`, {
      method: 'POST',
      body: { accuserId, targetId, accusation, evidence },
    });
  },
  
  claimRole: (gameId: string, playerId: string, role: string) => {
    return fetchAPI<{ eventId: string }>(`/games/${gameId}/claim-role`, {
      method: 'POST',
      body: { playerId, role },
    });
  },
  
  getPlayers: (gameId: string) => {
    return fetchAPI<Array<{
      id: string;
      name: string;
      role: string;
      isAlive: boolean;
      isMafia: boolean;
      joinOrder: number;
    }>>(`/games/${gameId}/players`);
  },
};

// Agents API
export const agentsAPI = {
  getAll: () => {
    return fetchAPI<Array<{
      id: string;
      name: string;
      provider: string;
      model: string;
    }>>('/agents');
  },
  
  register: (config: {
    id: string;
    name: string;
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  }) => {
    return fetchAPI<{ id: string; name: string; provider: string; model: string }>('/agents', {
      method: 'POST',
      body: config,
    });
  },
  
  getStats: () => {
    return fetchAPI<Array<{
      agentId: string;
      name: string;
      provider: string;
      model: string;
      executions: number;
      successRate: number;
      avgLatency: number;
    }>>('/agents/stats');
  },
};

// Stats API
export const statsAPI = {
  getGameStats: () => {
    return fetchAPI<{
      totalGames: number;
      activeGames: number;
      completedGames: number;
      avgDuration: number;
      mafiaWins: number;
      townWins: number;
    }>('/stats');
  },
  
  getModelComparison: () => {
    return fetchAPI<Array<{
      provider: string;
      model: string;
      gamesPlayed: number;
      wins: number;
      winRate: number;
      avgTokens: number;
      avgCost: number;
    }>>('/stats/models');
  },
  
  getMatchups: () => {
    return fetchAPI<Array<{
      modelA: string;
      modelB: string;
      gamesPlayed: number;
      modelAWins: number;
      modelBWins: number;
      ties: number;
    }>>('/stats/matchups');
  },
  
  generateReport: (gameId?: string) => {
    const query = gameId ? `?gameId=${gameId}` : '';
    return fetchAPI<Record<string, unknown>>(`/benchmark/report${query}`);
  },
};

// Benchmark API
export const benchmarkAPI = {
  run: (config: {
    games?: number;
    models?: string[];
    parallel?: boolean;
  }) => {
    return fetchAPI<{
      message: string;
      config: Record<string, unknown>;
    }>('/benchmark', {
      method: 'POST',
      body: config,
    });
  },
};

// Export API instance
export const api = {
  games: gamesAPI,
  agents: agentsAPI,
  stats: statsAPI,
  benchmark: benchmarkAPI,
};

export default api;
