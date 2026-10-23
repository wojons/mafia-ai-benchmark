const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3004/api/v1';

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
  const parsedBody: unknown = text ? JSON.parse(text) : null;

  // Auto-unwrap { success: true, data: ... } envelope from the server.
  // Errors ({ success: false, error: ... }) are thrown above via !response.ok
  // and never reach this point; only success envelopes are unwrapped here.
  if (
    parsedBody &&
    typeof parsedBody === 'object' &&
    'success' in parsedBody &&
    (parsedBody as { success: unknown }).success === true &&
    'data' in parsedBody
  ) {
    return (parsedBody as { data: T }).data;
  }

  return parsedBody as T;
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
      /** PERF-MAFIA-4: terminal state is served on the LIST rows. */
      endedAt?: string | null;
      winner?: 'MAFIA' | 'TOWN' | null;
      duration?: number | null;
      startedAt?: string | null;
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
  
  getEvents: (gameId: string, visibility?: string) => {
    const query = visibility ? `?visibility=${visibility}` : '';
    return fetchAPI<{ data: Array<Record<string, unknown>>; count: number }>(`/games/${gameId}/events${query}`);
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

// Models API (DF-MAFIA-AI-BENCHMARK-42): GET /api/v1/models is the server's
// OWN provider catalog — the authoritative list of providers it actually
// talks to plus the models it has cached for them. The New Game modal's
// presets are sourced from this endpoint so no UI option can reference a
// provider id (e.g. 'openrouter') the server does not resolve.
export interface CatalogModelEntry {
  provider: string;
  modelId: string;
  displayName: string;
}

export interface ModelsCatalog {
  providers: string[];
  models: CatalogModelEntry[];
  totalCached?: number;
}

export const modelsAPI = {
  get: () => {
    return fetchAPI<ModelsCatalog>('/models');
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
      degenerateGames?: number;
      mockGames?: number;
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
export interface CompareModel {
  provider: string;
  model: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgTokensPerGame: number;
  avgCostPerGame: number;
  avgLatency: number;
  avgRolePerformance: number;
  rolePerformance: Record<
    string,
    {
      gamesPlayed: number;
      wins: number;
      winRate: number;
    }
  >;
}

export interface CompareReport {
  models: CompareModel[];
  /**
   * DF-MAFIA-AI-BENCHMARK-36: the CUSTOM/* mis-key family (the same rows
   * GET /benchmark/report buckets under `unattributedModels`, DF-33) —
   * same row shape as `models[]` plus the normalized `key`. Never rendered
   * as competitor rows; present so the excluded usage stays auditable and
   * both endpoints expose the same model-row key set.
   */
  unattributedModels?: Array<CompareModel & { key: string }>;
  headToHead: Array<{
    modelA: string;
    modelB: string;
    gamesPlayed: number;
    modelAWins: number;
    modelBWins: number;
    ties: number;
  }>;
  /**
   * DF-MAFIA-AI-BENCHMARK-12: count of games excluded from the model
   * aggregates as mock (every provider call fell back to the canned-mock
   * fallback). Surfaced so the exclusion is honest, not silent.
   */
  mockGames?: number;
  trends: Array<{
    model: string;
    games: Array<{
      gameId: string;
      won: boolean;
    }>;
  }>;
}

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

  // DF-MAFIA-AI-BENCHMARK-14: typed access to GET /api/v1/benchmark/compare.
  // fetchAPI unwraps the { success, data } envelope, so this resolves to the
  // bare CompareReport. An optional model filter narrows the comparison.
  compare: (modelFilter?: string[]) => {
    const query = modelFilter && modelFilter.length > 0
      ? `?models=${modelFilter.map((m) => encodeURIComponent(m.trim())).filter(Boolean).join(',')}`
      : '';
    return fetchAPI<CompareReport>(`/benchmark/compare${query}`);
  },
};

// Export API instance
export const api = {
  games: gamesAPI,
  agents: agentsAPI,
  stats: statsAPI,
  benchmark: benchmarkAPI,
  models: modelsAPI,
};

export default api;
