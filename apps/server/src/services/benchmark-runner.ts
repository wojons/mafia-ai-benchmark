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
import { GameRepository as GameRepositoryClass } from '../db/repository.js';
import type { LegacyGameAdapter } from './legacy-game-adapter.js';

/**
 * Configuration accepted by POST /api/v1/benchmark.
 */
export interface BenchmarkConfig {
  models: string[];
  gamesPerPairing?: number;
  numPlayers?: number;
  temperature?: number;
}

// ==================== Module-level SQL helpers (DF-MAFIA-AI-BENCHMARK-28) ====================
//
// Local copies of the canonical model/provider normalization from
// stats-collector/models.ts (module-private there). Same shape and
// semantics (MAF-GAP-036/045): a model string that itself carries a
// provider prefix collapses to the canonical key so prefixed spellings
// merge into ONE row. Keep in sync with models.ts — a drift here would
// split a model into two rows in run reports only.

/**
 * SQL expression selecting the canonical MODEL string for a table alias:
 * the provider prefix inside the model column is stripped before
 * aggregation ('openai' + 'openai/gpt-4o-mini' -> model 'gpt-4o-mini').
 */
function normalizedModelSql(alias: string): string {
  return `CASE WHEN instr(${alias}.model, '/') > 0
    THEN substr(${alias}.model, instr(${alias}.model, '/') + 1)
    ELSE ${alias}.model END`;
}

/**
 * SQL expression selecting the canonical PROVIDER for a table alias: the
 * model string's own prefix IS the provider when present (regardless of
 * the stored provider — legacy 'CUSTOM' rows); otherwise the stored
 * provider wins. Models without a slash keep the stored provider.
 */
function normalizedProviderSql(alias: string): string {
  return `CASE
    WHEN instr(${alias}.model, '/') > 0
      AND lower(substr(${alias}.model, 1, instr(${alias}.model, '/') - 1)) = lower(${alias}.provider)
    THEN ${alias}.provider
    WHEN instr(${alias}.model, '/') > 0
    THEN substr(${alias}.model, 1, instr(${alias}.model, '/') - 1)
    ELSE ${alias}.provider END`;
}

/**
 * Parse a benchmark model spec ('provider/model' | 'provider:model') into
 * [provider, model] in TypeScript (mirror of BenchmarkRunner.parseModel,
 * module-level so the pairing-report helpers can use it without an
 * instance). Bare model names get the CUSTOM passthrough.
 */
function parseModelSpec(spec: string): [string, string] {
  const colonIdx = spec.indexOf(':');
  const slashIdx = spec.indexOf('/');
  if (slashIdx !== -1 && (colonIdx === -1 || slashIdx < colonIdx)) {
    return [spec.slice(0, slashIdx), spec.slice(slashIdx + 1)];
  }
  if (colonIdx !== -1) {
    return [spec.slice(0, colonIdx), spec.slice(colonIdx + 1)];
  }
  return ['CUSTOM', spec];
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

/**
 * Run-scoped report row (DF-MAFIA-AI-BENCHMARK-28): one per model that played
 * in this run. gamesPlayed counts DISTINCT games the model appeared in; wins
 * count games where the model's side won. A game with no decided winner
 * (winner NULL) contributes to neither side's wins — it is played but
 * unattributable, exactly like the global report treats it.
 */
export interface BenchmarkRunModelRow {
  provider: string;
  model: string;
  gamesPlayed: number;
  wins: number;
  losses: number | null;
  winRate: number;
  avgTokens: number;
  avgCost: number;
}

/** Run-scoped pairing result (winner = which MODEL side won that game). */
export interface BenchmarkRunPairingResult {
  id: string;
  modelA: string;
  modelB: string;
  games: number;
  completed: number;
  aWins: number;
  bWins: number;
  unattributed: number;
}

/**
 * Run-scoped report (DF-MAFIA-AI-BENCHMARK-28): what THIS run showed, derived
 * only from the run's own benchmark_games + players rows — never the
 * polluted global accumulated report (DF-25). Shape mirrors the parts of
 * the global report the CLI renders (summary + modelPerformance + pairing
 * results), so the CLI's display path is shared.
 */
export interface BenchmarkRunReport {
  runId: string;
  status: BenchmarkRunStatusValue;
  generatedAt: string;
  summary: {
    totalGames: number;
    completedGames: number;
    validGames: number;
    failedGames: number;
    /** Games with a decided winner (attributable to a side). */
    gamesWithWinner: number;
  };
  modelPerformance: BenchmarkRunModelRow[];
  pairings: BenchmarkRunPairingResult[];
}

/** Aggregate result of one pass of {@link BenchmarkRunner.reconcileStrandedRuns}. */
export interface ReconcileSummary {
  /** Persisted QUEUED/RUNNING runs inspected. */
  inspected: number;
  /** Stranded runs flipped to a terminal status this pass. */
  reconciled: number;
  /** Stranded runs that could NOT be proven terminal (left untouched). */
  leftActive: number;
  /** Stale non-terminal runs flipped to FAILED this pass (see STALE_RUN_MAX_MS). */
  staleFailed: number;
}

/**
 * Maximum age (ms) a QUEUED/RUNNING benchmark run may sit without terminal
 * game evidence before the startup reconciliation sweeps it to FAILED
 * (DF-MAFIA-AI-BENCHMARK-15).
 *
 * WHY THIS EXISTS: the durable-evidence reconcile only retires runs whose
 * benchmark_games rows all carry completed_at/error. A run abandoned
 * mid-flight (its unfinished game rows can never gain terminal evidence —
 * the writing subscription died with the old process) would stay RUNNING
 * forever, one per restart. No game can legitimately stay in flight for
 * this long, so a non-terminal run older than the max age is by definition
 * not live and is marked FAILED with a reason recorded. Runs younger than
 * the max age keep the existing leave-active behavior.
 *
 * Plain constant on purpose: this file has no config/env plumbing, and the
 * value is a policy backstop, not an operator tuning knob.
 */
export const STALE_RUN_MAX_MS = 7 * 24 * 60 * 60 * 1000;

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
  private legacyAdapter: LegacyGameAdapter | null;
  private db: Database.Database;

  constructor(deps: {
    gameEngine: GameEngine;
    agentCoordinator: AgentCoordinator;
    eventBus: EventBus;
    statsCollector: StatsCollector;
    gameRepository: GameRepository;
    legacyAdapter?: LegacyGameAdapter | null;
  }) {
    this.gameEngine = deps.gameEngine;
    this.agentCoordinator = deps.agentCoordinator;
    this.eventBus = deps.eventBus;
    this.statsCollector = deps.statsCollector;
    this.gameRepository = deps.gameRepository;
    this.legacyAdapter = deps.legacyAdapter ?? null;
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

  /**
   * Run-scoped report (DF-MAFIA-AI-BENCHMARK-28): the verdict for THIS run
   * only. The global accumulated report (GET /api/v1/benchmark/report)
   * mixes every run ever recorded (and its legacy rows are polluted —
   * DF-25), so a fresh 2-game run's 'Winner' banner used to quote 88
   * lifetime games. This method derives everything from the run's OWN
   * benchmark_games rows joined to their players rows, applying the same
   * winner semantics as the global aggregates:
   *
   *   - wins = games where the model's SIDE won (a model plays ~10 player
   *     slots per game; one win per game per model — never a per-player
   *     count), from players.won written by setPlayersWon at game end
   *     (MAF-GAP-043). The games-level winner column (benchmark_games
   *     .winner, written by the terminal-event subscription) is the
   *     cross-check; games that disagree with their players rows or carry
   *     no decided winner contribute games but no wins.
   *   - loss columns count DEFEATS only when the model has at least one
   *     win somewhere in the run (the same honest n/a floor as the CLI's
   *     display — a 0-win legacy row's games are unattributable, not
   *     defeats).
   *   - degenerate (DF-18) and mock (DF-12) games are excluded exactly via
   *     the same shared SQL predicates the global aggregates use.
   *
   * Returns null when the runId is unknown.
   */
  getRunReport(runId: string): BenchmarkRunReport | null {
    const status = this.getStatus(runId);
    if (!status) return null;

    const games = this.db
      .prepare('SELECT * FROM benchmark_games WHERE run_id = ?')
      .all(runId) as BenchmarkGameRow[];

    const completedGames = games.filter((g) => g.completed_at !== null).length;
    const failedGames = games.filter((g) => g.error !== null).length;
    const validGames = games.filter((g) => g.valid === 1).length;
    const gamesWithWinner = games.filter(
      (g) => g.winner === 'MAFIA' || g.winner === 'TOWN',
    ).length;

    // Per-game winner from the players rows (players.won), matching what
    // the global per-model aggregates attribute. A game whose players rows
    // are missing or whose per-player won columns are not written yields
    // NO attribution — honest absence, never a fabricated win.
    const gameWinnerFromPlayers = new Map<string, 'MAFIA' | 'TOWN' | null>();
    if (games.length > 0) {
      const placeholders = games.map(() => '?').join(', ');
      const playerRows = this.db
        .prepare(
          `SELECT game_id, is_mafia, won FROM players
             WHERE game_id IN (${placeholders})
               AND won IS NOT NULL
               AND is_mafia IS NOT NULL`,
        )
        .all(...games.map((g) => g.game_id)) as Array<{
        game_id: string;
        is_mafia: number;
        won: number;
      }>;
      const perGame = new Map<string, { mafiaWon: boolean; townWon: boolean; rows: number }>();
      for (const p of playerRows) {
        let entry = perGame.get(p.game_id);
        if (!entry) {
          entry = { mafiaWon: false, townWon: false, rows: 0 };
          perGame.set(p.game_id, entry);
        }
        entry.rows++;
        if (p.won === 1) {
          if (p.is_mafia === 1) entry.mafiaWon = true;
          else entry.townWon = true;
        }
      }
      for (const g of games) {
        const e = perGame.get(g.game_id);
        // Exactly one side wins a real game: both flags set (or none) means
        // the players rows cannot attribute the game (corrupt/degenerate).
        if (e && e.mafiaWon !== e.townWon) {
          gameWinnerFromPlayers.set(g.game_id, e.mafiaWon ? 'MAFIA' : 'TOWN');
        } else {
          gameWinnerFromPlayers.set(g.game_id, null);
        }
      }
    }

    // Which model won each game: the model WHOSE SIDE won. Uses the
    // benchmark_games side winner joined to the game's role assignments;
    // falls back to the players-row winner when the side column is NULL.
    // The result maps game_id -> the model key that won (or null).
    const gameWinnerModelKey = new Map<string, string | null>();
    for (const g of games) {
      const teamWinner = g.winner === 'MAFIA' || g.winner === 'TOWN' ? g.winner : gameWinnerFromPlayers.get(g.game_id) ?? null;
      if (!teamWinner) {
        gameWinnerModelKey.set(g.game_id, null);
        continue;
      }
      // Both pairing models are recorded on the row; the winner is the
      // model whose players' side won. Determine it from the players rows
      // of that model (is_mafia vs teamWinner); the pairing model that had
      // NO mafia players wins when TOWN wins, and vice versa — read from
      // real player attribution, never from the fixed role split.
      const sideOf = this.modelSidesForGame(g.game_id);
      const winnerSideIsMafia = teamWinner === 'MAFIA';
      let winnerKey: string | null = null;
      for (const [key, isMafiaSide] of sideOf) {
        if (isMafiaSide === winnerSideIsMafia) {
          // Lowercase key — the model aggregation maps group case-insensitively.
          winnerKey = key.toLowerCase();
          break;
        }
      }
      gameWinnerModelKey.set(g.game_id, winnerKey);
    }

    // ===== Per-model rows =====
    interface ModelAgg {
      provider: string;
      model: string;
      gameIds: Set<string>;
      wins: number;
      /** Sum of per-player token counts + row count (mean over rows). */
      tokensSum: number;
      tokensN: number;
      cost: number;
    }
    const modelAggs = new Map<string, ModelAgg>();
    /** Game ids whose side outcome IS attributable (usable + winner model found). */
    const attributedGameIds = new Set<string>();

    for (const g of games) {
      const isUsable = this.isUsableRunGame(g);
      // Per-model participation from the players rows (the real wire data:
      // the actual model strings each player served), normalized to the
      // canonical provider/model key so prefixed spellings merge.
      const placeholders = [g.game_id];
      const rows = this.db
        .prepare(
          `SELECT p.game_id as game_id,
                  ${normalizedProviderSql('p')} as provider,
                  ${normalizedModelSql('p')} as model,
                  SUM(p.tokens_used) as tokens_sum,
                  COUNT(*) as n
             FROM players p
            WHERE p.game_id = ?
              AND p.provider IS NOT NULL AND p.model IS NOT NULL
            GROUP BY p.game_id, ${normalizedProviderSql('p')}, ${normalizedModelSql('p')}`,
        )
        .all(...placeholders) as Array<{
        game_id: string;
        provider: string;
        model: string;
        tokens_sum: number | null;
        n: number;
      }>;
      const winnerKey = gameWinnerModelKey.get(g.game_id) ?? null;
      // Per-(game, model) rows from the players table — case-insensitive
      // canonical grouping plus p.game_id in the GROUP BY so each game's
      // per-model contribution is one row (the earlier bare-group shape
      // collapsed ALL of a model's games into one row and mis-folded the
      // wins). Per-player token sums are accumulated so the final
      // avgTokens is the mean over the model's own player rows — a model
      // serving several slots in a game is weighted by its slots, exactly
      // like the real token spend it produced.
      const gameKeys = new Set<string>();
      for (const p of rows) {
        if (!p.provider || !p.model) continue;
        const key = `${p.provider}/${p.model}`.toLowerCase();
        let agg = modelAggs.get(key);
        if (!agg) {
          agg = { provider: p.provider, model: p.model, gameIds: new Set<string>(), wins: 0, tokensSum: 0, tokensN: 0, cost: 0 };
          modelAggs.set(key, agg);
        }
        agg.gameIds.add(p.game_id);
        agg.tokensSum += p.tokens_sum ?? 0;
        agg.tokensN += p.n;
        gameKeys.add(key);
      }
      // Wins: ONE per game, credited to the game's winning model — never
      // per player row (a model serving several slots must not multiply
      // the win), and only for a usable game it actually played in.
      if (isUsable && winnerKey && gameKeys.has(winnerKey)) {
        const winnerAgg = modelAggs.get(winnerKey);
        if (winnerAgg) {
          winnerAgg.wins += 1;
          attributedGameIds.add(g.game_id);
        }
      }
      // Cost lives in token_usage per player; SUM the game's rows per model key.
      const costRows = this.db
        .prepare(
          `SELECT ${normalizedProviderSql('tu')} as provider,
                  ${normalizedModelSql('tu')} as model,
                  COALESCE(SUM(tu.cost), 0) as cost
             FROM token_usage tu
            WHERE tu.game_id = ?
            GROUP BY ${normalizedProviderSql('tu')}, ${normalizedModelSql('tu')}`,
        )
        .all(...placeholders) as Array<{ provider: string; model: string; cost: number }>;
      for (const c of costRows) {
        if (!c.provider || !c.model) continue;
        const key = `${c.provider}/${c.model}`.toLowerCase();
        let agg = modelAggs.get(key);
        if (!agg) {
          // A model with recorded cost but no players rows still played —
          // count the game it appears in (honest participation from usage).
          agg = { provider: c.provider, model: c.model, gameIds: new Set<string>(), wins: 0, tokensSum: 0, tokensN: 0, cost: 0 };
          modelAggs.set(key, agg);
        }
        agg.cost += c.cost;
      }
    }

    // Losses are countable whenever the run HAS at least one decided,
    // attributed game — a 0-win model in such a run really lost its games
    // (its games were played and another model's side won). Only a fully
    // unattributable run keeps null, matching the CLI's n/a floor.
    const hasAnyAttributedGame = attributedGameIds.size > 0;
    const modelPerformance: BenchmarkRunModelRow[] = Array.from(modelAggs.values())
      .map((a) => {
        const gamesPlayed = a.gameIds.size;
        const winRate = gamesPlayed > 0 ? a.wins / gamesPlayed : 0;
        return {
          provider: a.provider,
          model: a.model,
          gamesPlayed,
          wins: a.wins,
          losses: hasAnyAttributedGame ? gamesPlayed - a.wins : null,
          winRate,
          avgTokens: a.tokensN > 0 ? a.tokensSum / a.tokensN : 0,
          avgCost: gamesPlayed > 0 ? a.cost / gamesPlayed : 0,
        };
      })
      .sort((x, y) => y.gamesPlayed - x.gamesPlayed);

    // ===== Per-pairing rows =====
    const pairingMap = new Map<string, BenchmarkRunPairingResult>();
    for (const g of games) {
      let entry = pairingMap.get(g.pairing_id);
      if (!entry) {
        entry = {
          id: g.pairing_id,
          modelA: g.model_a,
          modelB: g.model_b,
          games: 0,
          completed: 0,
          aWins: 0,
          bWins: 0,
          unattributed: 0,
        };
        pairingMap.set(g.pairing_id, entry);
      }
      entry.games++;
      if (g.completed_at !== null) entry.completed++;
      const winnerKey = gameWinnerModelKey.get(g.game_id);
      // The aWins/bWins discrimination keys on the model THAT WON the game
      // (from the players rows). The spec's head-to-head (modelAWins)
      // wants which side of the PAIRING won — a modelA win means the game
      // winner's model key matched model_a's participation key. The same
      // usable-game gate the per-model wins apply governs the pairing:
      // a mock/degenerate decided game is not real win evidence (DF-12/18).
      const usable = this.isUsableRunGame(g);
      if (usable && winnerKey) {
        const aKey = this.participationKeyForModel(g.game_id, g.model_a);
        const bKey = this.participationKeyForModel(g.game_id, g.model_b);
        if (aKey && winnerKey === aKey.toLowerCase()) entry.aWins++;
        else if (bKey && winnerKey === bKey.toLowerCase()) entry.bWins++;
        else entry.unattributed++;
      } else {
        entry.unattributed++;
      }
    }

    return {
      runId,
      status: status.status,
      generatedAt: new Date().toISOString(),
      summary: {
        totalGames: games.length,
        completedGames,
        validGames,
        failedGames,
        gamesWithWinner,
      },
      modelPerformance,
      pairings: Array.from(pairingMap.values()),
    };
  }

  /**
   * A game row usable for win attribution in a run report: non-failed and
   * passing the shared degenerate/mock exclusions (the same predicates the
   * global aggregates use — reading them via the games table's config).
   */
  private isUsableRunGame(g: BenchmarkGameRow): boolean {
    if (g.error !== null || g.winner === null) return false;
    const row = this.db
      .prepare(
        `SELECT COALESCE((${GameRepositoryClass.DEGENERATE_GAME_SQL}), 0) = 0
               AND COALESCE((${GameRepositoryClass.MOCK_GAME_SQL}), 0) = 0
            AS usable
           FROM games g WHERE g.id = ?`,
      )
      .get(g.game_id) as { usable: number } | undefined;
    return row ? row.usable === 1 : false;
  }

  /**
   * For one game: whether each model key's players are mafia-side
   * (map<modelKey, isMafiaSide | null>). Derived from the players rows —
   * never from the fixed role split.
   */
  private modelSidesForGame(gameId: string): Map<string, boolean> {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT ${normalizedProviderSql('p')} as provider,
                ${normalizedModelSql('p')} as model,
                MAX(p.is_mafia) as mafia_present
           FROM players p
          WHERE p.game_id = ?
            AND p.provider IS NOT NULL AND p.model IS NOT NULL
          GROUP BY ${normalizedProviderSql('p')}, ${normalizedModelSql('p')}`,
      )
      .all(gameId) as Array<{ provider: string; model: string; mafia_present: number }>;
    const map = new Map<string, boolean>();
    for (const r of rows) {
      if (!r.provider || !r.model) continue;
      map.set(`${r.provider}/${r.model}`, r.mafia_present === 1);
    }
    return map;
  }

  /**
   * The canonical model key ('provider/model') a benchmark pairing spec
   * (model_a / model_b, e.g. 'openai/gpt-4o-mini') maps to in a game's
   * players rows, or null when that model has no players rows in the game.
   */
  private participationKeyForModel(gameId: string, spec: string): string | null {
    const [provider, model] = parseModelSpec(spec);
    if (!provider || !model) return null;
    const key = `${provider}/${model}`.toLowerCase();
    for (const existing of this.modelSidesForGame(gameId).keys()) {
      // modelSidesForGame keys are 'provider/model' with the canonical
      // normalization already applied (slash stripped from the model).
      if (existing.toLowerCase() === key) return existing;
    }
    return null;
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

  /**
   * Reconcile persisted QUEUED/RUNNING runs whose games are provably
   * terminal, recovering runs stranded by a server restart. Additionally,
   * non-terminal runs older than {@link STALE_RUN_MAX_MS} are swept to
   * FAILED (stale-run policy, DF-MAFIA-AI-BENCHMARK-15) — see the second
   * pass below.
   *
   * WHY THIS EXISTS (QA-MAFIA-AI-BENCHMARK-2): a run's terminal status is
   * normally written by the in-process EventBus subscription installed in
   * launchGame() — the subscription dies with the process and cannot be
   * re-attached after a restart, so any run that was QUEUED/RUNNING at that
   * moment stays non-terminal forever. This method is the durable-evidence
   * fallback, safe to call at every server startup.
   *
   * OWNERSHIP POLICY — durable DB evidence only, never process state:
   * process state (event subscriptions, in-memory engines, timers) is gone
   * after a restart and proves nothing; the policy below therefore reads
   * only persisted rows.
   *
   * A non-terminal run (QUEUED/RUNNING) is reconciled ONLY when the durable
   * evidence proves it terminal:
   *   1. Every benchmark_games row has completed_at or error — the games all
   *      reached a terminal state, so the run is terminal too:
   *        - any game error  -> FAILED (error + completed_at persisted;
   *          see reconcileTerminalRun),
   *        - otherwise       -> COMPLETED (summary + completed_at persisted).
   *   2. Any other shape is NOT conclusive and the run is left untouched —
   *      games without completed_at/error may genuinely still be in flight
   *      (a live run keeps its RUNNING status, a not-yet-launched QUEUED run
   *      stays QUEUED) — UNTIL the run ages past STALE_RUN_MAX_MS. No real
   *      game stays in flight for anything close to 7 days, so a run this
   *      old with unfinished game rows is abandoned (the restart killed the
   *      only writer that could ever give those rows terminal evidence).
   *      The second pass below flips it to FAILED — deliberately not
   *      CANCELLED, which is the operator's action via
   *      POST /api/v1/benchmark/:runId/cancel — with the reason recorded in
   *      the run's error column. A stranded run with a missing terminal row
   *      is UNDETECTABLE here — the row's absence is indistinguishable from
   *      a live game (documented limitation: the runner never deletes game
   *      rows, so in practice the evidence is complete).
   *
   * IDEMPOTENT: the update targets only the stranded status values, so a
   * second pass finds nothing to do; completed_at/summary/error are
   * recomputed from the same durable rows on every pass.
   */
  reconcileStrandedRuns(): ReconcileSummary {
    const stranded = this.db.prepare(
      `SELECT id, created_at FROM benchmark_runs
        WHERE status IN ('QUEUED', 'RUNNING')
        ORDER BY created_at ASC`,
    );
    const rows = stranded.all() as Array<{ id: string; created_at: number }>;

    const summary: ReconcileSummary = {
      inspected: rows.length,
      reconciled: 0,
      leftActive: 0,
      staleFailed: 0,
    };

    const now = Date.now();

    for (const row of rows) {
      const games = this.db
        .prepare('SELECT * FROM benchmark_games WHERE run_id = ?')
        .all(row.id) as BenchmarkGameRow[];
      if (this.reconcileTerminalRun(row.id, games)) {
        summary.reconciled++;
      } else if (now - row.created_at >= STALE_RUN_MAX_MS) {
        // Stale-run sweep (DF-MAFIA-AI-BENCHMARK-15): no terminal proof AND
        // past the max age. Age is measured from the run's persisted
        // created_at, the only durable timestamp a stranded run carries.
        this.db
          .prepare(
            `UPDATE benchmark_runs
               SET status = 'FAILED', error = ?, completed_at = ?, updated_at = ?
             WHERE id = ? AND status IN ('QUEUED', 'RUNNING')`,
          )
          .run(
            `Run abandoned: still non-terminal with no completed game evidence after ` +
              `${Math.floor(STALE_RUN_MAX_MS / 86_400_000)} days (swept by startup reconciliation)`,
            now,
            now,
            row.id,
          );
        summary.staleFailed++;
        console.log(
          `[BenchmarkRunner] Run ${row.id} marked FAILED: no terminal game evidence after ` +
            `${Math.floor(STALE_RUN_MAX_MS / 86_400_000)} days (stale-run sweep)`,
        );
      } else {
        summary.leftActive++;
      }
    }

    if (summary.reconciled > 0 || summary.staleFailed > 0) {
      console.log(
        `[BenchmarkRunner] Reconciled ${summary.reconciled} stranded benchmark run(s) after restart ` +
          `(${summary.staleFailed} stale FAILED, ${summary.leftActive} left active, ` +
          `${summary.inspected} inspected)`,
      );
    }

    return summary;
  }

  /**
   * Reconcile one run to a terminal status if its games prove it terminal.
   * Returns true when the run was reconciled, false when it was left alone.
   * See reconcileStrandedRuns() for the ownership policy.
   */
  private reconcileTerminalRun(runId: string, games: BenchmarkGameRow[]): boolean {
    const terminal = (g: BenchmarkGameRow) => g.completed_at !== null || g.error !== null;
    const allTerminal = games.length > 0 && games.every(terminal);
    if (!allTerminal) return false;

    const now = Date.now();
    const failed = games.filter((g) => g.error !== null);
    const errored = failed.length > 0;

    // Summary persisted from the same game evidence getProgress() reports —
    // now via the shared builder (DF-MAFIA-AI-BENCHMARK-28), so a
    // restart-recovered run is self-describing exactly like a live-completed
    // one (plain counts + per-pairing/per-model verdict enrichment).
    const summaryPayload = this.buildRunSummary(runId);

    if (errored) {
      // FAILED: surface the durable error evidence; when several games
      // failed, join their messages so the run row explains itself. The
      // summary is persisted from the same game evidence as COMPLETED so a
      // recovered FAILED run is as self-describing as a recovered
      // COMPLETED one.
      const messages = failed
        .map((g) => `game ${g.game_id}: ${g.error}`)
        .join('; ');
      this.db
        .prepare(
          `UPDATE benchmark_runs
             SET status = ?, error = ?, completed_at = ?, summary = ?, updated_at = ?
           WHERE id = ? AND status IN ('QUEUED', 'RUNNING')`,
        )
        .run('FAILED', messages, now, summaryPayload, now, runId);
    } else {
      // COMPLETED: persist the summary from the same game evidence
      // getProgress() reports.
      this.db
        .prepare(
          `UPDATE benchmark_runs
             SET status = ?, completed_at = ?, summary = ?, updated_at = ?
           WHERE id = ? AND status IN ('QUEUED', 'RUNNING')`,
        )
        .run('COMPLETED', now, summaryPayload, now, runId);
    }

    const parsed = (() => {
      try {
        return JSON.parse(summaryPayload) as { completedGames: number; failedGames: number };
      } catch {
        return null;
      }
    })();
    console.log(
      `[BenchmarkRunner] Run ${runId} recovered as ${errored ? 'FAILED' : 'COMPLETED'} ` +
        `(${parsed ? parsed.completedGames : '?'} completed, ${parsed ? parsed.failedGames : '?'} failed game(s))`,
    );
    return true;
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
   *
   * When a LegacyGameAdapter is available the game is started through the
   * legacy engine (the path that actually plays: it spawns legacy-bridge.js
   * -> game-engine.js as a child process, runs the full night/day loop with
   * real LLM calls, and publishes terminal events on the EventBus). The
   * GameEngine path is kept as a degraded fallback for environments without
   * the adapter — it assigns roles and flips IN_PROGRESS but never runs a
   * game loop, so those games cannot complete (pre-existing limitation).
   */
  private launchGame(
    runId: string,
    pairing: PairingSchedule,
    seed: number,
    config: Required<BenchmarkConfig>,
  ): string | null {
    const [providerA, modelA] = this.parseModel(pairing.modelA);
    const [providerB, modelB] = this.parseModel(pairing.modelB);

    // Register agents for each model in the pairing. On the legacy path the
    // engine resolves models per-role from env vars (roleModels), so these
    // registrations are inert there; they remain for the GameEngine path.
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

    let gameId: string | null = null;

    if (this.legacyAdapter) {
      gameId = this.launchLegacyGame(runId, pairing, seed, config, providerA, modelA, providerB, modelB);
    } else {
      gameId = this.launchEngineGame(runId, pairing, seed, config, providerA, modelA, providerB, modelB, agentIdA, agentIdB);
    }

    if (!gameId) return null;

    // Subscribe to the game's terminal events to record the result. The
    // GameEngine path publishes WINNER_DETERMINED; the legacy engine never
    // emits that type — its terminal STATE_CHANGE (phase GAME_OVER, winner in
    // content) is remapped to GAME_ENDED by LegacyGameAdapter (MAF-GAP-005) —
    // so both types are subscribed. The handler is idempotent per game: the
    // first terminal event wins and the subscription is removed.
    const unsubscribe = this.eventBus.subscribe(
      ['WINNER_DETERMINED', 'GAME_ENDED'],
      (event) => {
        if (event.gameId !== gameId) return;
        const winner = (event.data as { winner?: string })?.winner ?? null;
        const completedAt = Date.now();
        this.db
          .prepare(
            `UPDATE benchmark_games
               SET winner = ?, team_winner = ?, completed_at = ?
             WHERE game_id = ?`,
          )
          .run(winner ?? null, winner ?? null, completedAt, gameId);
        unsubscribe();
        this.maybeCompleteRun(runId);
      },
    );

    return gameId;
  }

  /**
   * Legacy-engine launch path (the path that actually plays). The two pairing
   * models are mapped onto the legacy per-role model config: model A drives
   * the MAFIA + SHERIFF roles and model B drives TOWN + DOCTOR (deterministic
   * split; the legacy engine resolves role models from env vars set by
   * LegacyGameAdapter.startGame). Benchmark model specs use "provider:model"
   * while the legacy engine expects "provider/model" role-model strings, so
   * the spec is converted. Roles are not exposed on the legacy path
   * (LegacyGameState carries no assignments), so model_a_role/model_b_role
   * fall back to the VILLAGER default.
   */
  private launchLegacyGame(
    runId: string,
    pairing: PairingSchedule,
    seed: number,
    config: Required<BenchmarkConfig>,
    _providerA: LLMProvider,
    _modelA: string,
    _providerB: LLMProvider,
    _modelB: string,
  ): string | null {
    const modelSpecA = this.toLegacyModelSpec(pairing.modelA);
    const modelSpecB = this.toLegacyModelSpec(pairing.modelB);

    const gameState = this.legacyAdapter!.startGame({
      numPlayers: config.numPlayers,
      gameConfig: { numPlayers: config.numPlayers, engineType: 'legacy' },
      // Deterministic role split: model A plays the informed/aggressive
      // roles (MAFIA, SHERIFF), model B plays the town core (TOWN, DOCTOR).
      roleModels: {
        MAFIA: modelSpecA,
        SHERIFF: modelSpecA,
        TOWN: modelSpecB,
        DOCTOR: modelSpecB,
      },
    });

    const gameId = gameState.gameId;

    // Persist the benchmark_games row. Roles are not observable on the
    // legacy path (LegacyGameState carries no assignments), so both fall
    // back to the VILLAGER default.
    this.db
      .prepare(
        `INSERT INTO benchmark_games
          (game_id, run_id, pairing_id, model_a, model_b, seed, model_a_role, model_b_role, valid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        gameId,
        runId,
        pairing.pairingId,
        pairing.modelA,
        pairing.modelB,
        seed,
        'VILLAGER',
        'VILLAGER',
      );

    console.log(
      `[BenchmarkRunner] Run ${runId}: launched legacy game ${gameId} ` +
        `(modelA=${pairing.modelA} -> MAFIA/SHERIFF, modelB=${pairing.modelB} -> TOWN/DOCTOR)`,
    );

    // QA-MAFIA-AI-BENCHMARK-13: a bridge child that dies BEFORE any terminal
    // event (the shipped failure was `Cannot find module .../legacy-bridge.js`
    // — the child died at require(), never emitted 'done') left the
    // benchmark_games row without completed_at/error forever, and the run
    // stayed RUNNING with no in-process writer left to finish it. Watch the
    // child directly: a nonzero exit with no terminal evidence on the row
    // marks the game errored, which lets maybeCompleteRun retire the run.
    // A clean exit (0) or signal kill (null) is left to the normal
    // GAME_ENDED / cancel paths.
    const child = gameState.process;
    if (child && typeof child.on === 'function') {
      child.on('close', (code: number | null) => {
        if (code === 0 || code === null) return;
        try {
          const row = this.db
            .prepare('SELECT completed_at, error FROM benchmark_games WHERE game_id = ?')
            .get(gameId) as { completed_at: number | null; error: string | null } | undefined;
          if (!row || row.completed_at !== null || row.error !== null) return;
          const message =
            `legacy bridge process exited with code ${code} without publishing ` +
            `a terminal game event (no 'done' — bridge likely failed to start)`;
          this.db
            .prepare('UPDATE benchmark_games SET error = ? WHERE game_id = ?')
            .run(message, gameId);
          console.error(
            `[BenchmarkRunner] Run ${runId}: game ${gameId} failed — ${message}`,
          );
          this.maybeCompleteRun(runId);
        } catch (e) {
          console.error(
            `[BenchmarkRunner] Failed to record bridge failure for game ${gameId}: ` +
              (e instanceof Error ? e.message : String(e)),
          );
        }
      });
    }

    return gameId;
  }

  /**
   * GameEngine fallback launch path (degraded: games cannot complete because
   * GameEngine.startGame has no game loop). Kept exactly as before for
   * environments without the legacy adapter.
   */
  private launchEngineGame(
    runId: string,
    pairing: PairingSchedule,
    seed: number,
    config: Required<BenchmarkConfig>,
    providerA: LLMProvider,
    modelA: string,
    providerB: LLMProvider,
    modelB: string,
    agentIdA: string,
    agentIdB: string,
  ): string | null {
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

    return game.id;
  }

  /**
   * Parse a model spec into [LLMProvider, model].
   *
   * Two spellings are accepted:
   *   - "provider:model"  (legacy internal form, e.g. "openrouter:model-a")
   *   - "provider/model"  (the documented benchmark form — the CLI's
   *     --models help text and DEFAULT_MODELS use it, e.g.
   *     "openai/gpt-4o-mini")
   *
   * MAF-GAP-057: only the colon form was understood. A slash spec like
   * 'openai/gpt-4o' fell through to ['CUSTOM', 'openai/gpt-4o'] and was
   * then re-joined as 'CUSTOM/openai/gpt-4o' by launchLegacyGame; every
   * downstream `.split('/')` destructure truncated that to
   * provider='CUSTOM', model='openai' — usage/assignments recorded under
   * a phantom bare 'openai' model and an invalid wire id ('CUSTOM/openai')
   * sent to OpenRouter. The slash form is now parsed at the source so
   * roleModels carry exactly 'provider/model'.
   */
  private parseModel(spec: string): [LLMProvider, string] {
    const colonIdx = spec.indexOf(':');
    const slashIdx = spec.indexOf('/');
    // Whichever separator comes first wins; a path segment after a slash
    // may itself contain colons and vice versa.
    if (slashIdx !== -1 && (colonIdx === -1 || slashIdx < colonIdx)) {
      return [spec.slice(0, slashIdx).toUpperCase() as LLMProvider, spec.slice(slashIdx + 1)];
    }
    if (colonIdx !== -1) {
      const provider = spec.slice(0, colonIdx).toUpperCase();
      const model = spec.slice(colonIdx + 1);
      return [provider as LLMProvider, model];
    }
    // Bare model name with no provider: CUSTOM passthrough (pre-existing).
    return ['CUSTOM', spec];
  }

  /**
   * Convert a benchmark model spec into the legacy engine's "provider/model"
   * role-model string.
   *
   * MAF-GAP-057: this used to be `${providerA}/${modelA}` from parseModel's
   * parts. For slash specs ('openai/gpt-4o') parseModel fell through to
   * CUSTOM + full string and the rebuild produced 'CUSTOM/openai/gpt-4o' —
   * every downstream `.split('/')` destructure then truncated it to
   * provider='CUSTOM', model='openai' (the phantom bare 'openai' rows).
   * Slash specs now pass through VERBATIM so env vars, assignments, and
   * engine tracking all carry exactly 'openai/gpt-4o'; colon specs keep the
   * historical rebuild spelling ('OPENROUTER/model-a').
   */
  private toLegacyModelSpec(spec: string): string {
    if (spec.includes('/')) return spec;
    const [provider, model] = this.parseModel(spec);
    return `${provider}/${model}`;
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

    // QA-MAFIA-AI-BENCHMARK-13: a game row carrying durable error evidence
    // is terminal too (same predicate reconcileTerminalRun uses on
    // restart) — otherwise a bridge child that died before publishing any
    // event left the run RUNNING forever with no writer left to finish it.
    const allDone = games.length > 0 && games.every((g) => g.completed_at !== null || g.error !== null);
    if (!allDone) return;

    const now = Date.now();
    const errored = games.some((g) => g.error !== null);
    this.db
      .prepare(
        'UPDATE benchmark_runs SET status = ?, completed_at = ?, summary = ?, updated_at = ? WHERE id = ?',
      )
      .run(errored ? 'FAILED' : 'COMPLETED', now, this.buildRunSummary(runId), now, runId);

    console.log(`[BenchmarkRunner] Run ${runId} ${errored ? 'failed' : 'completed'}`);
  }

  /**
   * Build the run summary payload persisted into benchmark_runs.summary at
   * the terminal transition (DF-MAFIA-AI-BENCHMARK-28). Shape mirrors the
   * reconcile path's summary (totalGames/completedGames/failedGames) plus
   * the per-pairing and per-model winner results so the run record is
   * self-describing without a join. Best-effort: a failure to compute the
   * enrichment NEVER prevents the run transition (the plain counts are the
   * contract; the enrichment is additive).
   */
  private buildRunSummary(runId: string): string {
    const games = this.db
      .prepare('SELECT * FROM benchmark_games WHERE run_id = ?')
      .all(runId) as BenchmarkGameRow[];
    const failed = games.filter((g) => g.error !== null);

    const base: Record<string, unknown> = {
      totalGames: games.length,
      completedGames: games.filter((g) => g.completed_at !== null).length,
      failedGames: failed.length,
    };

    const errored = failed.length > 0;
    if (errored) {
      // FAILED: surface the durable error evidence; when several games
      // failed, join their messages so the run row explains itself.
      base.errorSummary = failed
        .map((g) => `game ${g.game_id}: ${g.error}`)
        .join('; ');
      return JSON.stringify(base);
    }

    // COMPLETED: fold in the run-scoped report (per-pairing winner counts,
    // per-model rows) so the run record carries its own verdict.
    try {
      const report = this.getRunReport(runId);
      if (report) {
        base.pairings = report.pairings;
        base.modelPerformance = report.modelPerformance;
      }
    } catch (e) {
      console.error(
        `[BenchmarkRunner] Run ${runId}: run-report enrichment for summary unavailable: ` +
          (e instanceof Error ? e.message : String(e)),
      );
    }
    return JSON.stringify(base);
  }
}
