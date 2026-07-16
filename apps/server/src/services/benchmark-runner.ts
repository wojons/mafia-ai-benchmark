/**
 * Benchmark Runner Service
 *
 * Orchestrates benchmark runs: creates games from model pairings, persists the
 * run and per-game metadata, and tracks progress/cancellation.
 */

import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { LLMProvider } from '@mafia/shared/types';
import type { GameEngine } from './game-engine.js';
import type { AgentCoordinator } from './agent-coordinator.js';
import type { EventBus } from './event-bus.js';
import type { StatsCollector } from './stats-collector.js';
import type { GameRepository } from '../db/repository.js';

/** Configuration accepted by POST /api/v1/benchmark. */
export interface BenchmarkConfig {
  models: string[];
  gamesPerPairing?: number;
  numPlayers?: number;
  temperature?: number;
}

export type BenchmarkRunStatusValue =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export interface StartRunResult {
  runId: string;
  totalGames: number;
  pairings: Array<{
    id: string;
    modelA: string;
    modelB: string;
    games: number;
  }>;
}

export interface BenchmarkRunStatus {
  runId: string;
  status: BenchmarkRunStatusValue;
  config: BenchmarkConfig;
  createdAt: number;
  completedAt: number | null;
  summary: Record<string, unknown> | null;
  error: string | null;
  totalGames: number;
}

export interface BenchmarkProgress {
  runId: string;
  status: BenchmarkRunStatusValue;
  totalGames: number;
  completedGames: number;
  validGames: number;
  failedGames: number;
  pairings: Array<{
    id: string;
    modelA: string;
    modelB: string;
    games: number;
    completed: number;
  }>;
}

interface BenchmarkRunRow {
  id: string;
  config: string;
  status: string;
  created_at: number;
  completed_at: number | null;
  updated_at: number;
  summary: string | null;
  error: string | null;
}

interface BenchmarkGameRow {
  game_id: string;
  run_id: string;
  pairing_id: string;
  model_a: string;
  model_b: string;
  seed: number;
  model_a_role: string;
  model_b_role: string;
  winner: string | null;
  team_winner: string | null;
  completed_at: number | null;
  error: string | null;
  valid: number;
}

interface PairingSchedule {
  pairingId: string;
  modelA: string;
  modelB: string;
  count: number;
}

export class BenchmarkRunner {
  private gameEngine: GameEngine;
  private agentCoordinator: AgentCoordinator;
  private eventBus: EventBus;
  private statsCollector: StatsCollector;
  private gameRepository: GameRepository;
  private db: Database.Database;

  constructor(deps: {
    gameEngine: GameEngine;
    agentCoordinator: AgentCoordinator;
    eventBus: EventBus;
    statsCollector: StatsCollector;
    gameRepository: GameRepository;
  }) {
    this.gameEngine = deps.gameEngine;
    this.agentCoordinator = deps.agentCoordinator;
    this.eventBus = deps.eventBus;
    this.statsCollector = deps.statsCollector;
    this.gameRepository = deps.gameRepository;
    this.db = this.gameRepository.getDatabase();
  }

  /**
   * Start a benchmark run: validate config, build the pairing schedule, create
   * + launch all games, persist the run, and return immediately. Games run
   * asynchronously via the game engine / event bus.
   */
  start(config: BenchmarkConfig): StartRunResult {
    const normalized = this.validateConfig(config);
    const runId = uuidv4();
    const schedule = this.buildSchedule(normalized);
    const now = Date.now();

    // Persist the run row up-front (QUEUED -> RUNNING once games are launched).
    this.persistRun(runId, normalized, 'QUEUED', now);

    const launchedGameIds: string[] = [];

    try {
      for (const pairing of schedule) {
        for (let i = 0; i < pairing.count; i++) {
          const gameId = this.launchGame(
            runId,
            pairing,
            i,
            normalized,
          );
          if (gameId) {
            launchedGameIds.push(gameId);
          }
        }
      }

      // Mark the run as RUNNING now that games have been created.
      this.updateRunStatus(runId, 'RUNNING', now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failRun(runId, message, now);
      throw error;
    }

    const pairings = schedule.map((p) => ({
      id: p.pairingId,
      modelA: p.modelA,
      modelB: p.modelB,
      games: p.count,
    }));

    console.log(
      `[BenchmarkRunner] Started run ${runId}: ${launchedGameIds.length} games across ${pairings.length} pairing(s)`,
    );

    return {
      runId,
      totalGames: launchedGameIds.length,
      pairings,
    };
  }

  /** Query the persisted status of a benchmark run. */
  getStatus(runId: string): BenchmarkRunStatus | null {
    const row = this.db
      .prepare('SELECT * FROM benchmark_runs WHERE id = ?')
      .get(runId) as BenchmarkRunRow | undefined;
    if (!row) return null;

    const totalGames = (
      this.db
        .prepare('SELECT COUNT(*) as count FROM benchmark_games WHERE run_id = ?')
        .get(runId) as { count: number }
    ).count;

    let summary: Record<string, unknown> | null = null;
    if (row.summary) {
      try {
        summary = JSON.parse(row.summary);
      } catch {
        summary = null;
      }
    }

    return {
      runId: row.id,
      status: row.status as BenchmarkRunStatusValue,
      config: JSON.parse(row.config) as BenchmarkConfig,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      summary,
      error: row.error,
      totalGames,
    };
  }

  /** Progress summary: how many games completed, failed, still pending. */
  getProgress(runId: string): BenchmarkProgress | null {
    const status = this.getStatus(runId);
    if (!status) return null;

    const games = this.db
      .prepare('SELECT * FROM benchmark_games WHERE run_id = ?')
      .all(runId) as BenchmarkGameRow[];

    const completedGames = games.filter((g) => g.completed_at !== null).length;
    const failedGames = games.filter((g) => g.error !== null).length;
    const validGames = games.filter((g) => g.valid === 1).length;

    // Group by pairing for per-pairing progress.
    const pairingMap = new Map<
      string,
      { id: string; modelA: string; modelB: string; games: number; completed: number }
    >();
    for (const g of games) {
      let entry = pairingMap.get(g.pairing_id);
      if (!entry) {
        entry = {
          id: g.pairing_id,
          modelA: g.model_a,
          modelB: g.model_b,
          games: 0,
          completed: 0,
        };
        pairingMap.set(g.pairing_id, entry);
      }
      entry.games++;
      if (g.completed_at !== null) entry.completed++;
    }

    return {
      runId,
      status: status.status,
      totalGames: games.length,
      completedGames,
      validGames,
      failedGames,
      pairings: Array.from(pairingMap.values()),
    };
  }

  /** Mark a run as CANCELLED. Running games are left to wind down naturally. */
  cancel(runId: string): boolean {
    const existing = this.getStatus(runId);
    if (!existing) return false;
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      return false;
    }
    this.updateRunStatus(runId, 'CANCELLED', Date.now());
    console.log(`[BenchmarkRunner] Cancelled run ${runId}`);
    return true;
  }

  /** List all benchmark runs, most recent first. */
  listRuns(): BenchmarkRunStatus[] {
    const rows = this.db
      .prepare('SELECT * FROM benchmark_runs ORDER BY created_at DESC LIMIT 50')
      .all() as BenchmarkRunRow[];
    return rows.map((row) => ({
      runId: row.id,
      status: row.status as BenchmarkRunStatusValue,
      config: JSON.parse(row.config) as BenchmarkConfig,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      summary: row.summary ? (() => { try { return JSON.parse(row.summary); } catch { return null; } })() : null,
      error: row.error,
      totalGames: (
        this.db
          .prepare('SELECT COUNT(*) as count FROM benchmark_games WHERE run_id = ?')
          .get(row.id) as { count: number }
      ).count,
    }));
  }

  // ==================== Internal helpers ====================

  private validateConfig(config: BenchmarkConfig): Required<BenchmarkConfig> {
    const models = config.models;
    if (!Array.isArray(models) || models.length < 2) {
      throw new Error('Benchmark config must include at least 2 models');
    }
    const seen = new Set<string>();
    for (const m of models) {
      if (typeof m !== 'string' || m.trim().length === 0) {
        throw new Error(`Invalid model entry: ${String(m)}`);
      }
      const key = m.trim();
      if (seen.has(key)) {
        throw new Error(`Duplicate model in config: ${key}`);
      }
      seen.add(key);
    }

    const gamesPerPairing =
      typeof config.gamesPerPairing === 'number' && config.gamesPerPairing > 0
        ? Math.floor(config.gamesPerPairing)
        : 2;
    const numPlayers =
      typeof config.numPlayers === 'number' && config.numPlayers >= 5
        ? Math.floor(config.numPlayers)
        : 10;
    const temperature =
      typeof config.temperature === 'number' ? config.temperature : 0.7;

    return { models: Array.from(seen), gamesPerPairing, numPlayers, temperature };
  }

  /**
   * Build the pairing schedule: every unique unordered pair (modelA, modelB),
   * each played `gamesPerPairing` times.
   */
  private buildSchedule(
    config: Required<BenchmarkConfig>,
  ): PairingSchedule[] {
    const schedule: PairingSchedule[] = [];
    const models = config.models;
    for (let i = 0; i < models.length; i++) {
      for (let j = i + 1; j < models.length; j++) {
        const pairingId = `${models[i]}__vs__${models[j]}`;
        schedule.push({
          pairingId,
          modelA: models[i],
          modelB: models[j],
          count: config.gamesPerPairing,
        });
      }
    }
    return schedule;
  }

  /**
   * Create one game for a pairing, join players (split between the two models),
   * start the game, and persist the benchmark_games row.
   * Returns the game ID, or null if the game could not be created.
   */
  private launchGame(
    runId: string,
    pairing: PairingSchedule,
    seed: number,
    config: Required<BenchmarkConfig>,
  ): string | null {
    const [providerA, modelA] = this.parseModel(pairing.modelA);
    const [providerB, modelB] = this.parseModel(pairing.modelB);

    // Register agents for each model in the pairing.
    const agentIdA = `bench-${runId}-${pairing.pairingId}-A-${seed}`;
    const agentIdB = `bench-${runId}-${pairing.pairingId}-B-${seed}`;
    this.agentCoordinator.registerAgent({
      id: agentIdA,
      name: `${pairing.modelA}-agent`,
      provider: providerA,
      model: modelA,
      temperature: config.temperature,
    });
    this.agentCoordinator.registerAgent({
      id: agentIdB,
      name: `${pairing.modelB}-agent`,
      provider: providerB,
      model: modelB,
      temperature: config.temperature,
    });

    // Create the game.
    const game = this.gameEngine.createGame({
      config: { numPlayers: config.numPlayers },
    });

    // Join players: split the slots between model A and model B.
    // Even indices -> model A, odd indices -> model B.
    const numPlayers = config.numPlayers;
    const playerEntries: Array<{ name: string; provider: string; model: string; agentId: string }> = [];
    for (let p = 0; p < numPlayers; p++) {
      const useA = p % 2 === 0;
      const provider = useA ? providerA : providerB;
      const model = useA ? modelA : modelB;
      const agentId = useA ? agentIdA : agentIdB;
      playerEntries.push({
        name: `Player${p + 1}`,
        provider,
        model,
        agentId,
      });
    }

    for (const entry of playerEntries) {
      const result = this.gameEngine.joinGame(game.id, entry.name, {
        provider: entry.provider,
        model: entry.model,
      });
      if (!result.success) {
        console.warn(
          `[BenchmarkRunner] Failed to join player ${entry.name} to game ${game.id}: ${result.error}`,
        );
      }
    }

    // Assign agents to the joined players (by name lookup).
    const joinedGame = this.gameRepository.getGame(game.id);
    if (joinedGame) {
      for (const player of joinedGame.players) {
        const entry = playerEntries.find((e) => e.name === player.name);
        if (entry) {
          this.agentCoordinator.assignAgent(player.id, entry.agentId);
        }
      }
    }

    // Start the game (assigns roles + flips to IN_PROGRESS).
    const startResult = this.gameEngine.startGame(game.id);
    if (!startResult.success) {
      console.warn(
        `[BenchmarkRunner] Failed to start game ${game.id}: ${startResult.error}`,
      );
    }

    // Determine the roles assigned to model A / model B players (for tracking).
    let modelARole = 'VILLAGER';
    let modelBRole = 'VILLAGER';
    const finalGame = this.gameRepository.getGame(game.id);
    if (finalGame) {
      for (const player of finalGame.players) {
        const entry = playerEntries.find((e) => e.name === player.name);
        if (!entry) continue;
        if (entry.agentId === agentIdA && player.role) {
          modelARole = player.role;
        }
        if (entry.agentId === agentIdB && player.role) {
          modelBRole = player.role;
        }
      }
    }

    // Persist the benchmark_games row.
    this.db
      .prepare(
        `INSERT INTO benchmark_games
          (game_id, run_id, pairing_id, model_a, model_b, seed, model_a_role, model_b_role, valid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        game.id,
        runId,
        pairing.pairingId,
        pairing.modelA,
        pairing.modelB,
        seed,
        modelARole,
        modelBRole,
      );

    // Subscribe to the game's WINNER_DETERMINED event to record the result.
    const unsubscribe = this.eventBus.subscribe('WINNER_DETERMINED', (event) => {
      if (event.gameId !== game.id) return;
      const winner = (event.data as { winner?: string })?.winner ?? null;
      const completedAt = Date.now();
      this.db
        .prepare(
          `UPDATE benchmark_games
             SET winner = ?, team_winner = ?, completed_at = ?
           WHERE game_id = ?`,
        )
        .run(winner ?? null, winner ?? null, completedAt, game.id);
      unsubscribe();
      this.maybeCompleteRun(runId);
    });

    return game.id;
  }

  /** Parse a "provider:model" string into [LLMProvider, model]. */
  private parseModel(spec: string): [LLMProvider, string] {
    const idx = spec.indexOf(':');
    if (idx === -1) {
      return ['CUSTOM', spec];
    }
    const provider = spec.slice(0, idx).toUpperCase();
    const model = spec.slice(idx + 1);
    return [provider as LLMProvider, model];
  }

  private persistRun(
    runId: string,
    config: Required<BenchmarkConfig>,
    status: BenchmarkRunStatusValue,
    now: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO benchmark_runs (id, config, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(runId, JSON.stringify(config), status, now, now);
  }

  private updateRunStatus(
    runId: string,
    status: BenchmarkRunStatusValue,
    now: number,
  ): void {
    this.db
      .prepare('UPDATE benchmark_runs SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, runId);
  }

  private failRun(runId: string, error: string, now: number): void {
    this.db
      .prepare(
        'UPDATE benchmark_runs SET status = ?, error = ?, completed_at = ?, updated_at = ? WHERE id = ?',
      )
      .run('FAILED', error, now, now, runId);
  }

  /** Check if all games in the run have completed, and if so, mark COMPLETED. */
  private maybeCompleteRun(runId: string): void {
    const games = this.db
      .prepare('SELECT * FROM benchmark_games WHERE run_id = ?')
      .all(runId) as BenchmarkGameRow[];

    const allDone = games.length > 0 && games.every((g) => g.completed_at !== null);
    if (!allDone) return;

    const now = Date.now();
    this.db
      .prepare(
        'UPDATE benchmark_runs SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?',
      )
      .run('COMPLETED', now, now, runId);

    console.log(`[BenchmarkRunner] Run ${runId} completed`);
  }
}
