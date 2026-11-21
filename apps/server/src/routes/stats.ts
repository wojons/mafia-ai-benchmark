/**
 * Statistics routes.
 *
 * Extracted from the monolithic routes/index.ts to reduce file size.
 */

import { Router, Request, Response } from 'express';
import { ServerContext } from '../index.js';
import { getAggregatedWins } from '../services/stats-collector/wins.js';
import { getStatusCensus } from '../services/stats-collector/status-census.js';

/**
 * Cap on the agent rows `/api/v1/analytics` echoes under `performance.agents`
 * (DF-MAFIA-AI-BENCHMARK-52). The benchmark DB carries one agent row per
 * (player, provider, model) — >20k on the live database — so the response
 * keeps the historical 10-row cap, and `totals.agents` reports the size of the
 * list actually served so the two numbers always agree.
 */
const MAX_AGENT_ROWS = 10;
const MAX_MODEL_ROWS = 10;

export function createStatsRouter(context: ServerContext): Router {
  const { statsCollector, gameRepository } = context;
  const router = Router();

  // ==================== STATISTICS ====================

  // Get game statistics
  router.get('/api/v1/stats', (req: Request, res: Response) => {
    try {
      const stats = statsCollector.getGameStats();

      res.json({
        success: true,
        // DF-MAFIA-AI-BENCHMARK-18: data gains a top-level degenerateGames
        // field (count of games excluded from win stats as degenerate).
        // The rest of the envelope (success/data wrapper, field order) is
        // unchanged.
        data: stats,
      });
    } catch {
      res
        .status(500)
        .json({ success: false, error: 'Failed to get statistics' });
    }
  });

  // Get model comparison
  router.get('/api/v1/stats/models', (req: Request, res: Response) => {
    try {
      const comparison = statsCollector.getModelComparison();

      res.json({
        success: true,
        data: comparison,
      });
    } catch {
      res
        .status(500)
        .json({ success: false, error: 'Failed to get model comparison' });
    }
  });

  // Get matchups
  router.get('/api/v1/stats/matchups', (req: Request, res: Response) => {
    try {
      const matchups = statsCollector.getMatchups();

      res.json({
        success: true,
        data: matchups,
      });
    } catch {
      res
        .status(500)
        .json({ success: false, error: 'Failed to get matchups' });
    }
  });

  // ==================== DASHBOARD ====================

  router.get('/api/v1/dashboard', (req: Request, res: Response) => {
    try {
      const gameStats = statsCollector.getGameStats();
      // DF-MAFIA-AI-BENCHMARK-41: both win sides come from ONE population
      // (ENDED, non-mock, non-degenerate — the same WHERE family that
      // produces totals.completed), computed in SQL. The old per-side
      // fallback onto gameStats mixed an event walk over the newest 1000
      // games with the raw column aggregate, so the two sides could not
      // reconcile with this response's own completed count.
      const aggregatedWins = getAggregatedWins(gameRepository);
      // Read the census AFTER getGameStats(): when the lifecycle seam is
      // wired it demotes stale IN_PROGRESS rows to CANCELLED first, so the
      // breakdown describes the same population as totals/recentGames.
      const statusCensus = getStatusCensus(gameRepository);

      const recentGames = gameRepository
        .listGames({ limit: 10, offset: 0 })
        .map((g) => ({
          id: g.id,
          status: g.status,
          createdAt:
            g.createdAt instanceof Date
              ? g.createdAt.getTime()
              : g.createdAt,
          endedAt:
            g.endedAt instanceof Date ? g.endedAt.getTime() : g.endedAt,
        }));

      res.json({
        success: true,
        data: {
          totals: {
            total: gameStats.totalGames,
            active: gameStats.activeGames,
            completed: gameStats.completedGames,
          },
          statusBreakdown: {
            // A literal census of games.status (DF-41): the CANCELLED arm is
            // the real count, not a 0 literal, so the buckets reconcile with
            // totals.total.
            ENDED: statusCensus.ENDED,
            IN_PROGRESS: statusCensus.IN_PROGRESS,
            CANCELLED: statusCensus.CANCELLED,
            // DF-41 acceptance probe reads `.statusBreakdown.cancelled`
            // (lowercase). The documented uppercase keys above are unchanged;
            // this mirror carries the identical census count.
            cancelled: statusCensus.CANCELLED,
          },
          wins: {
            mafia: aggregatedWins.mafiaWins,
            town: aggregatedWins.townWins,
          },
          avgDuration: gameStats.avgDuration || 0,
          recentGames,
        },
      });
    } catch {
      res
        .status(500)
        .json({ success: false, error: 'Failed to get dashboard data' });
    }
  });

  // Get analytics data
  //
  // DF-MAFIA-AI-BENCHMARK-52: `totals.events`, `totals.agents` and
  // `eventBreakdown` used to be hardcoded (`0`, `0`, `{}`) while the same
  // database held hundreds of thousands of events. They are now derived from
  // the database:
  //   totals.events    = COUNT(*) FROM events (repository.getEventStats)
  //   eventBreakdown   = GROUP BY events.type — its values sum to totals.events
  //   totals.agents    = the number of agent rows the same response reports
  //                      under performance.agents (one source array, capped at
  //                      MAX_AGENT_ROWS for payload size), so the two fields
  //                      cannot drift apart or be read as different quantities.
  router.get('/api/v1/analytics', (req: Request, res: Response) => {
    try {
      const gameStats = statsCollector.getGameStats();
      const modelComparison = statsCollector.getModelComparison();
      const agentStats = statsCollector.getAgentStats();
      const eventStats = gameRepository.getEventStats();

      // The agent list is capped for payload size (the live benchmark DB has
      // >20k per-player/per-model agent rows); totals.agents reports the size
      // of the list actually served, never a separate population.
      const agents = agentStats.slice(0, MAX_AGENT_ROWS);

      const recentGames = gameRepository
        .listGames({ limit: 50, offset: 0 })
        .map((g) => ({
          id: g.id,
          status: g.status,
          players: g.players.length,
          createdAt:
            g.createdAt instanceof Date
              ? g.createdAt.getTime()
              : g.createdAt,
        }));

      res.json({
        success: true,
        data: {
          totals: {
            games: gameStats.totalGames,
            events: eventStats.total,
            agents: agents.length,
            models: modelComparison.length,
          },
          eventBreakdown: eventStats.byType,
          gameTimeline: recentGames,
          performance: {
            models: modelComparison.slice(0, MAX_MODEL_ROWS),
            agents,
          },
        },
      });
    } catch {
      res.status(500).json({
        success: false,
        error: 'Failed to get analytics data',
      });
    }
  });

  return router;
}
