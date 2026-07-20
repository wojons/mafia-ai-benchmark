/**
 * API Routes Setup
 * 
 * Mounts all domain route routers for the Mafia AI Benchmark server.
 */

import { Express } from 'express';
import { ServerContext } from '../index.js';
import { LegacyGameAdapter } from '../services/legacy-game-adapter.js';
import { createGamesRouter } from './games.js';
import { createModelsRouter } from './models.js';
import { createStatsRouter } from './stats.js';
import { createBenchmarkRouter } from './benchmark.js';
import { createAgentsRouter } from './agents.js';

export function setupRoutes(app: Express, context: ServerContext): void {
  const { gameEngine, agentCoordinator, statsCollector, gameRepository, eventBus, benchmarkRunner } = context;

  // Initialize legacy game adapter
  let legacyAdapter: LegacyGameAdapter | null = null;
  try {
    legacyAdapter = LegacyGameAdapter.getInstance(eventBus, gameRepository);
    console.log('✅ Legacy game adapter initialized');
  } catch (e) {
    console.warn('⚠️ Legacy game adapter not available:', (e as Error).message);
  }

  // Mount domain routers
  app.use('/', createGamesRouter(context, legacyAdapter));
  app.use('/', createModelsRouter(context));
  app.use('/', createStatsRouter(context));
  app.use('/', createBenchmarkRouter(context));
  app.use('/', createAgentsRouter(context));
}

export default setupRoutes;
