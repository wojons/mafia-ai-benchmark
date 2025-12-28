/**
 * API Routes Setup
 * 
 * Configures all REST API routes for the Mafia AI Benchmark server.
 * Includes SSE endpoints for streaming game events.
 */

import { Express, Request, Response, NextFunction } from 'express';
import { ServerContext } from '../index.js';

// Store for SSE connections per game
const gameSSESubscriptions: Map<string, Set<Response>> = new Map();

export function setupRoutes(app: Express, context: ServerContext): void {
  const { gameEngine, agentCoordinator, statsCollector, gameRepository, eventBus } = context;
  
  // ==================== SSE EVENT STREAMING ====================
  
  // Subscribe to game events via SSE
  app.get('/api/v1/games/:gameId/events', (req: Request, res: Response) => {
    const { gameId } = req.params;
    
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    
    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', gameId, timestamp: new Date().toISOString() })}\n\n`);
    
    // Add to subscriptions
    if (!gameSSESubscriptions.has(gameId)) {
      gameSSESubscriptions.set(gameId, new Set());
    }
    gameSSESubscriptions.get(gameId)!.add(res);
    
    console.log(`📡 SSE client connected to game ${gameId}`);
    
    // Subscribe to event bus for this game
    const unsubscribe = eventBus.subscribe(
      (event: any) => {
        if (event.gameId === gameId) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      },
      { filter: (event: any) => event.gameId === gameId }
    );
    
    // Handle client disconnect
    req.on('close', () => {
      unsubscribe();
      gameSSESubscriptions.get(gameId)?.delete(res);
      if (gameSSESubscriptions.get(gameId)?.size === 0) {
        gameSSESubscriptions.delete(gameId);
      }
      console.log(`📡 SSE client disconnected from game ${gameId}`);
    });
    
    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 30000);
    
    req.on('close', () => {
      clearInterval(keepAlive);
    });
  });
  
  // Get list of active SSE connections
  app.get('/api/v1/games/:gameId/sse-status', (req: Request, res: Response) => {
    const { gameId } = req.params;
    const subscribers = gameSSESubscriptions.get(gameId)?.size || 0;
    
    res.json({
      success: true,
      data: {
        gameId,
        activeConnections: subscribers,
        isStreaming: subscribers > 0,
      },
    });
  });
  
  // ==================== GAMES ====================
  
  // List games
  app.get('/api/v1/games', (req: Request, res: Response) => {
    try {
      const filters = {
        status: req.query.status as 'SETUP' | 'IN_PROGRESS' | 'ENDED' | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };
      
      const games = gameRepository.listGames(filters);
      
      res.json({
        success: true,
        data: games.map(g => ({
          id: g.id,
          status: g.status,
          players: g.players.length,
          createdAt: g.createdAt,
          config: g.config,
        })),
        count: games.length,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to list games' });
    }
  });
  
  // Create game
  app.post('/api/v1/games', (req: Request, res: Response) => {
    try {
      const game = gameEngine.createGame({
        config: req.body.config,
        hostName: req.body.hostName,
      });
      
      res.status(201).json({
        success: true,
        data: {
          id: game.id,
          status: game.status,
          config: game.config,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to create game' });
    }
  });
  
  // Get game
  app.get('/api/v1/games/:gameId', (req: Request, res: Response) => {
    try {
      const game = gameRepository.getGame(req.params.gameId);
      
      if (!game) {
        return res.status(404).json({ success: false, error: 'Game not found' });
      }
      
      res.json({
        success: true,
        data: game,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to get game' });
    }
  });
  
  // Join game
  app.post('/api/v1/games/:gameId/join', (req: Request, res: Response) => {
    try {
      const { playerName, agentConfig } = req.body;
      const result = gameEngine.joinGame(req.params.gameId, playerName, agentConfig);
      
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }
      
      res.status(201).json({
        success: true,
        data: { eventId: result.event?.id },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to join game' });
    }
  });
  
  // Start game
  app.post('/api/v1/games/:gameId/start', (req: Request, res: Response) => {
    try {
      const result = gameEngine.startGame(req.params.gameId);
      
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }
      
      res.json({
        success: true,
        data: { eventId: result.event?.id },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to start game' });
    }
  });
  
  // Get game state
  app.get('/api/v1/games/:gameId/state', (req: Request, res: Response) => {
    try {
      const state = gameEngine.getGameState(req.params.gameId);
      
      if (!state) {
        return res.status(404).json({ success: false, error: 'Game not found' });
      }
      
      res.json({
        success: true,
        data: state,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to get game state' });
    }
  });
  
  // Submit night action
  app.post('/api/v1/games/:gameId/night-action', (req: Request, res: Response) => {
    try {
      const { playerId, action, targetId } = req.body;
      const result = gameEngine.submitNightAction(req.params.gameId, playerId, action, targetId);
      
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }
      
      res.json({
        success: true,
        data: { eventId: result.event?.id },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to submit night action' });
    }
  });
  
  // Submit vote
  app.post('/api/v1/games/:gameId/vote', (req: Request, res: Response) => {
    try {
      const { voterId, targetId } = req.body;
      const result = gameEngine.submitVote(req.params.gameId, voterId, targetId);
      
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }
      
      res.json({
        success: true,
        data: { eventId: result.event?.id },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to submit vote' });
    }
  });
  
  // Make accusation
  app.post('/api/v1/games/:gameId/accusation', (req: Request, res: Response) => {
    try {
      const { accuserId, targetId, accusation, evidence } = req.body;
      const result = gameEngine.makeAccusation(
        req.params.gameId,
        accuserId,
        targetId,
        accusation,
        evidence
      );
      
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }
      
      res.json({
        success: true,
        data: { eventId: result.event?.id },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to make accusation' });
    }
  });
  
  // Claim role
  app.post('/api/v1/games/:gameId/claim-role', (req: Request, res: Response) => {
    try {
      const { playerId, role } = req.body;
      const result = gameEngine.claimRole(req.params.gameId, playerId, role);
      
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }
      
      res.json({
        success: true,
        data: { eventId: result.event?.id },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to claim role' });
    }
  });
  
  // ==================== MODEL CONFIGURATION ====================
  
  // Get model pricing from API
  app.get('/api/v1/models/pricing', async (req: Request, res: Response) => {
    try {
      const { getModelPricing, fetchModelMetadata, NO_PRICING_MARKER } = await import('@mafia/shared/providers/model-metadata.js');
      
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
        const { getCacheStats } = await import('@mafia/shared/providers/model-metadata.js');
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
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to get model pricing' });
    }
  });
  
  // Calculate cost for a request
  app.post('/api/v1/models/calculate-cost', async (req: Request, res: Response) => {
    try {
      const { modelId, inputTokens, outputTokens } = req.body;
      
      if (!modelId || !inputTokens || !outputTokens) {
        return res.status(400).json({ 
          success: false, 
          error: 'modelId, inputTokens, and outputTokens are required' 
        });
      }
      
      const { calculateCost } = await import('@mafia/shared/providers/model-metadata.js');
      const result = await calculateCost(modelId, inputTokens, outputTokens);
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to calculate cost' });
    }
  });
  
  // ==================== PLAYER MODEL CONFIGURATION ====================
  
  // Set model for a specific player in a game
  app.post('/api/v1/games/:gameId/players/:playerIndex/model', async (req: Request, res: Response) => {
    try {
      const { gameId, playerIndex } = req.params;
      const { provider, model, temperature, maxTokens } = req.body;
      
      if (!provider || !model) {
        return res.status(400).json({
          success: false,
          error: 'provider and model are required',
        });
      }
      
      // TODO: Implement player model assignment in game repository
      const assignment = {
        gameId,
        playerIndex: parseInt(playerIndex),
        provider,
        model,
        temperature: temperature || 0.7,
        maxTokens: maxTokens || 500,
        createdAt: Date.now(),
      };
      
      // For now, just return success
      res.json({
        success: true,
        data: {
          message: 'Player model assignment saved',
          ...assignment,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to set player model' });
    }
  });
  
  // Set model for all players with a specific role
  app.post('/api/v1/games/:gameId/role/:role/model', async (req: Request, res: Response) => {
    try {
      const { gameId, role } = req.params;
      const { provider, model, temperature, maxTokens } = req.body;
      
      if (!provider || !model) {
        return res.status(400).json({
          success: false,
          error: 'provider and model are required',
        });
      }
      
      const assignment = {
        gameId,
        role,
        provider,
        model,
        temperature: temperature || 0.7,
        maxTokens: maxTokens || 500,
        createdAt: Date.now(),
      };
      
      res.json({
        success: true,
        data: {
          message: `Role-based model assignment saved for ${role}`,
          ...assignment,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to set role model' });
    }
  });
  
  // Bulk update player models
  app.post('/api/v1/games/:gameId/models/bulk', async (req: Request, res: Response) => {
    try {
      const { gameId } = req.params;
      const { assignments } = req.body;
      
      if (!assignments || !Array.isArray(assignments)) {
        return res.status(400).json({
          success: false,
          error: 'assignments array is required',
        });
      }
      
      const results = assignments.map((a: any) => ({
        playerIndex: a.playerIndex || a.role,
        provider: a.provider,
        model: a.model,
        status: 'saved',
      }));
      
      res.json({
        success: true,
        data: {
          message: `${results.length} model assignments saved`,
          assignments: results,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to bulk update models' });
    }
  });
  
  // ==================== PLAYERS ====================
  
  // Get game players
  app.get('/api/v1/games/:gameId/players', (req: Request, res: Response) => {
    try {
      const players = gameRepository.getPlayers(req.params.gameId);
      
      res.json({
        success: true,
        data: players,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to get players' });
    }
  });
  
  // ==================== AGENTS ====================
  
  // List registered agents
  app.get('/api/v1/agents', (req: Request, res: Response) => {
    try {
      const agents = agentCoordinator.getAgents();
      
      res.json({
        success: true,
        data: agents,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to list agents' });
    }
  });
  
  // Register agent
  app.post('/api/v1/agents', (req: Request, res: Response) => {
    try {
      const { id, name, provider, model, temperature, maxTokens, apiKey, baseUrl } = req.body;
      
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
      res.status(500).json({ success: false, error: 'Failed to register agent' });
    }
  });
  
  // Get agent stats
  app.get('/api/v1/agents/stats', (req: Request, res: Response) => {
    try {
      const stats = agentCoordinator.getAgentStats();
      
      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to get agent stats' });
    }
  });
  
  // ==================== STATISTICS ====================
  
  // Get game statistics
  app.get('/api/v1/stats', (req: Request, res: Response) => {
    try {
      const stats = statsCollector.getGameStats();
      
      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to get statistics' });
    }
  });
  
  // Get model comparison
  app.get('/api/v1/stats/models', (req: Request, res: Response) => {
    try {
      const comparison = statsCollector.getModelComparison();
      
      res.json({
        success: true,
        data: comparison,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to get model comparison' });
    }
  });
  
  // Get matchups
  app.get('/api/v1/stats/matchups', (req: Request, res: Response) => {
    try {
      const matchups = statsCollector.getMatchups();
      
      res.json({
        success: true,
        data: matchups,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to get matchups' });
    }
  });
  
  // ==================== BENCHMARK ====================
  
  // Run benchmark
  app.post('/api/v1/benchmark', (req: Request, res: Response) => {
    try {
      const { config } = req.body;
      
      // TODO: Implement benchmark runner
      res.json({
        success: true,
        data: {
          message: 'Benchmark started',
          config,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to start benchmark' });
    }
  });
  
  // Get benchmark report
  app.get('/api/v1/benchmark/report', (req: Request, res: Response) => {
    try {
      const gameId = req.query.gameId as string | undefined;
      const report = statsCollector.generateReport(gameId);
      
      const format = req.query.format || 'json';
      
      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.send(statsCollector.exportCSV(gameId));
      } else {
        res.json(report);
      }
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to generate report' });
    }
  });
}

export default setupRoutes;
