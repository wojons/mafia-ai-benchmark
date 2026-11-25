/**
 * Stats Collector Service — barrel re-export.
 *
 * This file exists to preserve existing import paths.
 * The actual implementation lives in stats-collector/ sub-modules.
 */

export {
  StatsCollector,
  default,
  TokenUsageRecord,
  APICallRecord,
  AgentSessionRecord,
  GameStats,
  PlayerStatsSummary,
  AgentStats,
  /**
   * PERF-MAFIA-009: the bounded data fingerprint, exported for the
   * regression tests that pin its invalidation semantics and for the
   * isolated cost benchmark against a copy of the live corpus.
   */
  computeReportWatermark,
  getAggregatedWins,
  getGameWinnerFromEvents,
  computeDurationFromEvents,
  getModelComparison,
  getCompareReport,
  /**
   * PERF-MAFIA-5 arm 2: await the deferred compare validation+rebuild (the
   * stale-while-revalidate refresh). Test/ops hook — bypasses the throttle.
   */
  flushCompareRefresh,
  COMPARE_REFRESH_THROTTLE_MS,
  generateRecommendations,
  partitionModelRows,
  isUnattributedModelRow,
  MODEL_MISKEY_PROVIDER,
  getMatchups,
  getPlayersFromEvents,
  calculateRolePerformance,
} from './stats-collector/index.js';
