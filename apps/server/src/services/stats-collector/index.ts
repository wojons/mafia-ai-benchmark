/**
 * Stats Collector Service
 * 
 * Collects and manages game statistics, token usage, and performance metrics.
 */

import { GameRepository } from '../../db/repository.js';
import { v4 as uuidv4 } from 'uuid';
import {
  getAggregatedWins,
  getGameWinnerFromEvents,
  computeDurationFromEvents,
} from './wins.js';
import {
  getModelComparison,
  getCompareReport,
  generateRecommendations,
} from './models.js';
import { getMatchups } from './matchups.js';
import { getPlayersFromEvents, calculateRolePerformance } from './players.js';

// ==================== RE-EXPORTS ====================
export { getAggregatedWins } from './wins.js';
export { getGameWinnerFromEvents, computeDurationFromEvents } from './wins.js';
export { getModelComparison, getCompareReport, generateRecommendations } from './models.js';
export { getMatchups } from './matchups.js';
export { getPlayersFromEvents, calculateRolePerformance } from './players.js';

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
  failedGames: number;
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

/**
 * Empty report shape shared by generateReport()'s error fallback — keeps
 * the response contract stable (generatedAt / summary / modelPerformance /
 * agentStats / recommendations) even when report generation fails.
 */
function createEmptyReport(): Record<string, unknown> {
  const noAgentStats: AgentStats[] = [];
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalGames: 0,
      activeGames: 0,
      completedGames: 0,
      failedGames: 0,
      failedGameIds: [],
      mafiaWinRate: 0,
      avgDuration: 0,
    },
    modelPerformance: [],
    agentStats: noAgentStats,
    recommendations: [],
  };
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
   * Get agent stats.
   *
   * MAF-GAP-028: this used to read only agent_sessions, which only the
   * native agent-coordinator path writes — every legacy game (the entire
   * recorded fleet) was invisible, so the benchmark report always carried
   * an empty agentStats array. The primary source is now token_usage
   * (written on every real billed API response by both the legacy adapter
   * and the stats path) LEFT JOINed to api_calls aggregates for latency
   * and success (api_calls.error IS NULL = success). agent_sessions
   * remains as a secondary source for agents with no recorded token usage
   * (native path); usage-derived rows win on key collision so nothing is
   * double-counted. Returns [] when no real data exists — never
   * fabricates.
   */
  getAgentStats(): AgentStats[] {
    const db = this.gameRepository.getDatabase();

    // Aggregate per (player, provider, model). token_usage and api_calls
    // are paired 1:1 per recorded call, but aggregating each side before
    // the LEFT JOIN keeps the sums correct even when one side has no
    // matching rows.
    const usageRows = db.prepare(`
      SELECT
        tu.player_id as agentId,
        tu.provider as provider,
        tu.model as model,
        tu.executions as executions,
        COALESCE(ac.successes, tu.executions) as successes,
        COALESCE(ac.totalLatency, 0) as totalLatency,
        tu.totalTokens as totalTokens,
        tu.totalCost as totalCost
      FROM (
        SELECT player_id, provider, model,
               COUNT(*) as executions,
               SUM(total_tokens) as totalTokens,
               COALESCE(SUM(cost), 0) as totalCost
        FROM token_usage
        GROUP BY player_id, provider, model
      ) tu
      LEFT JOIN (
        SELECT player_id, provider, model,
               SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) as successes,
               COALESCE(SUM(latency), 0) as totalLatency
        FROM api_calls
        GROUP BY player_id, provider, model
      ) ac ON ac.player_id = tu.player_id
          AND ac.provider = tu.provider
          AND ac.model = tu.model
    `).all() as Record<string, unknown>[];

    const merged = new Map<string, AgentStats>();
    for (const row of usageRows) {
      // A token_usage row only exists when a real billed API response was
      // recorded, so when api_calls has no matching rows the executions
      // themselves are the successes (same contract as agent_sessions:
      // response IS NOT NULL).
      merged.set(`${row.agentId}/${row.provider}/${row.model}`, {
        agentId: row.agentId as string,
        executions: row.executions as number,
        successes: row.successes as number,
        totalLatency: row.totalLatency as number,
        totalTokens: row.totalTokens as number,
        totalCost: row.totalCost as number,
        provider: row.provider as string | undefined,
        model: row.model as string | undefined,
      });
    }

    // Secondary source: agent_sessions (native agent-coordinator path)
    // for agents that have no recorded token usage. Usage rows win on key
    // collision so an agent recorded in both tables is not double-counted.
    const sessionRows = db.prepare(`
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

    for (const row of sessionRows) {
      const key = `${row.agentId}/${row.provider}/${row.model}`;
      if (merged.has(key)) continue;
      merged.set(key, {
        agentId: row.agentId as string,
        executions: row.executions as number,
        successes: row.successes as number,
        totalLatency: row.totalLatency as number,
        totalTokens: row.totalTokens as number,
        totalCost: row.totalCost as number,
        provider: row.provider as string | undefined,
        model: row.model as string | undefined,
      });
    }

    // Deterministic order (most active agents first) so the report's
    // top-10 slice is meaningful.
    return Array.from(merged.values())
      .sort((a, b) => b.executions - a.executions || b.totalCost - a.totalCost);
  }
  
  // ==================== GAME STATISTICS ====================
  
  /**
   * Get game statistics, deriving winner info from events when the games table lacks data.
   */
  getGameStats(): GameStats {
    const stats = this.gameRepository.getGameStats();
    const wins = getAggregatedWins(this.gameRepository);
    
    return {
      totalGames: stats.totalGames,
      activeGames: stats.activeGames,
      completedGames: stats.completedGames,
      failedGames: stats.failedGames,
      avgDuration: stats.avgDuration,
      mafiaWins: stats.mafiaWins > 0 ? stats.mafiaWins : wins.mafiaWins,
      townWins: stats.townWins > 0 ? stats.townWins : wins.townWins,
    };
  }
  
  /**
   * Get player performance
   */
  getPlayerPerformance(gameId: string, playerId: string): PlayerStatsSummary | null {
    const player = this.gameRepository.getPlayers(gameId)
      .find(p => p.id === playerId);
    
    if (!player) {
      const eventPlayers = getPlayersFromEvents(this.gameRepository, gameId);
      const ep = eventPlayers.find(p => p.id === playerId);
      if (!ep) return null;
      
      const tokenUsage = this.getPlayerTokenUsage(gameId, playerId);
      const apiCalls = this.getGameAPICalls(gameId).filter(c => c.playerId === playerId);
      const winner = getGameWinnerFromEvents(this.gameRepository, gameId);
      const won = winner === 'MAFIA' ? ep.isMafia : !ep.isMafia;
      
      return {
        playerId,
        role: ep.role,
        survived: ep.isAlive,
        won,
        tokensUsed: tokenUsage.reduce((sum, t) => sum + t.totalTokens, 0),
        apiCalls: apiCalls.length,
        actionsTaken: 0,
        correctVotes: 0,
        incorrectVotes: 0,
        rolePerformance: calculateRolePerformance(ep.role, ep.isAlive),
      };
    }
    
    const tokenUsage = this.getPlayerTokenUsage(gameId, playerId);
    const apiCalls = this.getGameAPICalls(gameId).filter(c => c.playerId === playerId);
    
    const winner = getGameWinnerFromEvents(this.gameRepository, gameId);
    const won = winner === 'MAFIA' ? player.isMafia : !player.isMafia;

    return {
      playerId,
      role: player.role,
      survived: player.isAlive,
      won,
      tokensUsed: tokenUsage.reduce((sum, t) => sum + t.totalTokens, 0),
      apiCalls: apiCalls.length,
      actionsTaken: 0,
      correctVotes: 0,
      incorrectVotes: 0,
      rolePerformance: calculateRolePerformance(player.role, player.isAlive),
    };
  }
  
  // ==================== MODEL STATISTICS ====================
  
  /**
   * Get model comparison data
   */
  getModelComparison() {
    return getModelComparison(this.gameRepository);
  }
  
  /**
   * Get head-to-head matchups
   */
  getMatchups() {
    return getMatchups(this.gameRepository);
  }
  
  /**
   * Get comprehensive model comparison report
   */
  getCompareReport(modelFilter?: string[]) {
    return getCompareReport(this.gameRepository, modelFilter);
  }
  
  // ==================== EXPORT & REPORTING ====================
  
  /**
   * Generate benchmark report
   */
  generateReport(gameId?: string): Record<string, unknown> {
    try {
      const gameStats = this.getGameStats();
      const modelComparison = getModelComparison(this.gameRepository);
      const agentStats = this.getAgentStats();
      
      const report: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        summary: {
          totalGames: gameStats.totalGames,
          activeGames: gameStats.activeGames,
          completedGames: gameStats.completedGames,
          // MAF-GAP-050: games that never reached a terminal outcome
          // (SETUP / PAUSED / CANCELLED / unknown status). totalGames is
          // the sum of active + completed + failed by construction, so the
          // report always reconciles; failedGameIds makes stuck games
          // auditable instead of invisible.
          failedGames: gameStats.failedGames,
          failedGameIds: this.gameRepository.getFailedGames().map(g => ({
            id: g.id,
            status: g.status,
            createdAt: g.createdAt.toISOString(),
            endedAt: g.endedAt ? g.endedAt.toISOString() : null,
          })),
          mafiaWinRate: gameStats.completedGames > 0 
            ? gameStats.mafiaWins / gameStats.completedGames 
            : 0,
          avgDuration: gameStats.avgDuration,
        },
        modelPerformance: modelComparison.slice(0, 10),
        agentStats: agentStats.slice(0, 10),
        recommendations: generateRecommendations(modelComparison),
      };
      
      if (gameId) {
        try {
          const game = this.gameRepository.getGame(gameId);
          const players = game?.players && game.players.length > 0
            ? game.players
            : getPlayersFromEvents(this.gameRepository, gameId);
          const winner = getGameWinnerFromEvents(this.gameRepository, gameId);
          
          report.game = {
            id: gameId,
            players: players.map(p => ({
              name: p.name,
              role: p.role,
              survived: p.isAlive,
            })),
            winner: winner || (game as any)?.winner || (game?.status === 'ENDED' ? 'UNKNOWN' : 'IN_PROGRESS'),
          };
        } catch {
          report.game = {
            id: gameId,
            players: [],
            winner: 'UNKNOWN',
          };
        }
      }
      
      return report;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Same response contract as the success path (MAF-GAP-028): built
      // from the shared empty-report factory so the fallback can never
      // drift from the real shape.
      return {
        ...createEmptyReport(),
        error: 'Failed to generate report',
        message: msg,
      };
    }
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
    
    rows.push('Metric,Value');
    
    const stats = this.getGameStats();
    rows.push(`Total Games,${stats.totalGames}`);
    rows.push(`Active Games,${stats.activeGames}`);
    rows.push(`Completed Games,${stats.completedGames}`);
    rows.push(`Failed Games,${stats.failedGames}`);
    rows.push(`Mafia Wins,${stats.mafiaWins}`);
    rows.push(`Town Wins,${stats.townWins}`);
    rows.push(`Avg Duration (s),${stats.avgDuration.toFixed(0)}`);
    
    return rows.join('\n');
  }

  // ==================== EXPORT REPORT ====================

  /**
   * Generate comprehensive export report
   */
  getExportReport(games?: number): {
    generatedAt: string;
    summary: {
      totalGames: number;
      activeGames: number;
      completedGames: number;
      failedGames: number;
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
    modelAggregates: ReturnType<typeof getCompareReport>['models'];
    headToHead: ReturnType<typeof getCompareReport>['headToHead'];
  } {
    const gameStats = this.getGameStats();
    const compareReport = getCompareReport(this.gameRepository);

    const totalTokens = this.gameRepository.getDatabase().prepare(
      'SELECT COALESCE(SUM(total_tokens), 0) as total FROM token_usage'
    ).get() as { total: number };
    const totalCost = this.gameRepository.getDatabase().prepare(
      'SELECT COALESCE(SUM(cost), 0) as total FROM token_usage'
    ).get() as { total: number };

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
      let players = this.gameRepository.getPlayers(gameId);
      const events = this.gameRepository.getEvents(gameId);

      // Derive winner from events when games table lacks it
      const eventWinner = getGameWinnerFromEvents(this.gameRepository, gameId);
      const winner = g.status === 'ENDED'
        ? eventWinner || null
        : null;

      // When players table is empty, derive from events
      if (players.length === 0) {
        const eventPlayers = getPlayersFromEvents(this.gameRepository, gameId);
        players = eventPlayers.map(ep => ({
          id: ep.id,
          name: ep.name,
          role: ep.role as 'MAFIA' | 'DOCTOR' | 'SHERIFF' | 'VIGILANTE' | 'VILLAGER' | 'UNASSIGNED',
          isAlive: ep.isAlive,
          isMafia: ep.isMafia,
          joinOrder: 0,
        }));
      }

      const playerDetails = players.map(p => {
        const tokenUsage = this.getPlayerTokenUsage(gameId, p.id);
        const apiCalls = this.getGameAPICalls(gameId).filter(c => c.playerId === p.id);
        const isWinner = winner
          ? (winner === 'MAFIA' ? p.isMafia : !p.isMafia)
          : false;

        return {
          playerId: p.id,
          name: p.name,
          role: p.role,
          // MAF-GAP-012: never fabricate a provider/model — report
          // 'unknown' when the players table has no real value.
          provider: (p as any).provider || 'unknown',
          model: (p as any).model || 'unknown',
          survived: p.isAlive,
          won: isWinner,
          tokensUsed: tokenUsage.reduce((sum, t) => sum + t.totalTokens, 0),
          apiCalls: apiCalls.length,
        };
      });

      const eventLog = events.map(e => {
        let description: string = e.type;
        const data = e.data as Record<string, unknown> | undefined;
        if (e.type === 'AGENT_SAYS_BROADCASTED' && data?.says) {
          description = (data.says as string).substring(0, 100);
        } else if (e.type === 'VOTE_CAST' && data?.targetName) {
          description = `Voted for ${data.targetName}`;
        } else if (e.type === 'MORNING_REVEAL' && data?.deaths) {
          const names = (data.deaths as Array<{ name?: string }>)
            .map(d => d.name || 'unknown').join(', ');
          description = `Deaths: ${names}`;
        } else if (e.type === 'PHASE_CHANGED') {
          description = `Phase: ${e.metadata.phase}`;
        } else if (e.type === 'GAME_STARTED' && e.metadata.phase === 'GAME_OVER') {
          description = `Game over: ${(data?.winner as string) || 'unknown'}`;
        }
        return {
          id: e.id,
          type: e.type,
          description,
          playerId: e.actorId || null,
          timestamp: e.timestamp.toISOString(),
          turnNumber: e.metadata?.turnNumber || 0,
          phase: e.metadata?.phase || '',
        };
      });

      const gameCost = this.getTotalCost(gameId);
      const gameTokens = this.getTotalTokens(gameId);
      const gameAPICalls = this.getGameAPICalls(gameId);
      const errorRate = this.getAPIErrorRate(gameId);

      const tokenBreakdown = this.gameRepository.getDatabase().prepare(
        'SELECT COALESCE(SUM(prompt_tokens), 0) as prompt, COALESCE(SUM(completion_tokens), 0) as completion FROM token_usage WHERE game_id = ?'
      ).get(gameId) as { prompt: number; completion: number };

      const costByModel = this.gameRepository.getDatabase().prepare(
        'SELECT provider, model, SUM(cost) as cost, SUM(total_tokens) as tokens FROM token_usage WHERE game_id = ? GROUP BY provider, model'
      ).all(gameId) as Array<{ provider: string; model: string; cost: number; tokens: number }>;

      const gameDuration = g.startedAt && g.endedAt
        ? g.endedAt.getTime() - g.startedAt.getTime()
        : computeDurationFromEvents(events);

      const lastEvent = events[events.length - 1];
      const dayCount = lastEvent?.metadata?.dayNumber || 1;

      gameRows.push({
        gameId,
        status: g.status,
        dayCount,
        playerCount: players.length,
        duration: gameDuration,
        winner,
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
        failedGames: gameStats.failedGames,
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

    lines.push('# Summary');
    lines.push('Metric,Value');
    lines.push(`Total Games,${report.summary.totalGames}`);
    lines.push(`Active Games,${report.summary.activeGames}`);
    lines.push(`Completed Games,${report.summary.completedGames}`);
    lines.push(`Failed Games,${report.summary.failedGames}`);
    lines.push(`Mafia Wins,${report.summary.mafiaWins}`);
    lines.push(`Town Wins,${report.summary.townWins}`);
    lines.push(`Avg Duration (ms),${report.summary.avgDuration.toFixed(0)}`);
    lines.push(`Total Tokens,${report.summary.totalTokens}`);
    lines.push(`Total Cost,${report.summary.totalCost}`);
    lines.push('');

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

    lines.push('# Cost Breakdown');
    lines.push('Game ID,Provider,Model,Cost,Tokens');
    for (const g of report.games) {
      for (const m of g.costBreakdown.byModel) {
        lines.push([g.gameId, m.provider, m.model, m.cost, m.tokens].join(','));
      }
    }
    lines.push('');

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
