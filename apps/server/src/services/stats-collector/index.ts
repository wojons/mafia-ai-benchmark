/**
 * Stats Collector Service
 * 
 * Collects and manages game statistics, token usage, and performance metrics.
 */

import { GameRepository } from '../../db/repository.js';
import { v4 as uuidv4 } from 'uuid';
import {
  GameLifecycleReconciler,
  STALE_IN_PROGRESS_MAX_MS,
} from '../game-lifecycle-reconciler.js';
import {
  getGameWinnerFromEvents,
  computeDurationFromEvents,
} from './wins.js';
import {
  getDegenerateGameCounts,
  getDegenerateGameIds,
} from './degenerate.js';
import {
  getMockGameCounts,
  getMockGameIds,
} from './mock.js';
import {
  getModelComparison,
  getCompareReport,
  getModelPerformanceBreakdown,
  generateRecommendations,
  partitionModelRows,
} from './models.js';
import { getMatchups } from './matchups.js';
import { getPlayersFromEvents, calculateRolePerformance } from './players.js';

// ==================== REPORT MEMOIZATION (PERF-MAFIA-2) ====================

/**
 * Cache entry for generateReport(): the watermark fingerprint the report
 * was computed from, and the report itself.
 */
interface ReportCacheEntry {
  watermark: string;
  report: Record<string, unknown>;
  /**
   * PRAGMA data_version snapshot taken when the report was cached. It moves
   * on any cross-connection commit (other processes / connections), while
   * same-connection writes are caught by the per-table watermark itself.
   * Checking both is cheap and closes the foreign-writer hole.
   */
  dataVersion: number;
}

/**
 * PERF-MAFIA-2: generateReport() over the full fleet costs 1.2-1.4s at
 * 4K games / 19.7K token_usage rows (sequential SQL + per-row JS merge in
 * getGameStats / getModelComparison / getAgentStats), identical warm and
 * cold — every dashboard/CLI report render paid full price for identical
 * data. Memoize the no-gameId report keyed by a DATA watermark: identical
 * data re-serves instantly, any write to the report's source tables
 * busts the cache and recomputes. The response shape is unchanged.
 */

/**
 * The generated report is shared per GameRepository instance: production
 * constructs exactly one repository (one cache), while every test builds
 * a fresh in-memory SQLite repository and therefore gets its own clean
 * cache for free — no cross-test contamination and no manual reset API.
 */
const reportCacheByRepo = new WeakMap<GameRepository, ReportCacheEntry>();

/**
 * The data fingerprint ALL report inputs (getGameStats / getModelComparison /
 * getAgentStats / getFailedGames / recommendations) are derived from:
 *   - games: count, per-status count, winner/ended_at/duration/day_count/
 *     total_turns/total_events/total_tokens/total_cost sums, and the sum of
 *     config+status lengths — the length sums catch IN-PLACE mutations the
 *     per-table rowid/timestamp watermark cannot see (e.g. the write-time
 *     mock/degenerate markers flipped later via UPDATE games SET config =
 *     json_set(config, '$.mock', 1): same rows, same statuses, different
 *     bytes),
 *   - players: count + provider/model/alive/mafia/won/tokens_used sums
 *     (models.ts win attribution reads these columns),
 *   - events: count + phase length/type length/turn/day sums (winner-from-
 *     events and degenerate classification read events),
 *   - token_usage / api_calls / agent_sessions: count + max(rowid, timestamp)
 *     + token/cost/latency sums,
 *   - player_model_assignments (legacy model path).
 * Stringified so equality is one === compare. A single query keeps the
 * cache-key cost (~1ms even at 4K games) far below the ~1.3s it guards.
 * Any read failure returns null: the caller then skips the cache entirely
 * (never serving stale data on a broken fingerprint).
 */
function computeReportWatermark(repo: GameRepository): string | null {
  try {
    const db = repo.getDatabase();
    const row = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM games) AS gamesCount,
        (SELECT COUNT(*) FROM games WHERE status = 'IN_PROGRESS') AS gamesActive,
        (SELECT COUNT(*) FROM games WHERE status = 'ENDED') AS gamesEnded,
        (SELECT COUNT(*) FROM games WHERE status NOT IN ('IN_PROGRESS','ENDED')) AS gamesFailed,
        (SELECT COUNT(*) FROM games WHERE winner IS NOT NULL) AS gamesWcol,
        (SELECT COALESCE(SUM(ended_at IS NULL), 0) FROM games) AS gamesEndedNull,
        (SELECT COALESCE(SUM(duration), 0) FROM games) AS gamesDurationSum,
        (SELECT COALESCE(SUM(day_count), 0) FROM games) AS gamesDaySum,
        (SELECT COALESCE(SUM(total_turns), 0) FROM games) AS gamesTurnsSum,
        (SELECT COALESCE(SUM(total_events), 0) FROM games) AS gamesEventsSum,
        (SELECT COALESCE(SUM(total_tokens), 0) FROM games) AS gamesTokensSum,
        (SELECT COALESCE(SUM(total_cost), 0) FROM games) AS gamesCostSum,
        (SELECT COALESCE(SUM(LENGTH(config) + LENGTH(status)), 0) FROM games) AS gamesCfgLen,
        (SELECT COUNT(*) FROM players) AS playersCount,
        (SELECT COALESCE(SUM(LENGTH(COALESCE(provider, '')) + LENGTH(COALESCE(model, ''))), 0) FROM players) AS playersTextLen,
        (SELECT COALESCE(SUM(is_alive), 0) FROM players) AS playersAliveSum,
        (SELECT COALESCE(SUM(is_mafia), 0) FROM players) AS playersMafiaSum,
        (SELECT COALESCE(SUM(COALESCE(won, -1)), 0) FROM players) AS playersWonSum,
        (SELECT COALESCE(SUM(tokens_used), 0) FROM players) AS playersTokensSum,
        (SELECT COUNT(*) FROM events) AS eventsCount,
        (SELECT COALESCE(SUM(LENGTH(COALESCE(type, ''))), 0) FROM events) AS eventsTypeLen,
        (SELECT COALESCE(SUM(LENGTH(COALESCE(phase, ''))), 0) FROM events) AS eventsPhaseLen,
        (SELECT COALESCE(SUM(COALESCE(turn_number, -1)), 0) FROM events) AS eventsTurnSum,
        (SELECT COALESCE(SUM(COALESCE(day_number, -1)), 0) FROM events) AS eventsDaySum,
        (SELECT COUNT(*) FROM token_usage) AS tuCount,
        (SELECT COALESCE(MAX(rowid), 0) FROM token_usage) AS tuMaxRowid,
        (SELECT COALESCE(MAX(timestamp), 0) FROM token_usage) AS tuMaxTs,
        (SELECT COALESCE(SUM(total_tokens), 0) FROM token_usage) AS tuTokensSum,
        (SELECT COALESCE(SUM(cost), 0) FROM token_usage) AS tuCostSum,
        (SELECT COUNT(*) FROM api_calls) AS acCount,
        (SELECT COALESCE(MAX(rowid), 0) FROM api_calls) AS acMaxRowid,
        (SELECT COALESCE(MAX(timestamp), 0) FROM api_calls) AS acMaxTs,
        (SELECT COALESCE(SUM(latency), 0) FROM api_calls) AS acLatencySum,
        (SELECT COUNT(*) FROM agent_sessions) AS sessCount,
        (SELECT COALESCE(MAX(rowid), 0) FROM agent_sessions) AS sessMaxRowid,
        (SELECT COALESCE(MAX(timestamp), 0) FROM agent_sessions) AS sessMaxTs,
        (SELECT COALESCE(SUM(tokens_used), 0) FROM agent_sessions) AS sessTokensSum,
        (SELECT COALESCE(SUM(cost), 0) FROM agent_sessions) AS sessCostSum,
        (SELECT COUNT(*) FROM player_model_assignments) AS pmaCount
    `).get() as Record<string, unknown> | undefined;
    if (!row) return null;
    return JSON.stringify(row);
  } catch {
    // Fingerprint unavailable (schema variant / test double) — skip the
    // cache and compute fresh. Never serve stale data on a broken key.
    return null;
  }
}

/** Cached-report lookup; null = compute fresh. */
function getCachedReport(
  repo: GameRepository,
): ReportCacheEntry | null {
  // data_version bumps on every transaction COMMITTED BY ANOTHER CONNECTION;
  // it does not move for same-connection writes. Skip the cache on any
  // cross-connection commit since the last report — covers foreign writers
  // without paying a checksum on every hit.
  try {
    const version = repo.getDatabase().pragma('data_version', { simple: true }) as number;
    const entry = reportCacheByRepo.get(repo);
    if (!entry) return null;
    if (entry.dataVersion !== version) return null;
    return entry;
  } catch {
    return null;
  }
}

/** Store a freshly computed full report under its watermark + data_version. */
function storeCachedReport(
  repo: GameRepository,
  watermark: string,
  report: Record<string, unknown>,
): void {
  try {
    const version = repo.getDatabase().pragma('data_version', { simple: true }) as number;
    reportCacheByRepo.set(repo, { watermark, report, dataVersion: version });
  } catch {
    // best-effort: cache miss next time
  }
}

// ==================== COMPARE MEMOIZATION (PERF-MAFIA-3) ====================

/**
 * PERF-MAFIA-3: GET /api/v1/benchmark/compare cost 2.3-2.5s warm and cold
 * at the 4K+ game corpus (every request pays full price for identical data)
 * while /benchmark/report re-serves its full-fleet report from the
 * PERF-MAFIA-2 watermark cache in microseconds. Memoize the compare report
 * on the SAME data-watermark mechanism, keyed per GameRepository
 * (module-level WeakMap — no external cache dep) and per `?models=` filter.
 */

export type CompareReport = ReturnType<typeof getCompareReport>;

interface CompareCacheEntry {
  watermark: string;
  report: CompareReport;
  /**
   * PRAGMA data_version snapshot taken when the report was cached (same
   * foreign-writer guard as the PERF-MAFIA-2 report cache).
   */
  dataVersion: number;
}

/**
 * One map per GameRepository instance, keyed by the normalized filter:
 * alternating `?models=` variants (dashboard switching between the
 * unfiltered leaderboard and a filtered subset) must not thrash — each
 * filter rides its OWN watermark entry. Tests get clean caches for free.
 */
const compareCacheByRepo = new WeakMap<
  GameRepository,
  Map<string, CompareCacheEntry>
>();

/**
 * The compare fingerprint: the COMPLETE report watermark (every
 * games/players/events/token_usage/api_calls/agent_sessions/
 * player_model_assignments input is covered by computeReportWatermark) PLUS
 * the sources getCompareReport() reads beyond it:
 *   - benchmark_games: count + winner/team_winner/error/model_a/model_b
 *     length sums + valid + completed_at sum — the head-to-head derivation
 *     (deriveMatchupsFromBenchmarkGames) reads exactly these columns and a
 *     a winner UPDATE on a benchmark_games row changes none of the base
 *     watermark's tables;
 *   - model_matchups: count + aggregate/winner-sum + model name lengths —
 *     the persisted head-to-head source;
 *   - players role-length sum: the compare-specific rolePerformance cells
 *     and avgRolePerformance GROUP BY p.role, which the base watermark's
 *     player sums do not cover;
 *   - player_model_assignments: max(rowid) + provider/model/role/game_id
 *     length sums — the legacy fallback-trend entries come from this table
 *     and the base watermark covers only its row count (an in-place role
 *     or provider UPDATE would otherwise ride a same-count cache hit).
 * Combined into one stringified two-element array (base fingerprint + extra
 * fingerprint) so equality is one === compare. A read failure returns null:
 * the caller then skips the cache entirely (never serving stale data on a
 * broken fingerprint).
 */
function computeCompareWatermark(repo: GameRepository): string | null {
  const base = computeReportWatermark(repo);
  if (base === null) return null;
  try {
    const db = repo.getDatabase();
    const row = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM benchmark_games) AS bgCount,
        (SELECT COALESCE(SUM(LENGTH(COALESCE(winner, '')) + LENGTH(COALESCE(team_winner, '')) + LENGTH(COALESCE(error, '')) + LENGTH(COALESCE(model_a, '')) + LENGTH(COALESCE(model_b, '')) + valid + COALESCE(completed_at, 0)), 0) FROM benchmark_games) AS bgFp,
        (SELECT COUNT(*) FROM model_matchups) AS mmCount,
        (SELECT COALESCE(SUM(games_played + model_a_wins + model_b_wins + ties + LENGTH(COALESCE(model_a, '')) + LENGTH(COALESCE(model_b, ''))), 0) FROM model_matchups) AS mmFp,
        (SELECT COALESCE(SUM(LENGTH(COALESCE(role, ''))), 0) FROM players) AS playersRoleLen,
        (SELECT COALESCE(MAX(rowid), 0) FROM player_model_assignments) AS pmaMaxRowid,
        (SELECT COALESCE(SUM(LENGTH(COALESCE(provider, '')) + LENGTH(COALESCE(model, '')) + LENGTH(COALESCE(role, '')) + LENGTH(COALESCE(game_id, ''))), 0) FROM player_model_assignments) AS pmaTextLen
    `).get() as Record<string, unknown> | undefined;
    if (!row) return null;
    return JSON.stringify([base, row]);
  } catch {
    // Extra fingerprint unavailable (older schema / partial store) — skip
    // the cache and compute fresh. Never serve stale data on a broken key.
    return null;
  }
}

/** Cached-compare lookup; null = compute fresh. */
function getCachedCompareReport(
  repo: GameRepository,
  cacheKey: string,
): CompareCacheEntry | null {
  // Same cross-connection guard as the report cache: data_version moves on
  // any commit BY ANOTHER CONNECTION (foreign writers), while
  // same-connection writes are caught by the watermark itself.
  try {
    const version = repo.getDatabase().pragma('data_version', { simple: true }) as number;
    const entry = compareCacheByRepo.get(repo)?.get(cacheKey);
    if (!entry) return null;
    if (entry.dataVersion !== version) return null;
    return entry;
  } catch {
    return null;
  }
}

/** Store a freshly computed compare report under filter + watermark + version. */
function storeCachedCompareReport(
  repo: GameRepository,
  cacheKey: string,
  watermark: string,
  report: CompareReport,
): void {
  try {
    const version = repo.getDatabase().pragma('data_version', { simple: true }) as number;
    let byFilter = compareCacheByRepo.get(repo);
    if (!byFilter) {
      byFilter = new Map();
      compareCacheByRepo.set(repo, byFilter);
    }
    byFilter.set(cacheKey, { watermark, report, dataVersion: version });
  } catch {
    // best-effort: cache miss next time
  }
}

// ==================== RE-EXPORTS ====================
export { getAggregatedWins } from './wins.js';
export { getGameWinnerFromEvents, computeDurationFromEvents } from './wins.js';
export { getDegenerateGameCounts, getDegenerateGameIds } from './degenerate.js';
export { getMockGameCounts, getMockGameIds } from './mock.js';
export {
  getModelComparison,
  getCompareReport,
  generateRecommendations,
  partitionModelRows,
  isUnattributedModelRow,
  MODEL_MISKEY_PROVIDER,
} from './models.js';
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
  /**
   * DF-MAFIA-AI-BENCHMARK-18: count of ENDED games excluded from the
   * mafiaWins/townWins aggregates as degenerate (all-empty SAYS + short
   * duration, or flagged by the legacy adapter). Data stays in the DB.
   */
  degenerateGames: number;
  /**
   * DF-MAFIA-AI-BENCHMARK-12: count of ENDED games flagged mock (every
   * provider call fell back to the canned-mock fallback — zero real
   * tokens). Excluded from win counts, data stays in the DB, surfaced
   * so the exclusion is auditable rather than silent.
   */
  mockGames: number;
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
 * DF-MAFIA-AI-BENCHMARK-23: an IN_PROGRESS row only counts as an ACTIVE
 * game when it started within this window. The live DB carried 97 such
 * zombie rows (legacy orphans, oldest 2026-06-21) that /api/v1/stats
 * reported as "Active Games" forever; only genuinely-fresh games count.
 * NULL started_at never counts as active.
 */
export const ACTIVE_FRESHNESS_MS = STALE_IN_PROGRESS_MAX_MS;

/** Count cancelled rows for the report's explicit population buckets. */
function getCancelledGameCount(repo: GameRepository): number {
  try {
    const row = repo.getDatabase().prepare(
      "SELECT COUNT(*) AS count FROM games WHERE status = 'CANCELLED'",
    ).get() as { count: number };
    return row.count;
  } catch {
    return 0;
  }
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
      mockGames: 0,
      inProgress: 0,
      cancelledGames: 0,
      failedGameIds: [],
      mafiaWinRate: 0,
      avgDuration: 0,
    },
    modelPerformance: [],
    // DF-MAFIA-AI-BENCHMARK-33: same always-present contract as
    // modelPerformance — the bucket shape is stable even on the error path.
    unattributedModels: [],
    agentStats: noAgentStats,
    recommendations: [],
  };
}

export class StatsCollector {
  private gameRepository: GameRepository;
  private gameLifecycle?: GameLifecycleReconciler;
  
  constructor(gameRepository: GameRepository, gameLifecycle?: GameLifecycleReconciler) {
    this.gameRepository = gameRepository;
    this.gameLifecycle = gameLifecycle;
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
   *
   * Winner counts come from a SINGLE consistent source (MAF-GAP-060): the
   * games.winner column when EVERY ended game has a non-NULL winner
   * (hasCompleteWinnerColumn), otherwise the GAME_OVER event stream
   * (getWinnerEventCounts). The old per-side mixing — column for one side,
   * events for the other — produced impossible totals like mafiaWins=48 +
   * townWins=13 != completedGames.
   */
  getGameStats(): GameStats {
    // Reconcile persisted lifecycle state before calculating any aggregate so
    // stats and the games read surface observe the same population.
    this.gameLifecycle?.reconcile();
    const stats = this.gameRepository.getGameStats();
    // Winner aggregates exclude mock and degenerate games. Keep the
    // completed-game denominator on that same eligible population, using a
    // set so a game carrying both exclusion markers is removed only once.
    const degenerateGameIds = getDegenerateGameIds(this.gameRepository);
    const mockGameIds = getMockGameIds(this.gameRepository);
    const excludedCompletedGameIds = new Set([...degenerateGameIds, ...mockGameIds]);

    let mafiaWins: number;
    let townWins: number;
    if (this.gameRepository.hasCompleteWinnerColumn()) {
      // Column counts are already degenerate-filtered in the repository
      // (DF-MAFIA-AI-BENCHMARK-18) — the degenerateGames count is the
      // repository's set-based count over all ENDED games.
      mafiaWins = stats.mafiaWins;
      townWins = stats.townWins;
    } else {
      // Event-derived counts: exclude degenerate games (all-empty SAYS +
      // short duration / explicitly flagged) from the event-derived side
      // too — same exclusion rule, same source.
      const excluded = new Set(degenerateGameIds);
      const eventWins = this.gameRepository.getWinnerEventCounts();
      const eventDegenerate = getDegenerateGameCounts(this.gameRepository);
      // Re-walk ended games to attribute event counts per game: cheaper
      // than SQL when the winner-column path is not used.
      mafiaWins = eventWins.mafiaWins;
      townWins = eventWins.townWins;
      // getWinnerEventCounts counts only decisive GAME_OVER events — the
      // excluded ids subtract the degenerate share from each side.
      let degenerateMafia = 0;
      let degenerateTown = 0;
      for (const id of excluded) {
        const winner = getGameWinnerFromEvents(this.gameRepository, id);
        if (winner === 'MAFIA') degenerateMafia += 1;
        else if (winner === 'TOWN') degenerateTown += 1;
      }
      // DF-MAFIA-AI-BENCHMARK-12: mock games are excluded from the
      // event-derived side with the same subtraction rule — the mock
      // marker is the write-time flag, so read it back per game.
      const mockExcluded = new Set(mockGameIds);
      let mockMafia = 0;
      let mockTown = 0;
      for (const id of mockExcluded) {
        const winner = getGameWinnerFromEvents(this.gameRepository, id);
        if (winner === 'MAFIA') mockMafia += 1;
        else if (winner === 'TOWN') mockTown += 1;
      }
      mafiaWins = Math.max(0, mafiaWins - degenerateMafia - mockMafia);
      townWins = Math.max(0, townWins - degenerateTown - mockTown);
      void eventDegenerate;
    }

    let activeGames: number;
    if (this.gameLifecycle) {
      // The lifecycle seam has already retired rows with stale heartbeat/event
      // evidence and preserved rows owned by a live in-memory engine. Count
      // exactly the remaining persisted IN_PROGRESS population.
      const activeRow = this.gameRepository.getDatabase().prepare(`
        SELECT COUNT(*) as count FROM games WHERE status = 'IN_PROGRESS'
      `).get() as { count: number };
      activeGames = activeRow.count;
    } else {
      // Compatibility fallback for callers that construct StatsCollector
      // without the production lifecycle seam (older embedders/tests).
      try {
        const freshRow = this.gameRepository.getDatabase().prepare(`
          SELECT COUNT(*) as count FROM games
          WHERE status = 'IN_PROGRESS'
            AND started_at IS NOT NULL
            AND started_at >= ?
        `).get(Date.now() - ACTIVE_FRESHNESS_MS) as { count: number };
        activeGames = freshRow.count;
      } catch {
        activeGames = stats.activeGames;
      }
    }

    // MAF-GAP-050 reconciliation identity (total = active + completed +
    // failed) must keep holding. With the lifecycle seam, stale rows are
    // CANCELLED before this point and are already included in failedGames.
    const demotedFromActive = this.gameLifecycle
      ? 0
      : Math.max(0, stats.activeGames - activeGames);
    const failedGames = stats.failedGames + demotedFromActive;

    return {
      totalGames: stats.totalGames,
      activeGames,
      // Keep the denominator aligned with the winner aggregates: mock and
      // degenerate ENDED rows remain auditable through their public counts,
      // but are outside the benchmark population.
      completedGames: Math.max(0, stats.completedGames - excludedCompletedGameIds.size),
      failedGames,
      avgDuration: stats.avgDuration,
      mafiaWins,
      townWins,
      degenerateGames: stats.degenerateGames,
      mockGames: stats.mockGames,
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
   * Get comprehensive model comparison report.
   *
   * PERF-MAFIA-3: the compare report is memoized on the same data-watermark
   * mechanism the full-fleet report uses (PERF-MAFIA-2) — identical data
   * re-serves from the cache in microseconds instead of paying ~2.4s of
   * sequential SQL + per-row JS merge at the 4K+ game corpus. The cache is
   * keyed per GameRepository (WeakMap) AND per normalized `?models=` filter
   * (a filtered call never re-serves an unfiltered report), and the extra
   * fingerprint adds the compare-only sources
   * (benchmark_games / model_matchups / players.role) so the head-to-head
   * derivation busts the cache too. A failed fingerprint always recomputes
   * (fail-safe by construction — never serve stale data).
   */
  getCompareReport(modelFilter?: string[]) {
    // PERF-MAFIA-3: normalized filter key — order-insensitive collapse of
    // adjacent/empty segments happens in the route layer; here only an
    // absent filter and a present one are told apart.
    const cacheKey =
      modelFilter && modelFilter.length > 0
        ? JSON.stringify(modelFilter)
        : 'unfiltered';

    // ---------------- PERF-MAFIA-3 compare memoization ----------------
    // Fingerprint the data ONCE, BEFORE building: identical data re-serves
    // the cached report instantly, and the same fingerprint stores the
    // freshly built report under the exact data it was computed from. A
    // BROKEN fingerprint (null — schema variant / test double) means
    // uncacheable: compute fresh every call, NEVER memoize (fail-safe by
    // construction — the cache can never serve stale data).
    const currentWatermark = computeCompareWatermark(this.gameRepository);
    const cached = currentWatermark !== null
      ? getCachedCompareReport(this.gameRepository, cacheKey)
      : null;
    if (cached && cached.watermark === currentWatermark) {
      // Identical data fingerprint and no foreign commit since cache
      // time: identical input — identical report. Serve instantly.
      return cached.report;
    }

    // Cache miss (foreign write, watermark change, filter change, or the
    // fingerprint itself failed).
    // PERF-MAFIA-3: no try/catch here — if the underlying
    // getCompareReport() throws, the error propagates to the route's 500
    // path UNCHANGED and the store call below is never reached, so an
    // error fallback is never memoized (the next call retries).
    const report = getCompareReport(this.gameRepository, modelFilter);

    // PERF-MAFIA-3: store the built report under the watermark captured
    // BEFORE building. If the data changed mid-build the stored
    // fingerprint no longer matches, so the next call recomputes.
    if (currentWatermark !== null) {
      storeCachedCompareReport(
        this.gameRepository,
        cacheKey,
        currentWatermark,
        report,
      );
    }
    return report;
  }

  // ==================== EXPORT & REPORTING ====================

  /**
   * Generate benchmark report.
   *
   * PERF-MAFIA-2: the full-fleet report (no gameId) is memoized on a data
   * watermark inside computeReportWatermark() — identical data re-serves
   * from the cache in microseconds instead of paying ~1.3s of sequential
   * SQL + per-row JS merge. Any write to the report's source tables
   * (games/players/events/token_usage/api_calls/agent_sessions/
   * player_model_assignments, including in-place config and status
   * updates) changes the watermark and busts the cache. Reports scoped to
   * a single gameId always compute fresh (cheap, event-walk path).
   * generatedAt stays the time the report was GENERATED — a cache hit
   * re-serves the original timestamp, which is honest: the data is the
   * same, the report is the same report.
   */
  generateReport(gameId?: string): Record<string, unknown> {
    // ---------------- PERF-MAFIA-2 report memoization ----------------
    // The full-fleet report (no gameId) is cached on a data watermark.
    // pendingWatermark holds the fingerprint of the moment the cache
    // missed, so the freshly built report can be stored under the exact
    // data it was computed from.
    let pendingWatermark: string | null = null;
    if (!gameId) {
      const cached = getCachedReport(this.gameRepository);
      if (cached) {
        const currentWatermark = computeReportWatermark(this.gameRepository);
        if (currentWatermark !== null && currentWatermark === cached.watermark) {
          // Identical data fingerprint and no foreign commit since cache
          // time: identical input — identical report. Serve instantly.
          return cached.report;
        }
      }
      // No usable cache entry (foreign write, watermark change, or the
      // fingerprint itself failed).
      pendingWatermark = computeReportWatermark(this.gameRepository);
    }

    try {
      const gameStats = this.getGameStats();
      const mockGames = getMockGameCounts(this.gameRepository);
      const cancelledGames = getCancelledGameCount(this.gameRepository);
      // The repository's legacy failedGames bucket includes CANCELLED rows.
      // Publish those rows separately while keeping actual failed rows in the
      // failedGames field so the population buckets are disjoint.
      const failedGames = Math.max(0, gameStats.failedGames - cancelledGames);
      const modelComparison = getModelComparison(this.gameRepository);
      const agentStats = this.getAgentStats();

      // DF-MAFIA-AI-BENCHMARK-33: the legacy cost-tracker recorded usage
      // under the CUSTOM passthrough with the provider name in the model
      // column ('CUSTOM/openai' — avg 810K tokens/game) and legacy player
      // rows carry the same family ('CUSTOM/qwen3.6-35b-fast'). Those rows
      // name no comparable real model, so they must not render beside the
      // competitors — but silently dropping them would hide 208+ games of
      // usage from the audit. Bucket them explicitly instead: the report
      // keeps an `unattributedModels` array with the same row shape plus a
      // `key` field, and modelPerformance carries only real models. Rows
      // that DO resolve behind the passthrough ('CUSTOM/openai/gpt-4o-mini')
      // were re-keyed to their real provider/model at normalization
      // (MAF-GAP-045) and stay in the main table.
      const { real: realModelRows, unattributed: unattributedModels } =
        partitionModelRows(modelComparison);

      const report: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        summary: {
          totalGames: gameStats.totalGames,
          activeGames: gameStats.activeGames,
          inProgress: gameStats.activeGames,
          completedGames: gameStats.completedGames,
          mockGames,
          // MAF-GAP-050: games that never reached a terminal outcome
          // (SETUP / PAUSED / unknown status). CANCELLED is published in its
          // own bucket below so every game occupies exactly one population
          // bucket without changing the completed-game denominator.
          failedGames,
          cancelledGames,
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
        modelPerformance: realModelRows.slice(0, 10),
        // DF-MAFIA-AI-BENCHMARK-39: legacy CUSTOM/* mis-key aggregates,
        // bucketed for auditability instead of rendering as competitor rows
        // (or being silently dropped). Same row shape + `key`.
        unattributedModels,
        agentStats: agentStats.slice(0, 10),
        recommendations: generateRecommendations(realModelRows),
      };

      // DF-MAFIA-AI-BENCHMARK-39: every served model row carries the
      // per-role + per-numPlayers breakdown from the REAL players rows
      // (same shared builder /benchmark/compare uses), so a blended
      // winRate can never be read as a role-lottery skill score. No
      // breakdown data -> honest empty maps, never fabricated cells.
      const breakdownMap = getModelPerformanceBreakdown(this.gameRepository);
      const modelPerformance = realModelRows.slice(0, 10).map((row) => {
        const breakdown = breakdownMap.get(`${row.provider}/${row.model}`);
        return {
          ...row,
          rolePerformance: breakdown?.rolePerformance ?? {},
          byNumPlayers: breakdown?.byNumPlayers ?? {},
        };
      });
      report.modelPerformance = modelPerformance;
      
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      
      // PERF-MAFIA-2: store the built report under the watermark captured
      // BEFORE building. If the data changed mid-build the stored
      // fingerprint no longer matches, so the next call recomputes —
      // fail-safe by construction, never serves stale data.
      if (!gameId && pendingWatermark !== null) {
        storeCachedReport(this.gameRepository, pendingWatermark, report);
      }
      return report;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Same response contract as the success path (MAF-GAP-028): built
      // from the shared empty-report factory so the fallback can never
      // drift from the real shape.
      // PERF-MAFIA-2: the error fallback is NEVER memoized — the next
      // call retries generation (and may succeed once the failure clears).
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
  exportCSV(_gameId?: string): string {
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: (p as any).provider || 'unknown',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
