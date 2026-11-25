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
import fs from 'node:fs';

import { GameEngine } from './services/game-engine.js';
import { AgentCoordinator } from './services/agent-coordinator.js';
import { EventBus } from './services/event-bus.js';
import { StatsCollector } from './services/stats-collector.js';
import { BenchmarkRunner } from './services/benchmark-runner.js';
import { LeagueRunner } from './services/league-runner.js';
import { LegacyGameAdapter } from './services/legacy-game-adapter.js';
import GameRepositoryDefault, { GameRepository } from './db/repository.js';
import { createDatabase } from './db/migrate.js';
import { setupRoutes } from './routes/index.js';
import { setupWebSocket } from './websocket/index.js';
import { bodyParseErrorHandler } from './middleware/body-parse-error.js';
import { adminAuthMiddleware } from './middleware/auth.js';
import { DEFAULT_PORT } from './config.js';
import { GameLifecycleReconciler } from './services/game-lifecycle-reconciler.js';
import {
  collectLiveGameIds,
  engineLiveGameSource,
  legacyBridgeLiveGameSource,
} from './services/game-liveness.js';
import {
  STORAGE_GAUGE_REFRESH_MS,
  healthcheckFailed,
  httpMetricsMiddleware,
  refreshStorageGauges,
  registry,
  seedGameCountersFromDatabase,
  seedLlmUsageFromDatabase,
  type MetricsGameSeedDatabase,
  type MetricsSeedDatabase,
  type MetricsStorageDatabase,
} from './observability/metrics.js';
// OBS-005: real health probes (degraded-in-body, HTTP 200 preserved) and a
// LOG_LEVEL-honouring logger, so the two surfaces an operator reads are true.
import { evaluateHealth } from './observability/health-probe.js';
import { logger } from './utils/logger.js';

dotenv.config();

const PORT = process.env.PORT || DEFAULT_PORT;

export interface ServerContext {
  gameEngine: GameEngine;
  agentCoordinator: AgentCoordinator;
  eventBus: EventBus;
  statsCollector: StatsCollector;
  gameRepository: GameRepository;
  benchmarkRunner: BenchmarkRunner;
  leagueRunner: LeagueRunner;
  legacyAdapter: LegacyGameAdapter | null;
  gameLifecycle?: GameLifecycleReconciler;
}

async function main(): Promise<void> {
  logger.info('Mafia AI Benchmark Server');
  const dbPath = process.env.DB_PATH || './data/mafia.db';
  const migrator = createDatabase(dbPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gameRepository = new GameRepositoryDefault((migrator as any).db);

  const eventBus = new EventBus();

  // The reconciler is shared by startup, stats, and game read routes. Its live
  // owner callback intentionally checks both in-memory engines: persisted
  // IN_PROGRESS rows without a current owner are only retained while their
  // heartbeat/event evidence is recent.
  let gameEngine: GameEngine | undefined;
  let legacyAdapter: LegacyGameAdapter | null = null;
  // OBS-003/OBS-006: ONE definition of "live owner" for the whole process. The
  // reconciler (retirement, 24 h window) and the mafia_game_in_progress orphan
  // gauge (alarm) both read this same set, and the set is built by the shared
  // helpers in services/game-liveness.ts — so "a game this process is playing"
  // cannot mean two things, and a legacy game whose bridge child has exited is
  // NOT live even while its persisted last event is seconds old.
  const liveGameIds = (): Set<string> =>
    collectLiveGameIds([
      gameEngine ? engineLiveGameSource(gameEngine) : null,
      legacyAdapter ? legacyBridgeLiveGameSource(legacyAdapter) : null,
    ]);
  const gameLifecycle = new GameLifecycleReconciler(gameRepository, { liveGameIds });

  const statsCollector = new StatsCollector(gameRepository, gameLifecycle);
  const agentCoordinator = new AgentCoordinator(eventBus, statsCollector);
  const initializedGameEngine = new GameEngine(gameRepository, agentCoordinator, eventBus, statsCollector);
  gameEngine = initializedGameEngine;

  // Legacy engine adapter (the path that actually plays games). Created with
  // the same singleton pattern as routes/index.ts so benchmark games and
  // regular games share one adapter instance.
  try {
    legacyAdapter = LegacyGameAdapter.getInstance(eventBus, gameRepository);
    logger.info('✅ Legacy game adapter initialized');
  } catch (e) {
    // OBS-003: this is the boot site where a server that cannot play a single
    // game loses its engine. OBS-005: /health now probes the adapter and
    // reports degraded, so the counter below is the rate signal and the body
    // carries the reason.
    healthcheckFailed('legacy_adapter');
    logger.warn('⚠️ Legacy game adapter not available:', (e as Error).message);
  }

  const bootstrapContext: ServerContext = {
    gameEngine: initializedGameEngine,
    agentCoordinator,
    eventBus,
    statsCollector,
    gameRepository,
    gameLifecycle,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    benchmarkRunner: null as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    leagueRunner: null as any,
    legacyAdapter,
  };
  const benchmarkRunner = new BenchmarkRunner(bootstrapContext);
  bootstrapContext.benchmarkRunner = benchmarkRunner;
  // MAF-LAYER-3: the league runner shares the same adapter/db seams.
  const leagueRunner = new LeagueRunner({
    eventBus,
    gameRepository,
    legacyAdapter,
  });
  bootstrapContext.leagueRunner = leagueRunner;
  const context: ServerContext = bootstrapContext;

  // Retire persisted games whose owner disappeared before serving any reads.
  // The shared read seam below makes this idempotent for rows written later.
  const gameLifecycleSummary = gameLifecycle.reconcile();
  logger.info(
    'Game lifecycle reconciliation: ' +
      `${gameLifecycleSummary.retired} retired, ` +
      `${gameLifecycleSummary.preservedLive} live, ` +
      `${gameLifecycleSummary.preservedRecent} recent, ` +
      `${gameLifecycleSummary.inspected} inspected`,
  );

  // Recover benchmark runs stranded by a previous shutdown before serving
  // traffic: run completion normally depends on in-process event
  // subscriptions, which die with the process. This inspects persisted
  // QUEUED/RUNNING runs and reconciles only runs whose durable game rows
  // prove them terminal (durable-DB-evidence policy — see
  // BenchmarkRunner.reconcileStrandedRuns). Idempotent: a second pass finds
  // nothing to do. A genuinely active run is preserved as-is.
  const reconcileSummary = benchmarkRunner.reconcileStrandedRuns();
  logger.info(
    'Benchmark run reconciliation: ' +
      `${reconcileSummary.reconciled} recovered, ${reconcileSummary.leftActive} left active, ` +
      `${reconcileSummary.inspected} inspected`,
  );

  // OBS-002: prime mafia_benchmark_run_stranded / mafia_benchmark_games_queued
  // from the just-reconciled state, then keep them fresh on a timer. Games can
  // start and finish between run transitions (the run stays RUNNING), so a
  // scrape-only or transition-only refresh would report a stale backlog. The
  // timer is unref'd: it never holds the process open on shutdown.
  benchmarkRunner.refreshRunGauges();
  const benchmarkGaugeTimer = setInterval(() => benchmarkRunner.refreshRunGauges(), 30_000);
  benchmarkGaugeTimer.unref();

  // OBS-003: storage + orphan gauges (spec 3.3). Refreshed at boot and then on
  // an interval ONLY — the row counts are real table counts (events holds
  // ~200k rows), so this must never run on the scrape or request path. Uses
  // the same resolved DB_PATH the migrator opened, and the same live-owner
  // set as the reconciler. Both timers are unref'd.
  const metricsDb = (migrator as unknown as { db: MetricsStorageDatabase }).db;

  // OBS-002: the LLM token/cost counters are CUMULATIVE (spec 3.2 asks "what
  // have we spent, cumulatively, per model"), so they are seeded from the
  // durable token_usage rows at boot and then incremented as this process
  // writes more. Without the seed the counter answers "what has this process
  // spent", which is a different number and can never agree with
  // `SELECT sum(cost) FROM token_usage` on a stack that has history. Runs
  // once, before the listener exists, so no game can slip between seed and
  // first increment.
  const llmSeed = seedLlmUsageFromDatabase(metricsDb as unknown as MetricsSeedDatabase);
  if (llmSeed) {
    logger.info(
      'LLM usage seeded into metrics: ' +
        `${llmSeed.rows} token_usage rows -> ${llmSeed.series.length} series, ` +
        `$${llmSeed.costUsd.toFixed(6)} spend, ` +
        `${llmSeed.promptTokens} prompt tokens, ${llmSeed.completionTokens} completion tokens`,
    );
  } else {
    logger.warn('LLM usage seed skipped (already applied or the database refused the read)');
  }

  // OBS-001 (DF-MAFIA-AI-BENCHMARK-50): mafia_game_ended_total is cumulative
  // too, and the live stack served 0 on every {outcome} beside 4,885 ENDED
  // games — a counter that only knows about THIS process' games. Seed it (and
  // the active gauge, which reads the same games table) from the durable rows
  // once, before the listener exists, exactly like the LLM spend seed above.
  const gameSeed = seedGameCountersFromDatabase(metricsDb as unknown as MetricsGameSeedDatabase);
  if (gameSeed) {
    logger.info(
      'game counters seeded into metrics: ' +
        `${gameSeed.seeded}/${gameSeed.terminal} terminal games -> ${gameSeed.series.length} series ` +
        `(${gameSeed.ended} ended, ${gameSeed.cancelled} cancelled, ${gameSeed.degenerate} degenerate), ` +
        `mafia_game_active=${gameSeed.active ?? 'unread'}`,
    );
  } else {
    logger.warn('game counter seed skipped (already applied or the database refused the read)');
  }

  refreshStorageGauges({ db: metricsDb, dbPath, liveGameIds });
  const storageGaugeTimer = setInterval(() => {
    refreshStorageGauges({ db: metricsDb, dbPath, liveGameIds });
  }, STORAGE_GAUGE_REFRESH_MS);
  storageGaugeTimer.unref();

  const app = express();
  const httpServer = createServer(app);

  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // OBS-001: unauthenticated Prometheus scrape endpoint (spec section 4).
  // Mounted BEFORE the admin auth middleware — the fleet collector cannot
  // send a bearer token in this stack — and before setupRoutes and the 404
  // catch-all. Collection never touches the database, and the try/catch
  // keeps a wedged collector from 500ing the whole scrape: an unhealthy
  // collector still answers, it just answers with a scrape error.
  app.get('/metrics', async (_req, res) => {
    try {
      const body = await registry.metrics();
      res.set('Content-Type', registry.contentType);
      res.end(body);
    } catch (e) {
      logger.error('[metrics] registry collection failed:', (e as Error).message);
      res.status(500).set('Content-Type', 'text/plain; charset=utf-8').end('# mafia metrics collection failed\n');
    }
  });

  // MAF-REV-004: optional admin token auth. Passthrough (disabled) while
  // ADMIN_AUTH_TOKEN is unset; enforces admin credentials for ADMIN-visibility
  // event reads and game creation once it is set.
  app.use(adminAuthMiddleware());

  // OBS-003: request counter + latency histogram (spec 3.3). Mounted after the
  // /metrics route (the scrape is never counted) and after auth (a rejected
  // credential is not an endpoint error), before the routers so req.route
  // carries the matched Express PATTERN by the time 'finish' fires — never the
  // concrete path, so game ids can never become series.
  app.use(httpMetricsMiddleware());

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info(req.method + ' ' + req.path + ' - ' + res.statusCode + ' (' + (Date.now() - start) + 'ms)');
    });
    next();
  });

  // OBS-005: /health PROBES instead of asserting. Both checks are cheap
  // (a constant SELECT; an in-memory adapter lookup), so this is safe to call
  // at Docker's healthcheck cadence. The HTTP status stays 200 even when a
  // check fails — Docker restarts on a failed healthcheck, and a locked or
  // briefly unreadable DB must not flap the container. The truth travels in
  // the body: status 'degraded' plus per-check reasons. Failures also
  // increment mafia_healthcheck_failed_total{check} (OBS-003 family), which is
  // the alertable signal.
  const dbHealthProbe = migrator as unknown as {
    db: { prepare: (sql: string) => { get: () => unknown } };
  };
  const healthHandler = (_req: express.Request, res: express.Response) => {
    const report = evaluateHealth({
      // A held SQLite handle survives `chmod 000`/unlink: a bare SELECT can be
      // answered from the open handle's cache while the database file is no
      // longer readable or writable by this process. So check the file the
      // server actually opened FIRST, then still run the statement — that way a
      // corrupt, locked or detached database fails here too. Both cost
      // microseconds.
      db_write: () => {
        fs.accessSync(dbPath, fs.constants.R_OK | fs.constants.W_OK);
        dbHealthProbe.db.prepare('SELECT 1 AS ok').get();
      },
      // Cheap liveness: a working adapter answers from its in-memory game map.
      // A missing adapter (boot failure, above) is a degraded start, not a
      // 500 — the server still serves reads.
      legacy_adapter: () => {
        if (!legacyAdapter) throw new Error('legacy game adapter is not initialized');
        legacyAdapter.getActiveGames();
      },
    });
    res.json({
      status: report.status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      checks: report.checks,
    });
  };

  app.get('/health', healthHandler);
  app.get('/api/v1/health', healthHandler);

  app.get('/api/v1', (req, res) => {
    res.json({ version: '1.0.0', name: 'Mafia AI Benchmark API', endpoints: '/api/v1/games, /api/v1/agents, /api/v1/stats, /api/v1/benchmark, /api/v1/models' });
  });

  setupRoutes(app, context);

  // Body-parse errors (e.g. malformed JSON) are CLIENT errors: answer 400
  // with the standard error envelope instead of falling through to the
  // generic 500 INTERNAL_ERROR handler below (DF-MAFIA-AI-BENCHMARK-5).
  app.use(bodyParseErrorHandler());

  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Server error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: process.env.NODE_ENV === 'production' ? 'An internal error occurred' : err.message } });
  });

  app.use((req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route ' + req.method + ' ' + req.path + ' not found' } });
  });

  const wsServer = new WebSocketServer({ server: httpServer, path: '/ws' });
  setupWebSocket(wsServer, context);

  httpServer.listen(PORT, () => {
    logger.info('HTTP Server running on port ' + PORT);
    logger.info('POST /api/v1/benchmark    - Run benchmark');
  });

  const shutdown = async (signal: string) => {
    logger.info('Received ' + signal + ', shutting down gracefully...');
    wsServer.clients.forEach((client: WebSocket) => { client.close(1000, 'Server shutting down'); });
    httpServer.close(() => { logger.info('HTTP server closed'); });
    migrator.close();
    logger.info('Database connection closed');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
