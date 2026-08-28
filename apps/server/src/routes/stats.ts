/**
 * Statistics routes.
 *
 * Extracted from the monolithic routes/index.ts to reduce file size.
 */

import { Router, Request, Response } from 'express';
import { ServerContext } from '../index.js';
import { getAggregatedWins } from '../services/stats-collector/wins.js';

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
      const aggregatedWins = getAggregatedWins(gameRepository);

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
            ENDED: gameStats.completedGames,
            IN_PROGRESS: gameStats.activeGames,
            CANCELLED: 0,
          },
          wins: {
            mafia:
              aggregatedWins.mafiaWins || gameStats.mafiaWins || 0,
            town:
              aggregatedWins.townWins || gameStats.townWins || 0,
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

  router.get('/api/v1/analytics', (req: Request, res: Response) => {
    try {
      const gameStats = statsCollector.getGameStats();
      const modelComparison = statsCollector.getModelComparison();
      const agentStats = statsCollector.getAgentStats();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eventDist = (statsCollector as any).getEventDistribution
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (statsCollector as any).getEventDistribution()
        : {};

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
            events: 0,
            agents: 0,
            models: modelComparison.length,
          },
          eventBreakdown: eventDist,
          gameTimeline: recentGames,
          performance: {
            models: modelComparison.slice(0, 10),
            agents: agentStats.slice(0, 10),
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
