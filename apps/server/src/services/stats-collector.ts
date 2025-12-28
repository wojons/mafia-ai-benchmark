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
}

export default StatsCollector;
