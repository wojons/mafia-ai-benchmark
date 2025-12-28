/**
 * API Routes Setup
 * 
 * Configures all REST API routes for the Mafia AI Benchmark server.
 */

import { Express, Request, Response, NextFunction } from 'express';
import { ServerContext } from '../index.js';

export function setupRoutes(app: Express, context: ServerContext): void {
  const { gameEngine, agentCoordinator, statsCollector, gameRepository } = context;
  
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
