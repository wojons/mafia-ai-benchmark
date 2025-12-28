/**
 * Mafia AI Benchmark Server
 * 
 * Main server entry point with Express, WebSocket, and game engine.
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';

import { GameEngine } from './services/game-engine.js';
import { AgentCoordinator } from './services/agent-coordinator.js';
import { EventBus } from './services/event-bus.js';
import { StatsCollector } from './services/stats-collector.js';
import { GameRepository, createDatabase } from './db/repository.js';
import { setupRoutes } from './routes/index.js';
import { setupWebSocket } from './websocket/index.js';

dotenv.config();

const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 3001;

export interface ServerContext {
  gameEngine: GameEngine;
  agentCoordinator: AgentCoordinator;
  eventBus: EventBus;
  statsCollector: StatsCollector;
  gameRepository: GameRepository;
}

async function main(): Promise<void> {
  console.log('🎮 Mafia AI Benchmark Server');
  console.log('================================');
  
  // Initialize database
  console.log('📦 Initializing database...');
  const dbPath = process.env.DB_PATH || './data/mafia.db';
  const { getDatabase } = await import('./db/migrate.js');
  const migrator = getDatabase(dbPath);
  const gameRepository = new GameRepository(migrator.getDatabase());
  console.log('✅ Database initialized');
  
  // Initialize services
  console.log('🔧 Initializing services...');
  
  const eventBus = new EventBus();
  const statsCollector = new StatsCollector(gameRepository);
  const agentCoordinator = new AgentCoordinator(eventBus, statsCollector);
  const gameEngine = new GameEngine(gameRepository, agentCoordinator, eventBus, statsCollector);
  
  const context: ServerContext = {
    gameEngine,
    agentCoordinator,
    eventBus,
    statsCollector,
    gameRepository,
  };
  
  // Initialize Express app
  const app = express();
  const httpServer = createServer(app);
  
  // Middleware
  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    });
    next();
  });
  
  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  });
  
  // API version
  app.get('/api/v1', (req, res) => {
    res.json({
      version: '1.0.0',
      name: 'Mafia AI Benchmark API',
      endpoints: '/api/v1/games, /api/v1/players, /api/v1/agents, /api/v1/stats, /api/v1/benchmark',
    });
  });
  
  // Setup API routes
  setupRoutes(app, context);
  
  // Error handling
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('❌ Server error:', err);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production' 
          ? 'An internal error occurred' 
          : err.message,
      },
    });
  });
  
  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found`,
      },
    });
  });
  
  // Initialize WebSocket server
  const wsServer = new WebSocketServer({ server: httpServer, path: '/ws' });
  setupWebSocket(wsServer, context);
  
  // Start server
  httpServer.listen(PORT, () => {
    console.log(`✅ HTTP Server running on port ${PORT}`);
    console.log(`📡 WebSocket server running on ws://localhost:${PORT}/ws`);
    console.log('');
    console.log('🚀 Server is ready to accept connections');
    console.log('');
    console.log('Available endpoints:');
    console.log(`  GET  /health              - Health check`);
    console.log(`  GET  /api/v1              - API info`);
    console.log(`  GET  /api/v1/games        - List games`);
    console.log(`  POST /api/v1/games        - Create game`);
    console.log(`  GET  /api/v1/stats        - Statistics`);
    console.log(`  POST /api/v1/benchmark    - Run benchmark`);
    console.log('');
  });
  
  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
    
    // Close WebSocket connections
    wsServer.clients.forEach((client: WebSocket) => {
      client.close(1000, 'Server shutting down');
    });
    
    // Close HTTP server
    httpServer.close(() => {
      console.log('✅ HTTP server closed');
    });
    
    // Close database
    migrator.close();
    console.log('✅ Database connection closed');
    
    process.exit(0);
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
