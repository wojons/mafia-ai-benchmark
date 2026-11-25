/**
 * League runner routes (MAF-LAYER-3).
 *
 * POST /api/v1/league        — start a league run (mixed models, budget cap)
 * GET  /api/v1/league        — list league runs (most recent first)
 * GET  /api/v1/league/:id    — status + per-game provenance + spend/cap state
 */

import { Router, Request, Response } from 'express';
import { LeagueValidationError } from '../services/league-runner.js';
import type { ServerContext } from '../index.js';

export function createLeagueRouter(context: ServerContext): Router {
  const { leagueRunner } = context;
  const router = Router();

  // ==================== LEAGUE ====================

  // Start a league run
  router.post('/api/v1/league', (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { config?: unknown };
      const config = body.config;
      const result = leagueRunner.start(config as Parameters<typeof leagueRunner.start>[0]);
      res.status(201).json({
        success: true,
        data: {
          leagueId: result.leagueId,
          games: result.games,
          models: result.models,
          seatGroups: result.seatGroups,
          message: `League started: ${result.games} game(s) across ${result.models.length} model(s)`,
        },
      });
    } catch (error) {
      if (error instanceof LeagueValidationError) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      res
        .status(500)
        .json({ success: false, error: 'Failed to start league: ' + (error as Error).message });
    }
  });

  // List league runs (most recent first)
  router.get('/api/v1/league', (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: leagueRunner.listLeagues() });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to list league runs' });
    }
  });

  // Get one league run: status, per-game provenance, spend/cap state
  router.get('/api/v1/league/:leagueId', (req: Request, res: Response) => {
    try {
      const { leagueId } = req.params;
      const detail = leagueRunner.getDetail(leagueId);
      if (!detail) {
        res.status(404).json({
          success: false,
          error: `League run ${leagueId} not found`,
        });
        return;
      }
      res.json({ success: true, data: detail });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to get league run' });
    }
  });

  return router;
}
