/**
 * League Runner Service (MAF-LAYER-3)
 *
 * Scheduled MIXED-MODEL league play: shuffles the configured models across
 * the game's seats, plays the rounds SEQUENTIALLY through the legacy engine
 * path (the path that actually plays games to ENDED), records per-game
 * provenance, and stops creating new games the moment the league's recorded
 * spend reaches the hard budget cap.
 *
 * SEAT MODEL — role groups, not individual player slots:
 * The working engine path resolves each player's model PER ROLE
 * (game-engine.js builds PlayerModelConfig from the *_MODEL env vars the
 * adapter injects — MAFIA_MODEL / SHERIFF_MODEL / DOCTOR_MODEL /
 * VIGILANTE_MODEL / VILLAGER_MODEL); per-player-by-number assignment is
 * explicitly not part of the engine's surface (FLEXIBLE_PLAYER_MODELS.md).
 * A league "seat" is therefore one of the ROLE GROUPS a game actually
 * spawns, mirroring game-engine.js calculateRoles():
 *   - MAFIA, SHERIFF, DOCTOR are always present (numPlayers >= 5),
 *   - VIGILANTE is present when numPlayers >= 6,
 *   - VILLAGER fills the rest (always present at numPlayers >= 5).
 * The persisted seat map assigns one of the CONFIGURED models to every such
 * role group, so no seat ever falls back to the engine's DEFAULT_MODEL.
 *
 * SCHEDULING MODEL — sequential one-shot loop, no daemon:
 * start() persists the run, arms round 1 synchronously, and returns; the
 * loop then plays one game at a time (awaiting each game's terminal event)
 * so the budget gate can read the spend the previous game actually
 * recorded. Nothing requires an always-on process: a single POST plays the
 * configured number of games and ends in a terminal status.
 *
 * COST CAP — spend is read from the league's own token_usage rows (the
 * authoritative per-row source the games.total_cost rollup derives from).
 * Games with no usage rows — or rows with NULL cost — contribute 0 to the
 * spend (missing cost is absence, never a fabricated number); the game
 * still counts as played.
 */

import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { EventBus } from './event-bus.js';
import type { GameRepository } from '../db/repository.js';
import type { LegacyGameAdapter } from './legacy-game-adapter.js';

/** Status vocabulary for a league run. BUDGET_CAPPED is league-specific. */
export type LeagueRunStatusValue =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'BUDGET_CAPPED';

const TERMINAL_LEAGUE_STATUSES: ReadonlySet<LeagueRunStatusValue> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BUDGET_CAPPED',
]);

/**
 * Configuration accepted by POST /api/v1/league.
 *
 * models are 'provider/model' (or legacy 'provider:model') specs; every
 * one of them must be able to hold at least one seat, so at most
 * seatGroupsFor(numPlayers).length distinct models fit a single game.
 */
export interface LeagueConfig {
  models: string[];
  numPlayers?: number;
  /** Number of games (rounds) the league schedules. */
  games?: number;
  /** Hard spend cap in USD. Required, > 0. */
  budgetUsd: number;
  /** Optional shuffle seed (deterministic seat maps for tests/replays). */
  seatSeed?: number;
}

export interface NormalizedLeagueConfig {
  models: string[];
  numPlayers: number;
  games: number;
  budgetUsd: number;
  seatSeed: number;
}

export interface StartLeagueResult {
  leagueId: string;
  games: number;
  models: string[];
  seatGroups: string[];
}

export interface LeagueStatus {
  leagueId: string;
  status: LeagueRunStatusValue;
  config: NormalizedLeagueConfig;
  createdAt: number;
  completedAt: number | null;
  summary: Record<string, unknown> | null;
  error: string | null;
  totalGames: number;
}

/** One league game: provenance + outcome + its own recorded spend. */
export interface LeagueGameRecord {
  gameId: string;
  round: number;
  seatMap: Record<string, string>;
  seatSeed: number;
  winner: string | null;
  completedAt: number | null;
  error: string | null;
  /** Sum of the game's token_usage cost rows; null when none is recorded. */
  costUsd: number | null;
  /** Sum of the game's token_usage token rows; null when no usage exists. */
  totalTokens: number | null;
}

export interface LeagueSpend {
  spentUsd: number;
  budgetUsd: number;
  /** budgetUsd - spentUsd (may go negative when one game overshoots). */
  remainingUsd: number;
  capped: boolean;
}

export interface LeagueDetail {
  status: LeagueStatus;
  games: LeagueGameRecord[];
  spend: LeagueSpend;
}

/** Client-error surface: the routes translate this to HTTP 400. */
export class LeagueValidationError extends Error {}

/**
 * Maximum wall-clock time one league game may take before the runner
 * declares it failed (stops the bridge child, records the reason, and ends
 * the league FAILED — a hung game must not hold the loop, or the budget,
 * hostage). Plain constant on purpose: like STALE_RUN_MAX_MS, this is a
 * policy backstop, not an operator tuning knob.
 */
export const LEAGUE_GAME_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * The canonical seat (role-group) order the league shuffles models across.
 * Mirrors game-engine.js calculateRoles(): the specials are always present
 * at numPlayers >= 5, VIGILANTE joins at >= 6, VILLAGER fills the rest.
 */
export function seatGroupsFor(numPlayers: number): string[] {
  const groups = ['MAFIA', 'SHERIFF', 'DOCTOR'];
  if (numPlayers >= 6) groups.push('VIGILANTE');
  groups.push('VILLAGER');
  return groups;
}

/**
 * Small, fast, well-distributed PRNG (mulberry32). Deterministic per seed —
 * the seeded shuffle behind reproducible seat maps.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle driven by the supplied PRNG (input is not mutated). */
export function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/**
 * Seat assignment for one league game: a seeded shuffle of the configured
 * models, dealt round-robin across the seat groups. Round-robin keeps the
 * deal balanced (each model's group count differs by at most one) and
 * guarantees every configured model holds at least one seat whenever
 * models.length <= seatGroups.length (validated at config time). The seed
 * mixes in the round number, so one league's rounds differ from each other
 * while staying reproducible from the persisted config.
 */
export function assignSeatMap(
  models: readonly string[],
  numPlayers: number,
  seatSeed: number,
  round: number,
): Record<string, string> {
  const groups = seatGroupsFor(numPlayers);
  const rng = mulberry32((seatSeed + round) >>> 0);
  const shuffled = seededShuffle(models, rng);
  const seatMap: Record<string, string> = {};
  groups.forEach((role, i) => {
    seatMap[role] = shuffled[i % shuffled.length];
  });
  return seatMap;
}

interface LeagueRunRow {
  id: string;
  config: string;
  status: string;
  created_at: number;
  completed_at: number | null;
  summary: string | null;
  error: string | null;
}

interface LeagueGameRow {
  game_id: string;
  league_run_id: string;
  round: number;
  seat_map: string;
  seat_seed: number;
  winner: string | null;
  completed_at: number | null;
  error: string | null;
}

/** How one awaited game ended. */
interface LeagueGameOutcome {
  winner: string | null;
  error: string | null;
}

interface LaunchOutcome {
  ok: boolean;
  error?: string;
  done?: Promise<LeagueGameOutcome>;
  gameId?: string;
}

export class LeagueRunner {
  private readonly db: Database.Database;
  private readonly eventBus: EventBus;
  private readonly legacyAdapter: LegacyGameAdapter | null;

  constructor(deps: {
    eventBus: EventBus;
    gameRepository: GameRepository;
    legacyAdapter: LegacyGameAdapter | null;
  }) {
    this.eventBus = deps.eventBus;
    this.legacyAdapter = deps.legacyAdapter;
    this.db = deps.gameRepository.getDatabase();
  }

  // ==================== Public surface ====================

  /**
   * Start a league run: validate config, persist the run, and play the
   * scheduled games to a terminal status. Returns after round 1 is armed —
   * the loop continues asynchronously (the synchronous prologue of the
   * async loop runs before this method returns, so by return time the
   * first game is launched and its terminal watcher installed).
   */
  start(config: LeagueConfig): StartLeagueResult {
    const normalized = this.validateConfig(config);
    if (!this.legacyAdapter) {
      // Deliberately NO GameEngine fallback: GameEngine.startGame has no
      // game loop (MAF-GAP-011) and would strand games IN_PROGRESS — the
      // one outcome a league must never produce.
      throw new LeagueValidationError(
        'League requires the legacy game adapter (the engine path that plays games to ENDED); it is not initialized on this server',
      );
    }

    const leagueId = uuidv4();
    const now = Date.now();
    this.persistLeague(leagueId, normalized, 'QUEUED', now);

    // Fire-and-forget: the loop owns its own error handling and always
    // drives the run row to a terminal status.
    void this.runLoop(leagueId, normalized);

    return {
      leagueId,
      games: normalized.games,
      models: normalized.models,
      seatGroups: seatGroupsFor(normalized.numPlayers),
    };
  }

  /** Query the persisted status of a league run (null when unknown). */
  getStatus(leagueId: string): LeagueStatus | null {
    const row = this.readRunRow(leagueId);
    if (!row) return null;

    const totalGames = (
      this.db
        .prepare('SELECT COUNT(*) as count FROM league_games WHERE league_run_id = ?')
        .get(leagueId) as { count: number }
    ).count;

    return {
      leagueId: row.id,
      status: row.status as LeagueRunStatusValue,
      config: JSON.parse(row.config) as NormalizedLeagueConfig,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      summary: row.summary ? this.parseSummary(row.summary) : null,
      error: row.error,
      totalGames,
    };
  }

  /**
   * Full league record: status + per-game provenance/outcome + spend/cap
   * state. Null when the league id is unknown.
   */
  getDetail(leagueId: string): LeagueDetail | null {
    const status = this.getStatus(leagueId);
    if (!status) return null;

    const rows = this.db
      .prepare(
        'SELECT * FROM league_games WHERE league_run_id = ? ORDER BY round ASC, game_id ASC',
      )
      .all(leagueId) as LeagueGameRow[];

    const games: LeagueGameRecord[] = rows.map((row) => {
      const usage = this.gameUsage(row.game_id);
      return {
        gameId: row.game_id,
        round: row.round,
        seatMap: this.parseSeatMap(row.seat_map),
        seatSeed: row.seat_seed,
        winner: row.winner,
        completedAt: row.completed_at,
        error: row.error,
        costUsd: usage.costUsd,
        totalTokens: usage.totalTokens,
      };
    });

    const budgetUsd = status.config.budgetUsd;
    const spentUsd = this.leagueSpend(leagueId);
    return {
      status,
      games,
      spend: {
        spentUsd,
        budgetUsd,
        remainingUsd: budgetUsd - spentUsd,
        capped: spentUsd >= budgetUsd,
      },
    };
  }

  /** List all league runs, most recent first (rowid = insertion order, so
   * same-millisecond created_at values keep a stable order). */
  listLeagues(): LeagueStatus[] {
    const rows = this.db
      .prepare('SELECT id FROM league_runs ORDER BY rowid DESC LIMIT 50')
      .all() as Array<{ id: string }>;
    const statuses: LeagueStatus[] = [];
    for (const row of rows) {
      const status = this.getStatus(row.id);
      if (status) statuses.push(status);
    }
    return statuses;
  }

  /**
   * Cancel a non-terminal league. The loop honours the flag between rounds;
   * the in-flight game (if any) is left to wind down naturally.
   */
  cancel(leagueId: string): boolean {
    const status = this.getStatus(leagueId);
    if (!status) return false;
    if (TERMINAL_LEAGUE_STATUSES.has(status.status)) return false;
    const now = Date.now();
    this.db
      .prepare(
        "UPDATE league_runs SET status = 'CANCELLED', completed_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(now, now, leagueId);
    console.log(`[LeagueRunner] League ${leagueId} cancelled`);
    return true;
  }

  // ==================== League loop ====================

  /**
   * The league loop: play up to config.games rounds sequentially, applying
   * the budget gate before every launch. Always drives the run row to a
   * terminal status:
   *   - BUDGET_CAPPED when the gate refuses a new game,
   *   - FAILED when a game failed (its evidence lives on the game row and
   *     the run's error column joins the messages),
   *   - COMPLETED when every scheduled round finished,
   *   - FAILED (fatal) when the loop itself threw before finishing,
   *   - CANCELLED is left as written by cancel() (checked between rounds).
   */
  private async runLoop(leagueId: string, config: NormalizedLeagueConfig): Promise<void> {
    const startedAt = Date.now();
    this.updateRunStatus(leagueId, 'RUNNING', startedAt);

    const gameErrors: string[] = [];
    const launchFailures: string[] = [];
    let capped = false;

    try {
      for (let round = 1; round <= config.games; round++) {
        // An operator cancel between rounds ends the loop quietly.
        const current = this.readRunRow(leagueId);
        if (current && current.status === 'CANCELLED') {
          console.log(`[LeagueRunner] League ${leagueId}: cancelled before round ${round}`);
          return;
        }

        // Budget gate — BEFORE creating each new game. Spend comes from the
        // league's own token_usage rows (missing cost counts as 0).
        const spend = this.leagueSpend(leagueId);
        if (spend >= config.budgetUsd) {
          capped = true;
          break;
        }

        const launched = this.launchLeagueGame(leagueId, round, config);
        if (!launched.ok) {
          // A launch that never produced a game has NO league_games row
          // (its game_id FK requires a real game); the failure is recorded
          // as run-level evidence instead — the loop keeps going so a
          // later round can still play.
          launchFailures.push(`round ${round}: ${launched.error}`);
          continue;
        }

        const outcome = await launched.done!;
        const now = Date.now();
        if (outcome.error) {
          gameErrors.push(`round ${round} (game ${launched.gameId}): ${outcome.error}`);
          this.db
            .prepare('UPDATE league_games SET error = ? WHERE game_id = ?')
            .run(outcome.error, launched.gameId);
        } else {
          // Terminal event evidence: persist the outcome on the game's
          // provenance row (winner may be absent on a degenerate game —
          // recorded as null, never fabricated).
          this.db
            .prepare(
              'UPDATE league_games SET winner = ?, completed_at = ? WHERE game_id = ?',
            )
            .run(outcome.winner, now, launched.gameId);
        }
      }

      this.terminalize(leagueId, config, { capped, gameErrors, launchFailures });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failRun(leagueId, `League loop failed: ${message}`);
    }
  }

  /**
   * Launch one league game through the legacy adapter (the working engine
   * path) and arm its terminal watcher. The watcher resolves on the game's
   * terminal EventBus event (WINNER_DETERMINED or the adapter's GAME_ENDED
   * remap), on a bridge child that dies without publishing one (the
   * QA-MAFIA-AI-BENCHMARK-13 pattern), or on the per-game timeout — never
   * leaving the loop wedged.
   */
  private launchLeagueGame(
    leagueId: string,
    round: number,
    config: NormalizedLeagueConfig,
  ): LaunchOutcome {
    const roundSeed = (config.seatSeed + round) >>> 0;
    const seatMap = assignSeatMap(config.models, config.numPlayers, config.seatSeed, round);

    // The seat map keys are the engine's real role names (VILLAGER covers
    // the TOWN alias), so the adapter persists every role covered and the
    // child resolves no DEFAULT_MODEL fallback.
    let gameState;
    try {
      gameState = this.legacyAdapter!.startGame({
        numPlayers: config.numPlayers,
        gameConfig: { numPlayers: config.numPlayers, engineType: 'legacy' },
        roleModels: { ...seatMap },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `legacy game launch failed: ${message}` };
    }

    const gameId = gameState.gameId;
    this.db
      .prepare(
        `INSERT INTO league_games (game_id, league_run_id, round, seat_map, seat_seed)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(gameId, leagueId, round, JSON.stringify(seatMap), roundSeed);

    const done = this.awaitGameTerminal(gameId, gameState);
    return { ok: true, gameId, done };
  }

  /**
   * Resolve exactly once when the game reaches a terminal state. Three
   * signals, first one wins: a terminal event on the EventBus, a bridge
   * child exiting nonzero without publishing one, or the per-game timeout.
   */
  private awaitGameTerminal(
    gameId: string,
    gameState: { process: import('child_process').ChildProcess | null },
  ): Promise<LeagueGameOutcome> {
    return new Promise<LeagueGameOutcome>((resolve) => {
      let settled = false;
      let unsubscribe: () => void = () => {};

      const settle = (outcome: LeagueGameOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        settle({
          winner: null,
          error: `game exceeded the ${Math.round(LEAGUE_GAME_TIMEOUT_MS / 60000)} minute league game timeout`,
        });
      }, LEAGUE_GAME_TIMEOUT_MS);
      // Never hold the process open on a pending game timer (CI-safe exit).
      timer.unref?.();

      unsubscribe = this.eventBus.subscribe(['WINNER_DETERMINED', 'GAME_ENDED'], (event) => {
        if (event.gameId !== gameId) return;
        const winner = (event.data as { winner?: string } | undefined)?.winner ?? null;
        settle({ winner: winner ?? null, error: null });
      });

      // A bridge child that dies BEFORE any terminal event must not wedge
      // the league for the full timeout (same shape as BenchmarkRunner's
      // QA-MAFIA-AI-BENCHMARK-13 watcher).
      const child = gameState.process;
      if (child && typeof child.on === 'function') {
        child.on('close', (code: number | null) => {
          if (code === 0 || code === null) return;
          settle({
            winner: null,
            error:
              `legacy bridge process exited with code ${code} without publishing ` +
              `a terminal game event (no 'done' — bridge likely failed to start)`,
          });
        });
      }
    });
  }

  /** Drive the run row to its terminal state from the loop's evidence. */
  private terminalize(
    leagueId: string,
    config: NormalizedLeagueConfig,
    evidence: { capped: boolean; gameErrors: string[]; launchFailures: string[] },
  ): void {
    const now = Date.now();
    const games = this.db
      .prepare('SELECT completed_at, error FROM league_games WHERE league_run_id = ?')
      .all(leagueId) as Array<{ completed_at: number | null; error: string | null }>;

    const completedGames = games.filter((g) => g.completed_at !== null).length;
    const failedGames = games.filter((g) => g.error !== null).length;
    const spentUsd = this.leagueSpend(leagueId);

    const failureMessages = [...evidence.gameErrors, ...evidence.launchFailures];
    let status: LeagueRunStatusValue;
    let error: string | null = null;
    if (evidence.capped) {
      status = 'BUDGET_CAPPED';
    } else if (failureMessages.length > 0 || failedGames > 0) {
      status = 'FAILED';
      error = failureMessages.join('; ') || null;
    } else {
      status = 'COMPLETED';
    }

    const summary: Record<string, unknown> = {
      totalGames: games.length,
      completedGames,
      failedGames,
      launchFailures: evidence.launchFailures.length,
      roundsScheduled: config.games,
      spendUsd: spentUsd,
      budgetUsd: config.budgetUsd,
      capped: evidence.capped,
    };

    this.db
      .prepare(
        `UPDATE league_runs
           SET status = ?, error = ?, completed_at = ?, summary = ?, updated_at = ?
         WHERE id = ? AND status != 'CANCELLED'`,
      )
      .run(status, error, now, JSON.stringify(summary), now, leagueId);

    console.log(
      `[LeagueRunner] League ${leagueId} ${status}: ${completedGames} completed, ` +
        `${failedGames} failed, spend $${spentUsd.toFixed(6)} of $${config.budgetUsd}`,
    );
  }

  private failRun(leagueId: string, error: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE league_runs
           SET status = 'FAILED', error = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(error, now, now, leagueId);
    console.error(`[LeagueRunner] League ${leagueId} failed: ${error}`);
  }

  // ==================== Spend / provenance reads ====================

  /**
   * The league's recorded spend: SUM of token_usage.cost over the league's
   * own game rows. Rows without a cost (no pricing entry) and games without
   * usage rows contribute 0 — missing cost is absence, never a fabricated
   * number.
   */
  private leagueSpend(leagueId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(tu.cost), 0) AS spend
           FROM token_usage tu
           JOIN league_games lg ON lg.game_id = tu.game_id
          WHERE lg.league_run_id = ?`,
      )
      .get(leagueId) as { spend: number | null };
    return row.spend ?? 0;
  }

  /** One game's usage rollup: null when no usage rows exist. */
  private gameUsage(gameId: string): { costUsd: number | null; totalTokens: number | null } {
    const row = this.db
      .prepare(
        'SELECT SUM(cost) AS cost, SUM(total_tokens) AS tokens FROM token_usage WHERE game_id = ?',
      )
      .get(gameId) as { cost: number | null; tokens: number | null };
    return { costUsd: row.cost ?? null, totalTokens: row.tokens ?? null };
  }

  // ==================== Persistence helpers ====================

  private readRunRow(leagueId: string): LeagueRunRow | undefined {
    return this.db
      .prepare('SELECT * FROM league_runs WHERE id = ?')
      .get(leagueId) as LeagueRunRow | undefined;
  }

  private persistLeague(
    leagueId: string,
    config: NormalizedLeagueConfig,
    status: LeagueRunStatusValue,
    now: number,
  ): void {
    this.db
      .prepare(
        'INSERT INTO league_runs (id, config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(leagueId, JSON.stringify(config), status, now, now);
  }

  private updateRunStatus(leagueId: string, status: LeagueRunStatusValue, now: number): void {
    this.db
      .prepare('UPDATE league_runs SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, leagueId);
  }

  private parseSummary(raw: string): Record<string, unknown> | null {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private parseSeatMap(raw: string): Record<string, string> {
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  // ==================== Config validation ====================

  private validateConfig(config: LeagueConfig): NormalizedLeagueConfig {
    if (!config || typeof config !== 'object') {
      throw new LeagueValidationError('League config is required');
    }

    const models = config.models;
    if (!Array.isArray(models) || models.length < 2) {
      throw new LeagueValidationError('League config must include at least 2 models');
    }
    const seen = new Set<string>();
    for (const m of models) {
      if (typeof m !== 'string' || m.trim().length === 0) {
        throw new LeagueValidationError(`Invalid model entry: ${String(m)}`);
      }
      const key = m.trim();
      if (seen.has(key)) {
        throw new LeagueValidationError(`Duplicate model in config: ${key}`);
      }
      seen.add(key);
    }

    const numPlayers =
      typeof config.numPlayers === 'number' && Number.isInteger(config.numPlayers)
        ? config.numPlayers
        : 10;
    if (numPlayers < 5 || numPlayers > 50) {
      throw new LeagueValidationError(
        `League numPlayers must be between 5 and 50 (engine minimum is 5), got ${numPlayers}`,
      );
    }

    // Every configured model must be able to hold at least one seat.
    const seatGroups = seatGroupsFor(numPlayers);
    if (models.length > seatGroups.length) {
      throw new LeagueValidationError(
        `League config has ${models.length} models but a ${numPlayers}-player game only has ` +
          `${seatGroups.length} seat groups (${seatGroups.join(', ')}); reduce the models or raise numPlayers`,
      );
    }

    const games =
      typeof config.games === 'number' && Number.isInteger(config.games) && config.games > 0
        ? config.games
        : 2;
    if (games > 1000) {
      throw new LeagueValidationError(`League games must be at most 1000, got ${games}`);
    }

    const budgetUsd = config.budgetUsd;
    if (typeof budgetUsd !== 'number' || !Number.isFinite(budgetUsd) || budgetUsd <= 0) {
      throw new LeagueValidationError(
        `League budgetUsd must be a positive number (hard spend cap), got ${String(budgetUsd)}`,
      );
    }

    const seatSeed =
      typeof config.seatSeed === 'number' && Number.isFinite(config.seatSeed) && config.seatSeed >= 0
        ? Math.floor(config.seatSeed) % 0x7fffffff
        : Math.floor(Math.random() * 0x7fffffff);

    return {
      models: Array.from(seen),
      numPlayers,
      games,
      budgetUsd,
      seatSeed,
    };
  }
}
