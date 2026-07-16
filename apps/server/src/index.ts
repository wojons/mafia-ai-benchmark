/**
 * Mafia AI Benchmark Server
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
import { BenchmarkRunner } from './services/benchmark-runner.js';
import GameRepositoryDefault, { GameRepository } from './db/repository.js';
import { createDatabase } from './db/migrate.js';
import { setupRoutes } from './routes/index.js';
import { setupWebSocket } from './websocket/index.js';

dotenv.config();

const PORT = process.env.PORT || 3000;

export interface ServerContext {
  gameEngine: GameEngine;
  agentCoordinator: AgentCoordinator;
  eventBus: EventBus;
  statsCollector: StatsCollector;
  gameRepository: GameRepository;
  benchmarkRunner: BenchmarkRunner;
}

async function main(): Promise<void> {
  console.log('Mafia AI Benchmark Server');
  const dbPath = process.env.DB_PATH || './data/mafia.db';
  const migrator = createDatabase(dbPath);
  const gameRepository = new GameRepositoryDefault((migrator as any).db);

  const eventBus = new EventBus();
  const statsCollector = new StatsCollector(gameRepository);
  const agentCoordinator = new AgentCoordinator(eventBus, statsCollector);
  const gameEngine = new GameEngine(gameRepository, agentCoordinator, eventBus, statsCollector);

  const bootstrapContext: ServerContext = {
    gameEngine,
    agentCoordinator,
    eventBus,
    statsCollector,
    gameRepository,
    benchmarkRunner: null as any,
  };
  const benchmarkRunner = new BenchmarkRunner(bootstrapContext);
  bootstrapContext.benchmarkRunner = benchmarkRunner;
  const context: ServerContext = bootstrapContext;

  const app = express();
  const httpServer = createServer(app);

  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(req.method + ' ' + req.path + ' - ' + res.statusCode + ' (' + (Date.now() - start) + 'ms)');
    });
    next();
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString(), uptime: process.uptime(), memory: process.memoryUsage() });
  });

  app.get('/api/v1', (req, res) => {
    res.json({ version: '1.0.0', name: 'Mafia AI Benchmark API', endpoints: '/api/v1/games, /api/v1/players, /api/v1/agents, /api/v1/stats, /api/v1/benchmark' });
  });

  setupRoutes(app, context);

  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: process.env.NODE_ENV === 'production' ? 'An internal error occurred' : err.message } });
  });

  app.use((req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route ' + req.method + ' ' + req.path + ' not found' } });
  });

  const wsServer = new WebSocketServer({ server: httpServer, path: '/ws' });
  setupWebSocket(wsServer, context);

  httpServer.listen(PORT, () => {
    console.log('HTTP Server running on port ' + PORT);
    console.log('POST /api/v1/benchmark    - Run benchmark');
  });

  const shutdown = async (signal: string) => {
    console.log('Received ' + signal + ', shutting down gracefully...');
    wsServer.clients.forEach((client: WebSocket) => { client.close(1000, 'Server shutting down'); });
    httpServer.close(() => { console.log('HTTP server closed'); });
    migrator.close();
    console.log('Database connection closed');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
