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
  getAggregatedWins,
  getGameWinnerFromEvents,
  computeDurationFromEvents,
  getModelComparison,
  getCompareReport,
  generateRecommendations,
  getMatchups,
  getPlayersFromEvents,
  calculateRolePerformance,
} from './stats-collector/index.js';
