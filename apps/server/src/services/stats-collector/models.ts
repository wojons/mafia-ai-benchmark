/**
 * Model performance and comparison methods for StatsCollector.
 *
 * Extracted from the monolithic stats-collector.ts to reduce file size.
 */

import type { GameRepository } from '../../db/repository.js';
import { getGameWinnerFromEvents } from './wins.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

/**
 * Get model comparison data, falling back to event-derived data
 * when the players table has no entries.
 */
export function getModelComparison(
  gameRepository: GameRepository,
): Array<{
  provider: string;
  model: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgTokens: number;
  avgCost: number;
  avgLatency: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dbStats: any[];
  try {
    dbStats = gameRepository.getModelStats();
  } catch {
    dbStats = [];
  }
  if (dbStats.length > 0) return dbStats;

  try {
    const allGames = gameRepository.listGames({ limit: 1000, offset: 0 });
    const provider = 'neuralwatt';
    const model = 'qwen3.6-35b-fast';

    let wins = 0;
    let completedGames = 0;
    for (const g of allGames) {
      if (g.status !== 'ENDED') continue;
      completedGames++;
      const winner = getGameWinnerFromEvents(gameRepository, g.id);
      if (winner) wins++;
    }

    return [
      {
        provider,
        model,
        gamesPlayed: completedGames,
        wins,
        winRate: completedGames > 0 ? wins / completedGames : 0,
        avgTokens: 0,
        avgCost: 0,
        avgLatency: 0,
      },
    ];
  } catch (e) {
    console.error(
      'StatsCollector.getModelComparison: failed to compute model comparison data',
      e,
    );
    return [];
  }
}

/**
 * Get comprehensive model comparison report.
 * When the players/token_usage tables are empty (legacy games), derives
 * model and trend data from game events.
 */
export function getCompareReport(
  gameRepository: GameRepository,
  modelFilter?: string[],
): {
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
    rolePerformance: Record<
      string,
      {
        gamesPlayed: number;
        wins: number;
        winRate: number;
      }
    >;
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
  const db = gameRepository.getDatabase();

  const modelList =
    modelFilter && modelFilter.length > 0 ? modelFilter : null;

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

  const modelRows = db
    .prepare(modelQuery)
    .all(...modelParams) as Record<string, unknown>[];

  // ===== Per-model role-specific performance =====
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
  const roleRows = db
    .prepare(roleQuery)
    .all(...roleParams) as Record<string, unknown>[];

  const rolePerfMap = new Map<
    string,
    Record<string, { gamesPlayed: number; wins: number; winRate: number }>
  >();
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
  const costRows = db
    .prepare(costQuery)
    .all(...costParams) as Record<string, unknown>[];

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
  const latencyRows = db
    .prepare(latencyQuery)
    .all(...latencyParams) as Record<string, unknown>[];

  const latencyMap = new Map<string, number>();
  for (const row of latencyRows) {
    latencyMap.set(`${row.provider}/${row.model}`, row.avg_latency as number);
  }

  const models = modelRows.map((row) => {
    const key = `${row.provider}/${row.model}`;
    const gp = row.games_played as number;
    const w = row.wins as number;
    return {
      provider: row.provider as string,
      model: row.model as string,
      gamesPlayed: gp,
      wins: w,
      winRate: gp > 0 ? w / gp : 0,
      avgTokensPerGame: Math.round((row.avg_tokens as number) || 0),
      avgCostPerGame: Math.round((costMap.get(key) || 0) * 10000) / 10000,
      avgLatency: Math.round(latencyMap.get(key) || 0),
      avgRolePerformance:
        Math.round(((row.avg_role_perf as number) || 0) * 100) / 100,
      rolePerformance: rolePerfMap.get(key) || {},
    };
  });

  // ===== Head-to-head =====
  let h2hQuery = 'SELECT * FROM model_matchups WHERE 1=1';
  const h2hParams: string[] = [];
  if (modelList) {
    const aPlaceholders = modelList.map(() => '?').join(',');
    const bPlaceholders = modelList.map(() => '?').join(',');
    h2hQuery += ` AND (model_a IN (${aPlaceholders}) OR model_b IN (${bPlaceholders}))`;
    h2hParams.push(...modelList, ...modelList);
  }
  h2hQuery += ' ORDER BY games_played DESC LIMIT 50';

  const h2hRows = db
    .prepare(h2hQuery)
    .all(...h2hParams) as Record<string, unknown>[];

  const headToHead = h2hRows.map((row) => ({
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

  const trendRows = db
    .prepare(trendQuery)
    .all(...trendParams) as Record<string, unknown>[];

  // Fallback: if no player-level trend data, build from events
  if (trendRows.length === 0) {
    const fallbackModels: AnyRecord[] =
      models.length > 0 ? (models as AnyRecord[]) : getModelComparison(gameRepository);

    const t: AnyRecord[] = [];
    for (const m of fallbackModels) {
      if (modelList && !modelList.includes(m.model)) continue;
      t.push(m);
    }
    const fallbackModels2 = t.length > 0 ? t : fallbackModels;

    const fallbackTrends: Array<{
      model: string;
      games: Array<{
        gameId: string;
        won: boolean;
        role: string;
        tokensUsed: number;
        createdAt: string;
      }>;
      cumulativeWinRate: number[];
    }> = [];
    for (const fm of fallbackModels2) {
      if (modelList && !modelList.includes(fm.model)) continue;

      const allGames = gameRepository.listGames({ limit: 1000, offset: 0 });
      const gameEntries: Array<{
        gameId: string;
        won: boolean;
        role: string;
        tokensUsed: number;
        createdAt: string;
      }> = [];

      for (const g of allGames) {
        if (g.status !== 'ENDED') continue;
        const winner = getGameWinnerFromEvents(gameRepository, g.id);
        gameEntries.push({
          gameId: g.id,
          won: winner !== null,
          role: 'LEGACY',
          tokensUsed: 0,
          createdAt: g.createdAt.toISOString(),
        });
      }

      const cumulativeWinRate: number[] = [];
      let cumulativeWins = 0;
      for (let i = 0; i < gameEntries.length; i++) {
        if (gameEntries[i].won) cumulativeWins++;
        cumulativeWinRate.push(
          Math.round((cumulativeWins / (i + 1)) * 10000) / 10000,
        );
      }
      fallbackTrends.push({
        model: `${fm.provider}/${fm.model}`,
        games: gameEntries,
        cumulativeWinRate,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const normalizedModels: any = fallbackModels2.map((m: AnyRecord) => ({
      provider: m.provider,
      model: m.model,
      gamesPlayed: m.gamesPlayed,
      wins: m.wins,
      winRate: m.winRate,
      avgTokensPerGame: m.avgTokensPerGame ?? m.avgTokens ?? 0,
      avgCostPerGame: m.avgCostPerGame ?? m.avgCost ?? 0,
      avgLatency: m.avgLatency ?? 0,
      avgRolePerformance: m.avgRolePerformance ?? 0,
      rolePerformance: m.rolePerformance ?? {},
    }));
    return {
      models: normalizedModels,
      headToHead,
      trends: fallbackTrends,
    };
  }

  const trendMap = new Map<
    string,
    Array<{
      gameId: string;
      won: boolean;
      role: string;
      tokensUsed: number;
      createdAt: string;
    }>
  >();

  for (const row of trendRows) {
    const modelKey = `${row.provider}/${row.model}`;
    if (!trendMap.has(modelKey)) {
      trendMap.set(modelKey, []);
    }
    trendMap.get(modelKey)!.push({
      gameId: row.game_id as string,
      won: Boolean(row.won),
      role: row.role as string,
      tokensUsed: (row.tokens_used as number) || 0,
      createdAt: new Date(row.created_at as number).toISOString(),
    });
  }

  const trends = Array.from(trendMap.entries()).map(([model, games]) => {
    const cumulativeWinRate: number[] = [];
    let cumulativeWins = 0;
    for (let i = 0; i < games.length; i++) {
      if (games[i].won) cumulativeWins++;
      cumulativeWinRate.push(
        Math.round((cumulativeWins / (i + 1)) * 10000) / 10000,
      );
    }
    return { model, games, cumulativeWinRate };
  });

  return { models, headToHead, trends };
}

/**
 * Generate recommendations based on statistics
 */
export function generateRecommendations(
  modelComparison: Array<{
    provider: string;
    model: string;
    winRate: number;
    avgCost: number;
  }>,
): string[] {
  const recommendations: string[] = [];

  if (modelComparison.length === 0) return recommendations;

  const bestWinRate = modelComparison.reduce(
    (best, m) => (m.winRate > (best?.winRate || 0) ? m : best),
    null as (typeof modelComparison)[0] | null,
  );

  if (bestWinRate) {
    recommendations.push(
      `Best win rate: ${bestWinRate.provider}/${bestWinRate.model} (${(bestWinRate.winRate * 100).toFixed(1)}%)`,
    );
  }

  const bestValue = modelComparison.reduce(
    (best, m) => {
      const value = m.winRate / (m.avgCost || 1);
      const bestCurrent = best ? best.winRate / (best.avgCost || 1) : 0;
      return value > bestCurrent ? m : best;
    },
    null as (typeof modelComparison)[0] | null,
  );

  if (bestValue) {
    recommendations.push(
      `Best value: ${bestValue.provider}/${bestValue.model} (win rate per dollar)`,
    );
  }

  return recommendations;
}
