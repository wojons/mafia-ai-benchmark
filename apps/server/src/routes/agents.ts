/**
 * Agent routes.
 *
 * Extracted from the monolithic routes/index.ts to reduce file size.
 */

import { Router, Request, Response } from 'express';
import { ServerContext } from '../index.js';

export function createAgentsRouter(context: ServerContext): Router {
  const { agentCoordinator } = context;
  const router = Router();

  // ==================== AGENTS ====================

  // List registered agents
  router.get('/api/v1/agents', (req: Request, res: Response) => {
    try {
      const agents = agentCoordinator.getAgents();

      res.json({
        success: true,
        data: agents,
      });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Failed to list agents' });
    }
  });

  // Register agent
  router.post('/api/v1/agents', (req: Request, res: Response) => {
    try {
      const {
        id,
        name,
        provider,
        model,
        temperature,
        maxTokens,
        apiKey,
        baseUrl,
      } = req.body;

      agentCoordinator.registerAgent({
        id,
        name,
        provider,
        model,
        temperature,
        maxTokens,
        apiKey,
        baseUrl,
      });

      res.status(201).json({
        success: true,
        data: { id, name, provider, model },
      });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Failed to register agent' });
    }
  });

  // Get agent stats
  router.get('/api/v1/agents/stats', (req: Request, res: Response) => {
    try {
      const stats = agentCoordinator.getAgentStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Failed to get agent stats' });
    }
  });

  return router;
}
