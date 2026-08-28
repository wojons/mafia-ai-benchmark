/**
 * Model assignment routes.
 *
 * Extracted from the monolithic routes/index.ts to reduce file size.
 */

import { Router, Request, Response } from 'express';
import { ServerContext } from '../index.js';

export function createModelsRouter(context: ServerContext): Router {
  const { gameRepository } = context;
  const router = Router();

  // ==================== MODEL CONFIGURATION ====================

  // Get model pricing from API
  router.get('/api/v1/models/pricing', async (req: Request, res: Response) => {
    try {
      const {
        getModelPricing,
        fetchModelMetadata,
        NO_PRICING_MARKER,
      } = await import('@mafia/shared/providers/model-metadata.js');

      const modelId = req.query.model as string;

      if (modelId) {
        // Get pricing for specific model
        const pricing = await getModelPricing(modelId);
        res.json({
          success: true,
          data: {
            modelId,
            ...pricing,
            noPricingMarker: NO_PRICING_MARKER,
          },
        });
      } else {
        // Fetch all models from API
        await fetchModelMetadata();
        const { getCacheStats } = await import(
          '@mafia/shared/providers/model-metadata.js'
        );
        const stats = getCacheStats();

        res.json({
          success: true,
          data: {
            message: 'Use ?model= to get specific model pricing',
            cachedModels: stats.size,
            cacheAge: stats.age,
            noPricingMarker: NO_PRICING_MARKER,
          },
        });
      }
    } catch {
      res
        .status(500)
        .json({ success: false, error: 'Failed to get model pricing' });
    }
  });

  // Calculate cost for a request
  router.post(
    '/api/v1/models/calculate-cost',
    async (req: Request, res: Response) => {
      try {
        const { modelId, inputTokens, outputTokens } = req.body;

        if (!modelId || !inputTokens || !outputTokens) {
          return res.status(400).json({
            success: false,
            error: 'modelId, inputTokens, and outputTokens are required',
          });
        }

        const { calculateCost } = await import(
          '@mafia/shared/providers/model-metadata.js'
        );
        const result = await calculateCost(
          modelId,
          inputTokens,
          outputTokens,
        );

        res.json({
          success: true,
          data: result,
        });
      } catch {
        res
          .status(500)
          .json({ success: false, error: 'Failed to calculate cost' });
      }
    },
  );

  // List available models from providers catalog
  router.get('/api/v1/models', async (req: Request, res: Response) => {
    try {
      const {
        fetchModelMetadata,
        getCacheStats,
      } = await import('@mafia/shared/providers/model-metadata.js');

      // Fetch latest model metadata
      await fetchModelMetadata();

      const provider = req.query.provider as string | undefined;

      if (provider) {
        // Filter by provider
        const { searchModelsByProvider } = await import(
          '@mafia/shared/providers/model-metadata.js'
        );
        const models = await searchModelsByProvider(provider);
        res.json({
          success: true,
          data: models,
          count: models.length,
        });
      } else {
        // Return all models from the providers factory
        const {
          getAvailableProviders,
          getProviderModels,
        } = await import('@mafia/shared/providers/factory.js');
        const providers = getAvailableProviders();
        const stats = getCacheStats();

        // Collect models from each provider
        const providerModels: Array<{
          provider: string;
          modelId: string;
          displayName: string;
        }> = [];
        for (const p of providers) {
          try {
            const models = await getProviderModels(p, 20);
            for (const m of models) {
              providerModels.push({
                provider: p,
                modelId: m.id,
                displayName: m.name,
              });
            }
          } catch {
            // Skip providers that fail
          }
        }

        res.json({
          success: true,
          data: {
            providers,
            models: providerModels,
            totalCached: stats.size,
            cacheAge: stats.age,
          },
        });
      }
    } catch {
      res
        .status(500)
        .json({ success: false, error: 'Failed to list models' });
    }
  });

  // ==================== PLAYER MODEL CONFIGURATION ====================

  // Set model for a specific player in a game
  router.post(
    '/api/v1/games/:gameId/players/:playerIndex/model',
    async (req: Request, res: Response) => {
      try {
        const { gameId, playerIndex } = req.params;
        const { provider, model, temperature, maxTokens, priority } =
          req.body;

        if (!provider || !model) {
          return res.status(400).json({
            success: false,
            error: 'provider and model are required',
          });
        }

        // Verify game exists
        const game = gameRepository.getGame(gameId);
        if (!game) {
          return res
            .status(404)
            .json({ success: false, error: `Game not found: ${gameId}` });
        }

        const assignment = gameRepository.assignPlayerModel(
          gameId,
          parseInt(playerIndex),
          {
            provider,
            model,
            temperature: temperature || 0.7,
            maxTokens: maxTokens || 500,
            priority: priority || 0,
          },
        );

        res.json({
          success: true,
          data: {
            id: assignment.id,
            gameId: assignment.game_id,
            playerIndex: assignment.player_index,
            provider: assignment.provider,
            model: assignment.model,
            temperature: assignment.temperature,
            maxTokens: assignment.max_tokens,
            priority: assignment.priority,
            createdAt: assignment.created_at,
          },
        });
      } catch {
        res
          .status(500)
          .json({ success: false, error: 'Failed to set player model' });
      }
    },
  );

  // Set model for all players with a specific role
  router.post(
    '/api/v1/games/:gameId/role/:role/model',
    async (req: Request, res: Response) => {
      try {
        const { gameId, role } = req.params;
        const { provider, model, temperature, maxTokens, priority } =
          req.body;

        if (!provider || !model) {
          return res.status(400).json({
            success: false,
            error: 'provider and model are required',
          });
        }

        // Verify game exists
        const game = gameRepository.getGame(gameId);
        if (!game) {
          return res
            .status(404)
            .json({ success: false, error: `Game not found: ${gameId}` });
        }

        const assignment = gameRepository.assignRoleModel(gameId, role, {
          provider,
          model,
          temperature: temperature || 0.7,
          maxTokens: maxTokens || 500,
          priority: priority || 0,
        });

        res.json({
          success: true,
          data: {
            id: assignment.id,
            gameId: assignment.game_id,
            role: assignment.role,
            provider: assignment.provider,
            model: assignment.model,
            temperature: assignment.temperature,
            maxTokens: assignment.max_tokens,
            priority: assignment.priority,
            createdAt: assignment.created_at,
          },
        });
      } catch {
        res
          .status(500)
          .json({ success: false, error: 'Failed to set role model' });
      }
    },
  );

  // Bulk update player models
  router.post(
    '/api/v1/games/:gameId/models/bulk',
    async (req: Request, res: Response) => {
      try {
        const { gameId } = req.params;
        const { assignments } = req.body;

        if (!assignments || !Array.isArray(assignments)) {
          return res.status(400).json({
            success: false,
            error: 'assignments array is required',
          });
        }

        // Verify game exists
        const game = gameRepository.getGame(gameId);
        if (!game) {
          return res
            .status(404)
            .json({ success: false, error: `Game not found: ${gameId}` });
        }

        const results = gameRepository.bulkAssignModels(
          gameId,
          assignments,
        );

        res.json({
          success: true,
          data: {
            message: `${results.filter((r) => r.success).length} of ${results.length} assignments saved`,
            results: results.map((r) =>
              r.success
                ? {
                    status: 'saved',
                    id: r.data!.id,
                    playerIndex: r.data!.player_index,
                    role: r.data!.role,
                    provider: r.data!.provider,
                    model: r.data!.model,
                  }
                : {
                    status: 'failed',
                    error: r.error,
                  },
            ),
          },
        });
      } catch {
        res
          .status(500)
          .json({ success: false, error: 'Failed to bulk update models' });
      }
    },
  );

  return router;
}
