/**
 * Stats Collector Service
 * 
 * Collects and manages game statistics, token usage, and performance metrics.
 */

import { GameRepository } from '../db/repository.js';
import { v4 as uuidv4 } from 'uuid';

export interface TokenUsageRecord {
  gameId: string;
  playerId: string;
  turnNumber: number;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  timestamp: number;
}

export interface APICallRecord {
  gameId: string;
  playerId: string;
  provider: string;
  model: string;
  endpoint: string;
  latency: number;
  statusCode?: number;
  error?: string;
  timestamp: number;
}

export interface AgentSessionRecord {
  gameId: string;
  playerId: string;
  turnNumber: number;
  phase: string;
  prompt: string;
  response?: string;
  think?: string;
  says?: string;
  actionType?: string;
  actionTarget?: string;
  actionConfidence?: number;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  latency: number;
  cost: number;
  provider: string;
  model: string;
  timestamp: number;
}

export interface GameStats {
  totalGames: number;
  activeGames: number;
  completedGames: number;
  avgDuration: number;
  mafiaWins: number;
  townWins: number;
}

export interface PlayerStatsSummary {
  playerId: string;
  role: string;
  survived: boolean;
  won: boolean;
  tokensUsed: number;
  apiCalls: number;
  actionsTaken: number;
  correctVotes: number;
  incorrectVotes: number;
  rolePerformance: number;
}

export interface AgentStats {
  agentId: string;
  executions: number;
  successes: number;
  totalLatency: number;
  totalTokens: number;
  totalCost: number;
  provider?: string;
  model?: string;
}

export class StatsCollector {
  private gameRepository: GameRepository;
  
  constructor(gameRepository: GameRepository) {
    this.gameRepository = gameRepository;
  }
  
  // ==================== TOKEN USAGE ====================
  
  /**
   * Record token usage
   */
  recordTokenUsage(record: TokenUsageRecord): void {
    this.gameRepository.getDatabase().prepare(`
      INSERT INTO token_usage 
      (id, game_id, player_id, turn_number, provider, model, prompt_tokens, completion_tokens, total_tokens, cost, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      record.gameId,
      record.playerId,
      record.turnNumber,
      record.provider,
      record.model,
      record.promptTokens,
      record.completionTokens,
      record.totalTokens,
      record.cost,
      record.timestamp || Date.now()
    );
  }
  
  /**
   * Get total tokens for a game
   */
  getTotalTokens(gameId: string): number {
    const result = this.gameRepository.getDatabase().prepare(`
      SELECT SUM(total_tokens) as total FROM token_usage WHERE game_id = ?
    `).get(gameId) as { total: number | null };
    
    return result.total || 0;
  }
  
  /**
   * Get total cost for a game
   */
  getTotalCost(gameId: string): number {
    const result = this.gameRepository.getDatabase().prepare(`
      SELECT SUM(cost) as total FROM token_usage WHERE game_id = ?
    `).get(gameId) as { total: number | null };
    
    return result.total || 0;
  }
  
  /**
   * Get token usage by player
   */
  getPlayerTokenUsage(gameId: string, playerId: string): TokenUsageRecord[] {
    const rows = this.gameRepository.getDatabase().prepare(`
      SELECT * FROM token_usage WHERE game_id = ? AND player_id = ? ORDER BY turn_number
    `).all(gameId, playerId) as Record<string, unknown>[];
    
    return rows.map(row => ({
      gameId: row.game_id as string,
      playerId: row.player_id as string,
      turnNumber: row.turn_number as number,
      provider: row.provider as string,
      model: row.model as string,
      promptTokens: row.prompt_tokens as number,
      completionTokens: row.completion_tokens as number,
      totalTokens: row.total_tokens as number,
      cost: row.cost as number,
      timestamp: row.timestamp as number,
    }));
  }
  
  // ==================== API CALLS ====================
  
  /**
   * Record API call
   */
  recordAPICall(record: APICallRecord): void {
    this.gameRepository.getDatabase().prepare(`
      INSERT INTO api_calls
      (id, game_id, player_id, provider, model, endpoint, latency, status_code, error, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      record.gameId,
      record.playerId,
      record.provider,
      record.model,
      record.endpoint,
      record.latency,
      record.statusCode || null,
      record.error || null,
      record.timestamp || Date.now()
    );
  }
  
  /**
   * Get API calls for a game
   */
  getGameAPICalls(gameId: string): APICallRecord[] {
    const rows = this.gameRepository.getDatabase().prepare(`
      SELECT * FROM api_calls WHERE game_id = ? ORDER BY timestamp
    `).all(gameId) as Record<string, unknown>[];
    
    return rows.map(row => ({
      gameId: row.game_id as string,
      playerId: row.player_id as string,
      provider: row.provider as string,
      model: row.model as string,
      endpoint: row.endpoint as string,
      latency: row.latency as number,
      statusCode: row.status_code as number | undefined,
      error: row.error as string | undefined,
      timestamp: row.timestamp as number,
    }));
  }
  
  /**
   * Get API error rate
   */
  getAPIErrorRate(gameId: string): number {
    const total = this.gameRepository.getDatabase().prepare(`
      SELECT COUNT(*) as count FROM api_calls WHERE game_id = ?
    `).get(gameId) as { count: number };
    
    const errors = this.gameRepository.getDatabase().prepare(`
      SELECT COUNT(*) as count FROM api_calls WHERE game_id = ? AND error IS NOT NULL
    `).get(gameId) as { count: number };
    
    return total.count > 0 ? errors.count / total.count : 0;
  }
  
  // ==================== AGENT SESSIONS ====================
  
  /**
   * Record agent session
   */
  recordAgentSession(record: AgentSessionRecord): void {
    this.gameRepository.getDatabase().prepare(`
      INSERT INTO agent_sessions
      (id, game_id, player_id, turn_number, phase, prompt, response, think, says, action_type, action_target, action_confidence,
       tokens_used, prompt_tokens, completion_tokens, latency, cost, provider, model, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      record.gameId,
      record.playerId,
      record.turnNumber,
      record.phase,
      record.prompt,
      record.response || null,
      record.think || null,
      record.says || null,
      record.actionType || null,
      record.actionTarget || null,
      record.actionConfidence || null,
      record.tokensUsed,
      record.promptTokens,
      record.completionTokens,
      record.latency,
      record.cost,
      record.provider,
      record.model,
      record.timestamp || Date.now()
    );
  }
  
  /**
   * Get agent stats
   */
  getAgentStats(): AgentStats[] {
    const rows = this.gameRepository.getDatabase().prepare(`
      SELECT 
        player_id as agentId,
        COUNT(*) as executions,
        SUM(CASE WHEN response IS NOT NULL THEN 1 ELSE 0 END) as successes,
        SUM(latency) as totalLatency,
        SUM(tokens_used) as totalTokens,
        SUM(cost) as totalCost,
        provider,
        model
      FROM agent_sessions
      GROUP BY player_id, provider, model
    `).all() as Record<string, unknown>[];
    
    return rows.map(row => ({
      agentId: row.agentId as string,
      executions: row.executions as number,
      successes: row.successes as number,
      totalLatency: row.totalLatency as number,
      totalTokens: row.totalTokens as number,
      totalCost: row.totalCost as number,
      provider: row.provider as string | undefined,
      model: row.model as string | undefined,
    }));
  }
  
  // ==================== GAME STATISTICS ====================
  
  /**
   * Get game statistics
   */
  getGameStats(): GameStats {
    const stats = this.gameRepository.getGameStats();
    
    return {
      totalGames: stats.totalGames,
      activeGames: stats.activeGames,
      completedGames: stats.completedGames,
      avgDuration: stats.avgDuration,
      mafiaWins: stats.mafiaWins,
      townWins: stats.townWins,
    };
  }
  
  /**
   * Get player performance
   */
  getPlayerPerformance(gameId: string, playerId: string): PlayerStatsSummary | null {
    const player = this.gameRepository.getPlayers(gameId)
      .find(p => p.id === playerId);
    
    if (!player) return null;
    
    const tokenUsage = this.getPlayerTokenUsage(gameId, playerId);
    const apiCalls = this.getGameAPICalls(gameId).filter(c => c.playerId === playerId);
    
    return {
      playerId,
      role: player.role,
      survived: player.isAlive,
      won: false, // Would need to calculate from game results
      tokensUsed: tokenUsage.reduce((sum, t) => sum + t.totalTokens, 0),
      apiCalls: apiCalls.length,
      actionsTaken: 0, // Would need to track from events
      correctVotes: 0, // Would need to calculate from voting results
      incorrectVotes: 0,
      rolePerformance: this.calculateRolePerformance(player.role, player.isAlive),
    };
  }
  
  /**
   * Calculate role-specific performance score (0-100)
   */
  private calculateRolePerformance(role: string, survived: boolean): number {
    let score = 50; // Base score
    
    // Survival bonus
    if (survived) {
      score += 20;
    }
    
    // Role-specific bonuses
    switch (role) {
      case 'MAFIA':
        // Mafia wins if they survive and town is eliminated
        score += survived ? 30 : 0;
        break;
      case 'DOCTOR':
        // Doctor gets points for smart protection choices
        score += survived ? 25 : 0;
        break;
      case 'SHERIFF':
        // Sheriff gets points for accurate investigations
        score += survived ? 25 : 0;
        break;
      case 'VIGILANTE':
        // Vigilante gets points for accurate shot
        score += survived ? 20 : 0;
        break;
      case 'VILLAGER':
        // Villager gets points for correct voting
        score += survived ? 25 : 0;
        break;
    }
    
    return Math.min(100, Math.max(0, score));
  }
  
  // ==================== MODEL STATISTICS ====================
  
  /**
   * Get model comparison data
   */
  getModelComparison(): Array<{
    provider: string;
    model: string;
    gamesPlayed: number;
    wins: number;
    winRate: number;
    avgTokens: number;
    avgCost: number;
    avgLatency: number;
  }> {
    return this.gameRepository.getModelStats();
  }
  
  /**
   * Get head-to-head matchups
   */
  getMatchups(): Array<{
    modelA: string;
    modelB: string;
    gamesPlayed: number;
    modelAWins: number;
    modelBWins: number;
    ties: number;
  }> {
    const rows = this.gameRepository.getDatabase().prepare(`
      SELECT * FROM model_matchups ORDER BY games_played DESC LIMIT 20
    `).all() as Record<string, unknown>[];
    
    return rows.map(row => ({
      modelA: `${row.model_a_provider}/${row.model_a}`,
      modelB: `${row.model_b_provider}/${row.model_b}`,
      gamesPlayed: row.games_played as number,
      modelAWins: row.model_a_wins as number,
      modelBWins: row.model_b_wins as number,
      ties: row.ties as number,
    }));
  }
  
  // ==================== MODEL COMPARISON REPORT ====================

  /**
   * Get comprehensive model comparison report.
   * Supports optional model filter via query param.
   */
  getCompareReport(modelFilter?: string[]): {
    models: Array<{
      provider: string;
      model: string;
      gamesPlayed: number;
      wins: number;
      winRate: number;
      avgTokensPerGame: number;
      avgCostPerGame: number;
      avgLatency: number;
      avgRolePerformance: number;
      rolePerformance: Record<string, {
        gamesPlayed: number;
        wins: number;
        winRate: number;
      }>;
    }>;
    headToHead: Array<{
      modelA: string;
      modelB: string;
      gamesPlayed: number;
      modelAWins: number;
      modelBWins: number;
      ties: number;
    }>;
    trends: Array<{
      model: string;
      games: Array<{
        gameId: string;
        won: boolean;
        role: string;
        tokensUsed: number;
        createdAt: string;
      }>;
      cumulativeWinRate: number[];
    }>;
  } {
    const db = this.gameRepository.getDatabase();
    
    const modelList = modelFilter && modelFilter.length > 0
      ? modelFilter
      : null;

    // ===== Per-model aggregate stats =====
    let modelQuery = `
      SELECT 
        p.provider,
        p.model,
        COUNT(DISTINCT p.game_id) as games_played,
        SUM(CASE WHEN p.won = 1 THEN 1 ELSE 0 END) as wins,
        COALESCE(AVG(p.tokens_used), 0) as avg_tokens,
        COALESCE(AVG(p.role_performance), 0) as avg_role_perf
      FROM players p
      WHERE p.provider IS NOT NULL AND p.model IS NOT NULL
        AND p.role != 'UNASSIGNED'
    `;
    const modelParams: string[] = [];
    
    if (modelList) {
      const placeholders = modelList.map(() => '?').join(',');
      modelQuery += ` AND p.model IN (${placeholders})`;
      modelParams.push(...modelList);
    }
    
    modelQuery += ` GROUP BY p.provider, p.model ORDER BY games_played DESC`;
    
    const modelRows = db.prepare(modelQuery).all(...modelParams) as Record<string, unknown>[];

    // ===== Per-model role-specific performance =====
    // Get role breakdown for each model
    let roleQueryBody = `
        p.provider,
        p.model,
        p.role,
        COUNT(DISTINCT p.game_id) as games_played,
        SUM(CASE WHEN p.won = 1 THEN 1 ELSE 0 END) as wins
      FROM players p
      WHERE p.provider IS NOT NULL AND p.model IS NOT NULL
        AND p.role != 'UNASSIGNED'
    `;
    const roleParams: string[] = [];
    
    if (modelList) {
      const placeholders = modelList.map(() => '?').join(',');
      roleQueryBody += ` AND p.model IN (${placeholders})`;
      roleParams.push(...modelList);
    }
    
    const roleQuery = `SELECT ${roleQueryBody} GROUP BY p.provider, p.model, p.role`;
    const roleRows = db.prepare(roleQuery).all(...roleParams) as Record<string, unknown>[];
    
    // Build role performance map
    const rolePerfMap = new Map<string, Record<string, { gamesPlayed: number; wins: number; winRate: number }>>();
    for (const row of roleRows) {
      const key = `${row.provider}/${row.model}`;
      if (!rolePerfMap.has(key)) {
        rolePerfMap.set(key, {});
      }
      const gp = row.games_played as number;
      const w = row.wins as number;
      rolePerfMap.get(key)![row.role as string] = {
        gamesPlayed: gp,
        wins: w,
        winRate: gp > 0 ? w / gp : 0,
      };
    }

    // ===== Avg cost per model =====
    let costQuery = `
      SELECT 
        tu.provider,
        tu.model,
        COALESCE(AVG(cost_sum), 0) as avg_cost_per_game
      FROM (
        SELECT provider, model, game_id, SUM(cost) as cost_sum
        FROM token_usage
        WHERE provider IS NOT NULL AND model IS NOT NULL
    `;
    const costParams: string[] = [];
    if (modelList) {
      const placeholders = modelList.map(() => '?').join(',');
      costQuery += ` AND model IN (${placeholders})`;
      costParams.push(...modelList);
    }
    costQuery += ` GROUP BY provider, model, game_id) tu GROUP BY tu.provider, tu.model`;
    const costRows = db.prepare(costQuery).all(...costParams) as Record<string, unknown>[];
    
    const costMap = new Map<string, number>();
    for (const row of costRows) {
      costMap.set(`${row.provider}/${row.model}`, row.avg_cost_per_game as number);
    }

    // ===== Avg latency per model =====
    let latencyQuery = `
      SELECT 
        ac.provider,
        ac.model,
        COALESCE(AVG(ac.latency), 0) as avg_latency
      FROM api_calls ac
      WHERE ac.provider IS NOT NULL AND ac.model IS NOT NULL
    `;
    const latencyParams: string[] = [];
    if (modelList) {
      const placeholders = modelList.map(() => '?').join(',');
      latencyQuery += ` AND ac.model IN (${placeholders})`;
      latencyParams.push(...modelList);
    }
    latencyQuery += ` GROUP BY ac.provider, ac.model`;
    const latencyRows = db.prepare(latencyQuery).all(...latencyParams) as Record<string, unknown>[];
    
    const latencyMap = new Map<string, number>();
    for (const row of latencyRows) {
      latencyMap.set(`${row.provider}/${row.model}`, row.avg_latency as number);
    }

    // Build models array
    const models = modelRows.map(row => {
      const key = `${row.provider}/${row.model}`;
      const gp = row.games_played as number;
      const w = row.wins as number;
      return {
        provider: row.provider as string,
        model: row.model as string,
        gamesPlayed: gp,
        wins: w,
        winRate: gp > 0 ? w / gp : 0,
        avgTokensPerGame: Math.round(row.avg_tokens as number || 0),
        avgCostPerGame: Math.round((costMap.get(key) || 0) * 10000) / 10000,
        avgLatency: Math.round(latencyMap.get(key) || 0),
        avgRolePerformance: Math.round((row.avg_role_perf as number || 0) * 100) / 100,
        rolePerformance: rolePerfMap.get(key) || {},
      };
    });

    // ===== Head-to-head =====
    let h2hQuery = 'SELECT * FROM model_matchups WHERE 1=1';
    const h2hParams: string[] = [];
    if (modelList) {
      // Filter: model_a in list OR model_b in list
      const aPlaceholders = modelList.map(() => '?').join(',');
      const bPlaceholders = modelList.map(() => '?').join(',');
      h2hQuery += ` AND (model_a IN (${aPlaceholders}) OR model_b IN (${bPlaceholders}))`;
      h2hParams.push(...modelList, ...modelList);
    }
    h2hQuery += ' ORDER BY games_played DESC LIMIT 50';
    
    const h2hRows = db.prepare(h2hQuery).all(...h2hParams) as Record<string, unknown>[];
    
    const headToHead = h2hRows.map(row => ({
      modelA: `${row.model_a_provider || ''}/${row.model_a || ''}`,
      modelB: `${row.model_b_provider || ''}/${row.model_b || ''}`,
      gamesPlayed: row.games_played as number,
      modelAWins: row.model_a_wins as number,
      modelBWins: row.model_b_wins as number,
      ties: row.ties as number,
    }));

    // ===== Trends (game-by-game data) =====
    let trendQuery = `
      SELECT 
        p.provider,
        p.model,
        p.game_id,
        p.role,
        p.won,
        p.tokens_used,
        g.created_at
      FROM players p
      JOIN games g ON g.id = p.game_id
      WHERE p.provider IS NOT NULL AND p.model IS NOT NULL
        AND p.role != 'UNASSIGNED'
    `;
    const trendParams: string[] = [];
    if (modelList) {
      const placeholders = modelList.map(() => '?').join(',');
      trendQuery += ` AND p.model IN (${placeholders})`;
      trendParams.push(...modelList);
    }
    trendQuery += ` ORDER BY p.model, g.created_at ASC`;
    
    const trendRows = db.prepare(trendQuery).all(...trendParams) as Record<string, unknown>[];

    const trendMap = new Map<string, Array<{
      gameId: string;
      won: boolean;
      role: string;
      tokensUsed: number;
      createdAt: string;
    }>>();

    for (const row of trendRows) {
      const modelKey = `${row.provider}/${row.model}`;
      if (!trendMap.has(modelKey)) {
        trendMap.set(modelKey, []);
      }
      trendMap.get(modelKey)!.push({
        gameId: row.game_id as string,
        won: Boolean(row.won),
        role: row.role as string,
        tokensUsed: row.tokens_used as number || 0,
        createdAt: new Date(row.created_at as number).toISOString(),
      });
    }

    const trends = Array.from(trendMap.entries()).map(([model, games]) => {
      const cumulativeWinRate: number[] = [];
      let cumulativeWins = 0;
      for (let i = 0; i < games.length; i++) {
        if (games[i].won) cumulativeWins++;
        cumulativeWinRate.push(
          Math.round((cumulativeWins / (i + 1)) * 10000) / 10000
        );
      }
      return { model, games, cumulativeWinRate };
    });

    return { models, headToHead, trends };
  }

  // ==================== EXPORT & REPORTING ====================

  /**
   * Generate benchmark report
   */
  generateReport(gameId?: string): Record<string, unknown> {
    const gameStats = this.getGameStats();
    const modelComparison = this.getModelComparison();
    const agentStats = this.getAgentStats();
    
    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalGames: gameStats.totalGames,
        activeGames: gameStats.activeGames,
        completedGames: gameStats.completedGames,
        mafiaWinRate: gameStats.completedGames > 0 
          ? gameStats.mafiaWins / gameStats.completedGames 
          : 0,
        avgDuration: gameStats.avgDuration,
      },
      modelPerformance: modelComparison.slice(0, 10),
      agentStats: agentStats.slice(0, 10),
      recommendations: this.generateRecommendations(modelComparison),
    };
    
    if (gameId) {
      const game = this.gameRepository.getGame(gameId);
      if (game) {
        (report as Record<string, unknown>).game = {
          id: gameId,
          players: game.players.map(p => ({
            name: p.name,
            role: p.role,
            survived: p.isAlive,
          })),
          winner: game.status === 'ENDED' ? 'TOWN' : 'IN_PROGRESS',
        };
      }
    }
    
    return report;
  }
  
  /**
   * Generate recommendations based on statistics
   */
  private generateRecommendations(modelComparison: Array<{
    provider: string;
    model: string;
    winRate: number;
    avgCost: number;
  }>): string[] {
    const recommendations: string[] = [];
    
    // Find best performing model
    const bestWinRate = modelComparison.reduce((best, m) => 
      m.winRate > (best?.winRate || 0) ? m : best
    , null as typeof modelComparison[0] | null);
    
    if (bestWinRate) {
      recommendations.push(
        `Best win rate: ${bestWinRate.provider}/${bestWinRate.model} (${(bestWinRate.winRate * 100).toFixed(1)}%)`
      );
    }
    
    // Find best value model
    const bestValue = modelComparison.reduce((best, m) => {
      const value = m.winRate / (m.avgCost || 1);
      const bestValue = best ? (best.winRate / (best.avgCost || 1)) : 0;
      return value > bestValue ? m : best;
    }, null as typeof modelComparison[0] | null);
    
    if (bestValue) {
      recommendations.push(
        `Best value: ${bestValue.provider}/${bestValue.model} (win rate per dollar)`
      );
    }
    
    return recommendations;
  }
  
  /**
   * Export data as JSON
   */
  exportJSON(gameId?: string): string {
    const report = this.generateReport(gameId);
    return JSON.stringify(report, null, 2);
  }
  
  /**
   * Export data as CSV
   */
  exportCSV(gameId?: string): string {
    const rows: string[] = [];
    
    // Header
    rows.push('Metric,Value');
    
    // Summary
    const stats = this.getGameStats();
    rows.push(`Total Games,${stats.totalGames}`);
    rows.push(`Active Games,${stats.activeGames}`);
    rows.push(`Completed Games,${stats.completedGames}`);
    rows.push(`Mafia Wins,${stats.mafiaWins}`);
    rows.push(`Town Wins,${stats.townWins}`);
    rows.push(`Avg Duration (ms),${stats.avgDuration.toFixed(0)}`);
    
    return rows.join('\n');
  }

  // ==================== EXPORT REPORT ====================

  /**
   * Generate comprehensive export report with per-game stats,
   * per-model aggregates, game event logs, and cost breakdown.
   */
  getExportReport(games?: number): {
    generatedAt: string;
    summary: {
      totalGames: number;
      activeGames: number;
      completedGames: number;
      mafiaWins: number;
      townWins: number;
      avgDuration: number;
      totalTokens: number;
      totalCost: number;
    };
    games: Array<{
      gameId: string;
      status: string;
      dayCount: number;
      playerCount: number;
      duration: number | null;
      winner: string | null;
      players: Array<{
        playerId: string;
        name: string;
        role: string;
        provider: string;
        model: string;
        survived: boolean;
        won: boolean;
        tokensUsed: number;
        apiCalls: number;
      }>;
      events: Array<{
        id: string;
        type: string;
        description: string;
        playerId: string | null;
        timestamp: string;
        turnNumber: number;
        phase: string;
      }>;
      costBreakdown: {
        totalCost: number;
        totalTokens: number;
        promptTokens: number;
        completionTokens: number;
        apiCalls: number;
        errorRate: number;
        byModel: Array<{
          provider: string;
          model: string;
          cost: number;
          tokens: number;
        }>;
      };
    }>;
    modelAggregates: ReturnType<StatsCollector['getCompareReport']>['models'];
    headToHead: ReturnType<StatsCollector['getCompareReport']>['headToHead'];
  } {
    const gameStats = this.getGameStats();
    const compareReport = this.getCompareReport();

    // Calculate totals
    const totalTokens = this.gameRepository.getDatabase().prepare(
      'SELECT COALESCE(SUM(total_tokens), 0) as total FROM token_usage'
    ).get() as { total: number };
    const totalCost = this.gameRepository.getDatabase().prepare(
      'SELECT COALESCE(SUM(cost), 0) as total FROM token_usage'
    ).get() as { total: number };

    // Get recent games
    const allGames = this.gameRepository.listGames({ limit: games || 50, offset: 0 });
    const gameRows: Array<{
      gameId: string;
      status: string;
      dayCount: number;
      playerCount: number;
      duration: number | null;
      winner: string | null;
      players: Array<{
        playerId: string;
        name: string;
        role: string;
        provider: string;
        model: string;
        survived: boolean;
        won: boolean;
        tokensUsed: number;
        apiCalls: number;
      }>;
      events: Array<{
        id: string;
        type: string;
        description: string;
        playerId: string | null;
        timestamp: string;
        turnNumber: number;
        phase: string;
      }>;
      costBreakdown: {
        totalCost: number;
        totalTokens: number;
        promptTokens: number;
        completionTokens: number;
        apiCalls: number;
        errorRate: number;
        byModel: Array<{
          provider: string;
          model: string;
          cost: number;
          tokens: number;
        }>;
      };
    }> = [];

    for (const g of allGames) {
      const gameId = g.id;
      const players = this.gameRepository.getPlayers(gameId);
      const events = this.gameRepository.getEvents(gameId);

      // Player details with token/cost info
      const playerDetails = players.map(p => {
        const tokenUsage = this.getPlayerTokenUsage(gameId, p.id);
        const apiCalls = this.getGameAPICalls(gameId).filter(c => c.playerId === p.id);
        return {
          playerId: p.id,
          name: p.name,
          role: p.role,
          provider: (p as any).provider || '',
          model: (p as any).model || '',
          survived: p.isAlive,
          won: false, // would need full game resolution to compute accurately
          tokensUsed: tokenUsage.reduce((sum, t) => sum + t.totalTokens, 0),
          apiCalls: apiCalls.length,
        };
      });

      // Event log
      const eventLog = events.map(e => ({
        id: e.id,
        type: e.type,
        description: e.type,
        playerId: e.actorId || null,
        timestamp: e.timestamp.toISOString(),
        turnNumber: e.metadata?.turnNumber || 0,
        phase: e.metadata?.phase || '',
      }));

      // Cost breakdown per game
      const gameCost = this.getTotalCost(gameId);
      const gameTokens = this.getTotalTokens(gameId);
      const gameAPICalls = this.getGameAPICalls(gameId);
      const errorRate = this.getAPIErrorRate(gameId);

      // Prompt/completion breakdown
      const tokenBreakdown = this.gameRepository.getDatabase().prepare(
        'SELECT COALESCE(SUM(prompt_tokens), 0) as prompt, COALESCE(SUM(completion_tokens), 0) as completion FROM token_usage WHERE game_id = ?'
      ).get(gameId) as { prompt: number; completion: number };

      // Cost by model for this game
      const costByModel = this.gameRepository.getDatabase().prepare(
        'SELECT provider, model, SUM(cost) as cost, SUM(total_tokens) as tokens FROM token_usage WHERE game_id = ? GROUP BY provider, model'
      ).all(gameId) as Array<{ provider: string; model: string; cost: number; tokens: number }>;

      const gameDuration = g.startedAt && g.endedAt
        ? g.endedAt.getTime() - g.startedAt.getTime()
        : null;

      gameRows.push({
        gameId,
        status: g.status,
        dayCount: (g.currentState?.dayNumber || 0),
        playerCount: players.length,
        duration: gameDuration,
        winner: g.status === 'ENDED' ? (g as any).winner || null : null,
        players: playerDetails,
        events: eventLog,
        costBreakdown: {
          totalCost: gameCost,
          totalTokens: gameTokens,
          promptTokens: tokenBreakdown.prompt,
          completionTokens: tokenBreakdown.completion,
          apiCalls: gameAPICalls.length,
          errorRate,
          byModel: costByModel,
        },
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        totalGames: gameStats.totalGames,
        activeGames: gameStats.activeGames,
        completedGames: gameStats.completedGames,
        mafiaWins: gameStats.mafiaWins,
        townWins: gameStats.townWins,
        avgDuration: gameStats.avgDuration,
        totalTokens: totalTokens.total,
        totalCost: Math.round(totalCost.total * 10000) / 10000,
      },
      games: gameRows,
      modelAggregates: compareReport.models,
      headToHead: compareReport.headToHead,
    };
  }

  /**
   * Convert export report to CSV string
   */
  exportReportCSV(report: ReturnType<StatsCollector['getExportReport']>): string {
    const lines: string[] = [];

    // --- SUMMARY ---
    lines.push('# Summary');
    lines.push('Metric,Value');
    lines.push(`Total Games,${report.summary.totalGames}`);
    lines.push(`Active Games,${report.summary.activeGames}`);
    lines.push(`Completed Games,${report.summary.completedGames}`);
    lines.push(`Mafia Wins,${report.summary.mafiaWins}`);
    lines.push(`Town Wins,${report.summary.townWins}`);
    lines.push(`Avg Duration (ms),${report.summary.avgDuration.toFixed(0)}`);
    lines.push(`Total Tokens,${report.summary.totalTokens}`);
    lines.push(`Total Cost,${report.summary.totalCost}`);
    lines.push('');

    // --- PER-GAME STATS ---
    lines.push('# Per-Game Stats');
    lines.push('Game ID,Status,Players,Duration (ms),Winner,Total Cost,Total Tokens,API Calls,Error Rate');
    for (const g of report.games) {
      lines.push([
        g.gameId,
        g.status,
        g.playerCount,
        g.duration ?? '',
        g.winner ?? '',
        g.costBreakdown.totalCost,
        g.costBreakdown.totalTokens,
        g.costBreakdown.apiCalls,
        g.costBreakdown.errorRate,
      ].join(','));
    }
    lines.push('');

    // --- GAME EVENT LOGS ---
    lines.push('# Game Event Logs');
    lines.push('Game ID,Turn,Phase,Event Type,Player ID,Description,Timestamp');
    for (const g of report.games) {
      for (const e of g.events) {
        const desc = e.description.replace(/"/g, '""');
        lines.push([
          g.gameId,
          e.turnNumber,
          e.phase,
          e.type,
          e.playerId ?? '',
          `"${desc}"`,
          e.timestamp,
        ].join(','));
      }
    }
    lines.push('');

    // --- COST BREAKDOWN ---
    lines.push('# Cost Breakdown');
    lines.push('Game ID,Provider,Model,Cost,Tokens');
    for (const g of report.games) {
      for (const m of g.costBreakdown.byModel) {
        lines.push([g.gameId, m.provider, m.model, m.cost, m.tokens].join(','));
      }
    }
    lines.push('');

    // --- MODEL AGGREGATES ---
    lines.push('# Model Aggregates');
    lines.push('Provider,Model,Games Played,Wins,Win Rate,Avg Tokens/Game,Avg Cost/Game,Avg Latency (ms),Avg Role Performance');
    for (const m of report.modelAggregates) {
      lines.push([
        m.provider,
        m.model,
        m.gamesPlayed,
        m.wins,
        m.winRate,
        m.avgTokensPerGame,
        m.avgCostPerGame,
        m.avgLatency,
        m.avgRolePerformance,
      ].join(','));
    }
    lines.push('');

    // --- HEAD-TO-HEAD ---
    lines.push('# Head-to-Head Matchups');
    lines.push('Model A,Model B,Games Played,Model A Wins,Model B Wins,Ties');
    for (const h of report.headToHead) {
      lines.push([
        h.modelA,
        h.modelB,
        h.gamesPlayed,
        h.modelAWins,
        h.modelBWins,
        h.ties,
      ].join(','));
    }

    return lines.join('\n');
  }
}

export default StatsCollector;
