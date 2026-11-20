/**
 * Observability — Tier-0 Prometheus metric families (OBS-001).
 *
 * Design authority: docs/observability-spec.md section 3.1 (catalogue),
 * section 4 (exposure on the existing Express listener), section 6.1
 * (verification). One Registry, default process metrics collected for free,
 * and five mafia_* families:
 *
 *   mafia_server_up             gauge      {version}
 *   mafia_game_active           gauge      (no labels)
 *   mafia_game_ended_total      counter    {outcome, provider}
 *   mafia_game_failed_total     counter    {reason}
 *   mafia_game_duration_seconds histogram  {provider}
 *
 * Cardinality policy (spec 3.1 + OBS-001 brief): label sets are CLOSED and
 * low-cardinality. outcome ∈ {completed, cancelled, failed, degenerate};
 * reason ∈ {bridge_spawn, bridge_crash, budget_exceeded, upstream_error,
 * timeout, unknown}; provider is the model-spec PREFIX (openai / anthropic /
 * google / openrouter / custom) when determinable, else the literal
 * 'unknown'. game_id, run_id, player_id, model_pair, seeds, paths and
 * timestamps are NEVER labels or metric names — a game lifecycle is one
 * timeseries increment, not an identifier leak.
 *
 * OBS-002 extends the SAME registry with the ten Tier-1 families from
 * docs/observability-spec.md section 3.2 (benchmark runs + LLM depth). They
 * follow exactly the same rules: closed label sets, zero-valued
 * pre-registration at module load (a fresh process must be scrapable), and
 * recording helpers that coerce/drop bad input instead of throwing.
 */

import fs from 'node:fs';

import type { NextFunction, Request, Response } from 'express';
import client, { type Counter, type Gauge, type Histogram, type Registry } from 'prom-client';

import {
  classifyGameLiveness,
  isOrphanVerdict,
  type GameLivenessRow,
} from '../services/game-liveness.js';

/** Single source of truth for the mafia_server_up version label. */
export const SERVER_VERSION: string = process.env.npm_package_version || '1.2.0';

/** The registry the /metrics handler renders. One per process. */
export const registry: Registry = new client.Registry();

// Process CPU / heap / event-loop lag / GC — free from prom-client, same
// registry so a single scrape covers process health and game health.
client.collectDefaultMetrics({ register: registry });

export const GAME_OUTCOMES = ['completed', 'cancelled', 'failed', 'degenerate'] as const;
export type GameOutcome = (typeof GAME_OUTCOMES)[number];

export const FAILURE_REASONS = [
  'bridge_spawn',
  'bridge_crash',
  'budget_exceeded',
  'upstream_error',
  'timeout',
  'unknown',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * Closed provider-prefix set for the {provider} label. Only a model-spec
 * prefix in this set is ever emitted (case-insensitive match, normalized to
 * lower case); anything unresolvable becomes the literal 'unknown'. This is
 * what keeps the label low-cardinality even though model specs are freeform.
 */
export const KNOWN_PROVIDER_PREFIXES: ReadonlySet<string> = new Set([
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'custom',
]);
export type GameProvider = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'custom' | 'unknown';

const serverUp: Gauge<string> = new client.Gauge({
  name: 'mafia_server_up',
  help: 'Is the server process serving at all, and what build?',
  labelNames: ['version'],
  registers: [registry],
});
serverUp.set({ version: SERVER_VERSION }, 1);

const gameActiveGauge: Gauge<string> = new client.Gauge({
  name: 'mafia_game_active',
  help: 'Games running right now (legacy adapter child processes).',
  registers: [registry],
});

const gameEndedCounter: Counter<string> = new client.Counter({
  name: 'mafia_game_ended_total',
  help: 'Games finished, by outcome and provider prefix.',
  labelNames: ['outcome', 'provider'],
  registers: [registry],
});

const gameFailedCounter: Counter<string> = new client.Counter({
  name: 'mafia_game_failed_total',
  help: 'Games that died, by failure reason.',
  labelNames: ['reason'],
  registers: [registry],
});

const gameDurationHistogram: Histogram<string> = new client.Histogram({
  name: 'mafia_game_duration_seconds',
  help: 'How long one game takes (buckets set the "stuck" threshold).',
  labelNames: ['provider'],
  buckets: [60, 120, 300, 600, 900, 1800, 3600, 7200],
  registers: [registry],
});

const GAME_PROVIDER_LABELS: readonly GameProvider[] = [
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'custom',
  'unknown',
];

/**
 * Instantiate every closed-label series at ZERO at module load.
 *
 * prom-client emits no sample line for a counter or histogram that has never
 * been observed, so a freshly booted server would expose only
 * mafia_server_up and mafia_game_active and the OBS-001 acceptance scrape
 * (`curl .../metrics | grep -c '^mafia_' >= 5`) plus every dashboard built on
 * these families would read "no data" instead of "zero games ended". The label
 * sets are closed and tiny (4 outcomes x 6 provider prefixes, 6 reasons), so
 * pre-registering them costs a fixed 30 series and leaks no identifiers.
 */
for (const provider of GAME_PROVIDER_LABELS) {
  for (const outcome of GAME_OUTCOMES) {
    gameEndedCounter.inc({ outcome, provider }, 0);
  }
  gameDurationHistogram.zero({ provider });
}
for (const reason of FAILURE_REASONS) {
  gameFailedCounter.inc({ reason }, 0);
}

/** Live count backing mafia_game_active; clamped so the gauge never dips below zero. */
let activeGameCount = 0;

/**
 * Move mafia_game_active by a delta (+1 on spawn accepted, -1 on the
 * terminal transition). Never below zero.
 */
export function gameActive(delta: number): void {
  activeGameCount = Math.max(0, activeGameCount + delta);
  gameActiveGauge.set(activeGameCount);
}

/**
 * Normalize an arbitrary provider-ish value to the closed label set: the
 * model-spec prefix before the first '/', matched case-insensitively against
 * KNOWN_PROVIDER_PREFIXES; everything else is 'unknown'.
 */
function normalizeProvider(raw: unknown): GameProvider {
  if (typeof raw === 'string' && raw.trim()) {
    const prefix = raw.trim().split('/')[0].toLowerCase();
    if (KNOWN_PROVIDER_PREFIXES.has(prefix)) return prefix as GameProvider;
  }
  return 'unknown';
}

/**
 * Resolve the {provider} label from the bridge's per-model usage rows
 * ('done' message). First row whose provider maps into the closed prefix
 * set wins; missing/empty/unresolvable rows yield 'unknown'. Only the
 * PREFIX is ever exposed — model names and token counts never become labels.
 */
export function providerFromUsageRows(usage: unknown): GameProvider {
  const rows = Array.isArray(usage) ? usage : [];
  for (const row of rows) {
    const provider =
      row && typeof row === 'object' ? (row as { provider?: unknown }).provider : undefined;
    if (typeof provider === 'string' && provider.trim()) {
      const prefix = provider.trim().split('/')[0].toLowerCase();
      if (KNOWN_PROVIDER_PREFIXES.has(prefix)) return prefix as GameProvider;
    }
  }
  return 'unknown';
}

/** Record one finished game on mafia_game_ended_total. Invalid labels coerce into the closed sets instead of throwing. */
export function gameEnded(outcome: GameOutcome, provider: unknown = 'unknown'): void {
  const safeOutcome: GameOutcome = (GAME_OUTCOMES as readonly string[]).includes(outcome)
    ? outcome
    : 'failed';
  gameEndedCounter.inc({ outcome: safeOutcome, provider: normalizeProvider(provider) }, 1);
}

/** Record one failure reason on mafia_game_failed_total. Unknown reasons coerce to 'unknown'. */
export function gameFailed(reason: FailureReason): void {
  const safeReason: FailureReason = (FAILURE_REASONS as readonly string[]).includes(reason)
    ? reason
    : 'unknown';
  gameFailedCounter.inc({ reason: safeReason }, 1);
}

/** Observe one game duration in seconds. Non-finite/negative values are dropped, never thrown. */
export function gameDuration(seconds: number, provider: unknown = 'unknown'): void {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  gameDurationHistogram.observe({ provider: normalizeProvider(provider) }, seconds);
}

/**
 * Structural view of a game the adapter tracks, carrying the OBS-001
 * single-count guard. The adapter's LegacyGameState satisfies this shape.
 */
export interface MetricsGameRecord {
  /** Single-count guard: the FIRST terminal recording for this game wins. */
  metricsRecorded?: boolean;
  startedAt?: Date;
  endedAt?: Date;
  /** Set when the DF-18 degenerate-game flag fired for this game. */
  degenerate?: boolean;
  /** Resolved provider prefix for the {provider} label. */
  provider?: string;
}

/** One terminal transition, already classified into the closed label sets. */
export interface TerminalRecord {
  outcome: GameOutcome;
  /** When present, mafia_game_failed_total{reason} is incremented too. */
  reason?: FailureReason;
  provider?: unknown;
  durationSeconds?: number;
}

/**
 * Record a game's terminal transition EXACTLY once.
 *
 * A single legacy game produces several terminal-ish signals: the 'done'
 * bridge message, the child 'close' event, and (for failed spawns) the child
 * 'error' event. The adapter routes all of them through this function; the
 * per-game metricsRecorded flag on the tracked state makes the first call
 * win and every later call a no-op, so mafia_game_ended_total increments
 * exactly once and mafia_game_active decrements exactly once per game.
 *
 * Returns true when this call was the recording one, false when the game was
 * already recorded (tests assert the single-count property with this).
 */
export function recordGameTerminal(state: MetricsGameRecord, record: TerminalRecord): boolean {
  if (state.metricsRecorded) return false;
  state.metricsRecorded = true;
  gameEnded(record.outcome, record.provider);
  if (record.reason) gameFailed(record.reason);
  if (typeof record.durationSeconds === 'number') {
    gameDuration(record.durationSeconds, record.provider);
  }
  gameActive(-1);
  return true;
}

// ===========================================================================
// OBS-001 — the DURABLE side of the game counters (boot seed + gauge source)
// ===========================================================================
//
// DF-MAFIA-AI-BENCHMARK-50: the live deployment served `mafia_game_ended_total{
// outcome=*} 0` beside 4,885 ENDED games. Two related holes, both fixed here:
//
//   1. `mafia_game_ended_total` is cumulative by definition ("how many games
//      have ended"), but the counter only knew about games THIS process
//      observed. Every restart reset the family to 0 while `games` held the
//      durable truth — exactly the observation in the ticket. The seed below
//      replays the durable rows once at boot, the same doctrine OBS-002
//      already applies to the cumulative LLM counters.
//   2. `mafia_game_active` was a pure process-local delta (+1 on spawn, -1 on
//      terminal), so it disagreed with the games table whenever a row left
//      IN_PROGRESS without a 'done' message, and it started at 0 on a stack
//      whose DB still held live rows. The gauge is now RECONCILED from the
//      same table the orphan gauge reads (IN_PROGRESS rows) at every
//      lifecycle edge; the delta remains the fallback for repositories with
//      no db handle.

/**
 * The source of truth behind mafia_game_active: the games table the adapter
 * writes. Deliberately the plain IN_PROGRESS count — `mafia_game_in_progress`
 * (OBS-006) is the ORPHAN view of the same rows, so the two answer different
 * questions over one predicate family.
 */
export const ACTIVE_GAMES_COUNT_SQL = `SELECT COUNT(*) AS count
 FROM games
 WHERE status = 'IN_PROGRESS'`;

/**
 * Durable terminal rows for the boot seed, with the provider hint the
 * {provider} label needs. `providers` is the distinct set of the game's
 * per-player provider specs (players.provider is written from roleModels and
 * backfilled from real usage rows); the fold picks the first one that maps
 * into the closed prefix set, mirroring providerFromUsageRows' rule.
 *
 * ENDED and CANCELLED are the only durable terminal statuses this schema has:
 * a failed game's row is written CANCELLED by the adapter's close handler, so
 * 'failed' is NOT reconstructible here and is never invented.
 */
export const TERMINAL_GAMES_SEED_SQL = `SELECT
   g.id AS id,
   g.status AS status,
   g.config AS config,
   (SELECT GROUP_CONCAT(DISTINCT TRIM(p.provider))
      FROM players p
     WHERE p.game_id = g.id
       AND p.provider IS NOT NULL
       AND TRIM(p.provider) != '') AS providers
 FROM games g
 WHERE g.status IN ('ENDED', 'CANCELLED')`;

/** One raw terminal row as it comes back out of `games`. */
export interface TerminalGameSeedRow {
  id?: unknown;
  status?: unknown;
  config?: unknown;
  providers?: unknown;
}

/** One series in the CLOSED {outcome, provider} label set after folding. */
export interface GameSeedSeries {
  outcome: GameOutcome;
  provider: GameProvider;
  count: number;
}

/** Result of folding raw terminal rows into the bounded label set. */
export interface GameSeedAggregate {
  /** Terminal rows read. */
  terminal: number;
  /** Rows that landed on a series. */
  seeded: number;
  /** Rows with a status outside {ENDED, CANCELLED} (never counted). */
  skipped: number;
  ended: number;
  cancelled: number;
  degenerate: number;
  series: GameSeedSeries[];
  /**
   * mafia_game_active after the seed (the IN_PROGRESS row count), or null when
   * the gauge read failed. Only set by seedGameCountersFromDatabase.
   */
  active: number | null;
}

/** True when a games.config payload carries the DF-18 degenerate flag. */
function isDegenerateConfig(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw.trim()) return false;
  try {
    const parsed = JSON.parse(raw) as { degenerate?: unknown };
    const flag = parsed?.degenerate;
    return flag === 1 || flag === true || flag === '1';
  } catch {
    return false;
  }
}

/**
 * Resolve the {provider} label from the seed row's provider list: the first
 * spec whose prefix is in the closed set wins, else 'unknown'. Raw specs never
 * become labels (spec 3.2 cardinality policy) — this is providerFromUsageRows'
 * rule applied to a players-derived list.
 */
function providerFromSeedRow(raw: unknown): GameProvider {
  if (typeof raw === 'string') {
    for (const part of raw.split(',')) {
      const candidate = normalizeProvider(part);
      if (candidate !== 'unknown') return candidate;
    }
  }
  return 'unknown';
}

/** Map a durable games.status (+ DF-18 flag) onto the closed outcome set. */
function seedRowOutcome(row: TerminalGameSeedRow): GameOutcome | null {
  const status = typeof row.status === 'string' ? row.status.trim().toUpperCase() : '';
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'ENDED') return isDegenerateConfig(row.config) ? 'degenerate' : 'completed';
  return null;
}

/**
 * Fold raw terminal games rows into the SAME closed label sets the live
 * recorder uses. Pure: no counters are touched, so a test can call it freely.
 */
export function aggregateTerminalGameRows(rows: unknown): GameSeedAggregate {
  const list = Array.isArray(rows) ? (rows as TerminalGameSeedRow[]) : [];
  const byLabels = new Map<string, GameSeedSeries>();
  const aggregate: GameSeedAggregate = {
    terminal: list.length,
    seeded: 0,
    skipped: 0,
    ended: 0,
    cancelled: 0,
    degenerate: 0,
    series: [],
    active: null,
  };

  for (const row of list) {
    if (!row || typeof row !== 'object') {
      aggregate.skipped += 1;
      continue;
    }
    const outcome = seedRowOutcome(row);
    if (!outcome) {
      aggregate.skipped += 1;
      continue;
    }
    const provider = providerFromSeedRow(row.providers);
    const key = `${outcome}\u0000${provider}`;
    const series = byLabels.get(key) ?? { outcome, provider, count: 0 };
    series.count += 1;
    byLabels.set(key, series);
    aggregate.seeded += 1;
    if (outcome === 'cancelled') aggregate.cancelled += 1;
    else aggregate.ended += 1;
    if (outcome === 'degenerate') aggregate.degenerate += 1;
  }

  aggregate.series = Array.from(byLabels.values());
  return aggregate;
}

/** Minimal slice of the DB a game-metric read needs (all + get). */
export interface MetricsGameSeedDatabase extends MetricsSeedDatabase {
  prepare(sql: string): {
    all(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
  };
}

/** Set once the game-counter seed has run, so a second call cannot double-count. */
let gameCountersSeeded = false;

/** True once seedGameCountersFromDatabase has applied (exported for the boot log). */
export function gameCountersSeedApplied(): boolean {
  return gameCountersSeeded;
}

/**
 * Recompute mafia_game_active from the games table (ACTIVE_GAMES_COUNT_SQL).
 *
 * Returns the count that was set, or null when the read failed — in which case
 * the gauge keeps its previous value and the caller falls back to the delta.
 * Never throws: a wedged DB must not break a game's lifecycle handling.
 */
export function syncGameActiveFromDatabase(db: MetricsGameSeedDatabase): number | null {
  try {
    const row = db.prepare(ACTIVE_GAMES_COUNT_SQL).get() as { count?: unknown } | undefined;
    const count = countOf(row?.count);
    activeGameCount = count;
    gameActiveGauge.set(count);
    return count;
  } catch (error) {
    console.error(
      `[metrics] mafia_game_active reconcile failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/**
 * Seed the CUMULATIVE game counters (and the active gauge) from durable rows.
 *
 * Contract, mirroring seedLlmUsageFromDatabase:
 *   - Runs ONCE per process, at boot, before the listener exists, so the
 *     counter is (history at boot) + (games this process ends).
 *   - Idempotent: a second call returns null and touches nothing.
 *   - Never throws: reads happen first (both statements), the applied flag is
 *     set before any increment (increments cannot fail), and a wedged DB just
 *     leaves the pre-registered zeros plus a logged error.
 *   - Seeds mafia_game_ended_total and mafia_game_active only. Duration
 *     observations, mafia_game_failed_total and every Tier-1 family are
 *     per-observation evidence with no faithful durable replay, so they stay
 *     process-lifetime.
 */
export function seedGameCountersFromDatabase(
  db: MetricsGameSeedDatabase,
): GameSeedAggregate | null {
  if (gameCountersSeeded) return null;
  try {
    const aggregate = aggregateTerminalGameRows(db.prepare(TERMINAL_GAMES_SEED_SQL).all());
    const activeRow = db.prepare(ACTIVE_GAMES_COUNT_SQL).get() as { count?: unknown } | undefined;
    const active = countOf(activeRow?.count);

    gameCountersSeeded = true;
    for (const series of aggregate.series) {
      gameEndedCounter.inc({ outcome: series.outcome, provider: series.provider }, series.count);
    }
    activeGameCount = active;
    gameActiveGauge.set(active);
    aggregate.active = active;
    return aggregate;
  } catch (error) {
    console.error(
      `[metrics] game counter seed failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

// ===========================================================================
// OBS-002 — Tier 1: benchmark-run and LLM depth (spec section 3.2)
// ===========================================================================

/**
 * Closed {status} set for mafia_benchmark_run_total.
 *
 * The counter increments on a run's TERMINAL transition only. A counter of an
 * in-flight state is meaningless (there is no way to decrement it), so
 * RUNNING is pre-registered at zero for dashboard completeness and is never
 * incremented — `benchmarkRunTerminal('RUNNING')` is a documented no-op.
 */
export const BENCHMARK_RUN_STATUSES = ['RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED'] as const;
export type BenchmarkRunStatusLabel = (typeof BENCHMARK_RUN_STATUSES)[number];

/** Statuses that may actually increment the run counter. */
export const TERMINAL_RUN_STATUSES: readonly BenchmarkRunStatusLabel[] = [
  'COMPLETED',
  'CANCELLED',
  'FAILED',
];

/**
 * Outcome of ONE upstream LLM request — the subset of the spec's closed
 * `outcome` vocabulary that describes a single request. A request cannot be
 * 'degenerate' (that is a whole-game verdict), and a cancelled game's calls
 * are simply never counted because there is no per-call evidence for them.
 */
export const LLM_REQUEST_OUTCOMES = ['completed', 'failed'] as const;
export type LlmRequestOutcome = (typeof LLM_REQUEST_OUTCOMES)[number];

/** Token directions exposed by mafia_llm_tokens_total. */
export const TOKEN_DIRECTIONS = ['prompt', 'completion'] as const;
export type TokenDirection = (typeof TOKEN_DIRECTIONS)[number];

/**
 * Closed retry-cause set for mafia_llm_retry_total{reason}. The engine retries
 * for exactly three reasons — response_format rejection
 * (game-engine.js:5026-5033), JSON parse failure (:5136-5141) and network
 * error (:5181-5186) — and anything unrecognized collapses to 'unknown'
 * rather than leaking a free-form log string into a label.
 */
export const LLM_RETRY_REASONS = ['response_format', 'network_error', 'parse_error', 'unknown'] as const;
export type LlmRetryReason = (typeof LLM_RETRY_REASONS)[number];

/**
 * Documented default {model} allow-list: the models .env.sample and the CLI's
 * DEFAULT_MODELS actually run. This is the cardinality bound for the
 * mafia_llm_* families — a benchmark that names 4,874 models must not create
 * 4,874 series. Override with METRICS_MODEL_ALLOWLIST (comma-separated; see
 * .env.sample and CONFIG_GUIDE.md).
 */
export const DEFAULT_MODEL_ALLOWLIST = [
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4',
  'claude-3-haiku',
  'claude-3-sonnet',
  'claude-3-opus',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
] as const;

/** Every model the allow-list does not name rolls up to this label value. */
export const OTHER_MODEL_LABEL = 'other';

/**
 * Canonicalize a model string for the bounded {model} label: lower case, and
 * a leading KNOWN provider prefix is stripped ('openai/gpt-4o-mini' and
 * 'gpt-4o-mini' collapse onto ONE series — the same normalization the usage
 * rows already apply when they persist the model column).
 */
function canonicalModel(raw: string): string {
  const value = raw.trim().toLowerCase();
  const slash = value.indexOf('/');
  if (slash > 0 && KNOWN_PROVIDER_PREFIXES.has(value.slice(0, slash))) {
    return value.slice(slash + 1);
  }
  return value;
}

/** Parse METRICS_MODEL_ALLOWLIST; empty/absent falls back to the documented default. */
function parseModelAllowlist(raw: unknown): string[] {
  const fallback = DEFAULT_MODEL_ALLOWLIST.map(canonicalModel);
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const parsed = raw
    .split(',')
    .map(canonicalModel)
    .filter((entry) => entry.length > 0);
  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
}

/** The configured allow-list, read once at module load. */
export const MODEL_ALLOWLIST: readonly string[] = parseModelAllowlist(process.env.METRICS_MODEL_ALLOWLIST);
const MODEL_ALLOWLIST_SET: ReadonlySet<string> = new Set(MODEL_ALLOWLIST);

/** Every distinct {model} label value this process can emit. */
export const METRIC_MODEL_LABELS: readonly string[] = [...MODEL_ALLOWLIST, OTHER_MODEL_LABEL];

/** Coerce free-form model text into the bounded {model} label set. */
export function normalizeModel(raw: unknown): string {
  if (typeof raw !== 'string') return OTHER_MODEL_LABEL;
  const value = canonicalModel(raw);
  if (!value) return OTHER_MODEL_LABEL;
  return MODEL_ALLOWLIST_SET.has(value) ? value : OTHER_MODEL_LABEL;
}

// --- instruments -----------------------------------------------------------

const benchmarkRunCounter: Counter<string> = new client.Counter({
  name: 'mafia_benchmark_run_total',
  help: 'Benchmark runs that reached a terminal status, by status.',
  labelNames: ['status'],
  registers: [registry],
});

const benchmarkRunDurationHistogram: Histogram<string> = new client.Histogram({
  name: 'mafia_benchmark_run_duration_seconds',
  help: 'How long a full benchmark run takes, terminal transition minus creation.',
  buckets: [300, 900, 1800, 3600, 7200, 14400, 43200, 86400],
  registers: [registry],
});

const benchmarkRunStrandedGauge: Gauge<string> = new client.Gauge({
  name: 'mafia_benchmark_run_stranded',
  help: 'Non-terminal benchmark runs past the 7-day stale window (must be 0 on a clean stack).',
  registers: [registry],
});

const benchmarkGamesQueuedGauge: Gauge<string> = new client.Gauge({
  name: 'mafia_benchmark_games_queued',
  help: 'Games still pending inside active (QUEUED/RUNNING) benchmark runs.',
  registers: [registry],
});

const llmRequestCounter: Counter<string> = new client.Counter({
  name: 'mafia_llm_request_total',
  help: 'Upstream LLM requests, by provider, model and outcome (adapter evidence, never api_calls).',
  labelNames: ['provider', 'model', 'outcome'],
  registers: [registry],
});

const llmRequestDurationHistogram: Histogram<string> = new client.Histogram({
  name: 'mafia_llm_request_duration_seconds',
  help: 'Per-model LLM decision latency (buckets reach past the observed 65 s max).',
  labelNames: ['provider', 'model'],
  buckets: [0.25, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [registry],
});

const llmTokensCounter: Counter<string> = new client.Counter({
  name: 'mafia_llm_tokens_total',
  help: 'Tokens consumed, by provider, model and direction.',
  labelNames: ['provider', 'model', 'direction'],
  registers: [registry],
});

const llmCostCounter: Counter<string> = new client.Counter({
  name: 'mafia_llm_cost_usd_total',
  help: 'Spend in USD, summed from the same token_usage rows the adapter persists.',
  labelNames: ['provider', 'model'],
  registers: [registry],
});

const llmBudgetExhaustedCounter: Counter<string> = new client.Counter({
  name: 'mafia_llm_budget_exhausted_total',
  help: 'Games that stopped calling a seat because its budget was exhausted.',
  labelNames: ['provider'],
  registers: [registry],
});

const llmRetryCounter: Counter<string> = new client.Counter({
  name: 'mafia_llm_retry_total',
  help: 'Upstream request retries, by provider and cause.',
  labelNames: ['provider', 'reason'],
  registers: [registry],
});

/**
 * Pre-register every closed-label Tier-1 series at zero (module load).
 *
 * Same contract as the Tier-0 pre-registration above: prom-client emits no
 * sample line for a never-observed instrument, so a freshly booted process
 * must still expose all ten families. The bounded set is
 * providers (6) x models (allow-list + 'other') x outcomes (2) for requests,
 * x directions (2) for tokens, plus the label-less benchmark gauges.
 */
for (const status of BENCHMARK_RUN_STATUSES) {
  benchmarkRunCounter.inc({ status }, 0);
}
benchmarkRunDurationHistogram.zero({});
benchmarkRunStrandedGauge.set(0);
benchmarkGamesQueuedGauge.set(0);

for (const provider of GAME_PROVIDER_LABELS) {
  llmBudgetExhaustedCounter.inc({ provider }, 0);
  for (const reason of LLM_RETRY_REASONS) {
    llmRetryCounter.inc({ provider, reason }, 0);
  }
  for (const model of METRIC_MODEL_LABELS) {
    llmCostCounter.inc({ provider, model }, 0);
    llmRequestDurationHistogram.zero({ provider, model });
    for (const direction of TOKEN_DIRECTIONS) {
      llmTokensCounter.inc({ provider, model, direction }, 0);
    }
    for (const outcome of LLM_REQUEST_OUTCOMES) {
      llmRequestCounter.inc({ provider, model, outcome }, 0);
    }
  }
}

// --- recording helpers -----------------------------------------------------

/** Non-negative integer from anything countable; invalid input becomes 0. */
function countOf(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

/** Finite number from anything numeric (numbers and numeric strings); else undefined. */
function numberOf(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Record a benchmark run's TERMINAL transition (spec 3.2).
 *
 * Only COMPLETED / CANCELLED / FAILED increment; RUNNING (and any unexpected
 * value) is a no-op, never a throw. The caller owns the single-count guard —
 * one run, one terminal increment (BenchmarkRunner.recordRunTerminal).
 */
export function benchmarkRunTerminal(status: unknown, durationSeconds?: unknown): boolean {
  if (typeof status !== 'string') return false;
  if (!TERMINAL_RUN_STATUSES.includes(status as BenchmarkRunStatusLabel)) return false;
  benchmarkRunCounter.inc({ status }, 1);
  const seconds = numberOf(durationSeconds);
  if (seconds !== undefined && seconds >= 0) {
    benchmarkRunDurationHistogram.observe(seconds);
  }
  return true;
}

/** Set mafia_benchmark_run_stranded from a count; invalid input reads as 0. */
export function benchmarkRunStranded(count: unknown): void {
  benchmarkRunStrandedGauge.set(countOf(count));
}

/** Set mafia_benchmark_games_queued from a count; invalid input reads as 0. */
export function benchmarkGamesQueued(count: unknown): void {
  benchmarkGamesQueuedGauge.set(countOf(count));
}

/** Minimal slice of better-sqlite3 the gauge refresh needs (keeps this module driver-agnostic). */
export interface MetricsGaugeDatabase {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}

/** What one gauge refresh observed in the database. */
export interface BenchmarkGaugeSnapshot {
  /** Non-terminal runs older than the stale window. */
  stranded: number;
  /** Pending games inside active runs. */
  queued: number;
}

/**
 * Recompute mafia_benchmark_run_stranded and mafia_benchmark_games_queued
 * from durable DB rows (spec 3.2 / 2.4).
 *
 * stranded := QUEUED/RUNNING runs at least `staleRunMaxMs` old — exactly the
 * predicate BenchmarkRunner.reconcileStrandedRuns sweeps to FAILED, so a
 * clean stack reads 0. queued := pending games (no completed_at, no error)
 * belonging to a QUEUED/RUNNING run.
 *
 * Never throws: /metrics must answer even when the DB is wedged (spec
 * section 4), and a failed refresh leaves the last observed values in place.
 */
export function refreshBenchmarkGauges(
  db: MetricsGaugeDatabase,
  staleRunMaxMs: number,
  now: number = Date.now(),
): BenchmarkGaugeSnapshot | null {
  try {
    const window = Number.isFinite(staleRunMaxMs) && staleRunMaxMs > 0 ? staleRunMaxMs : 0;
    const strandedRow = db
      .prepare(
        `SELECT COUNT(*) AS count FROM benchmark_runs
          WHERE status IN ('QUEUED', 'RUNNING') AND created_at <= ?`,
      )
      .get(now - window) as { count?: unknown } | undefined;
    const queuedRow = db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM benchmark_games bg
           JOIN benchmark_runs br ON br.id = bg.run_id
          WHERE br.status IN ('QUEUED', 'RUNNING')
            AND bg.completed_at IS NULL AND bg.error IS NULL`,
      )
      .get() as { count?: unknown } | undefined;

    const snapshot: BenchmarkGaugeSnapshot = {
      stranded: countOf(strandedRow?.count),
      queued: countOf(queuedRow?.count),
    };
    benchmarkRunStrandedGauge.set(snapshot.stranded);
    benchmarkGamesQueuedGauge.set(snapshot.queued);
    return snapshot;
  } catch (error) {
    console.error(
      `[metrics] benchmark gauge refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** One bridge usage row (UsageAggregate / PlayerUsageAggregate from the adapter). */
export interface LlmUsageRow {
  provider?: unknown;
  model?: unknown;
  promptTokens?: unknown;
  completionTokens?: unknown;
  totalTokens?: unknown;
  cost?: unknown;
  apiCalls?: unknown;
  latencyMs?: unknown;
}

/** The adapter persists a row only when BOTH provider and model are non-empty strings. */
function isPersistableUsageRow(row: LlmUsageRow | null | undefined): row is LlmUsageRow {
  return (
    !!row &&
    typeof row.provider === 'string' &&
    row.provider.trim().length > 0 &&
    typeof row.model === 'string' &&
    row.model.trim().length > 0
  );
}

/** Record one upstream LLM request outcome (adapter evidence — never api_calls). */
export function llmRequest(provider: unknown, model: unknown, outcome: unknown, count: unknown = 1): void {
  const safeOutcome: LlmRequestOutcome = (LLM_REQUEST_OUTCOMES as readonly string[]).includes(
    outcome as string,
  )
    ? (outcome as LlmRequestOutcome)
    : 'failed';
  const requests = countOf(count);
  if (requests <= 0) return;
  llmRequestCounter.inc(
    { provider: normalizeProvider(provider), model: normalizeModel(model), outcome: safeOutcome },
    requests,
  );
}

/** Observe one per-model request latency in seconds; non-finite/negative values are dropped. */
export function llmRequestDuration(provider: unknown, model: unknown, seconds: unknown): void {
  const value = numberOf(seconds);
  if (value === undefined || value < 0) return;
  llmRequestDurationHistogram.observe(
    { provider: normalizeProvider(provider), model: normalizeModel(model) },
    value,
  );
}

/** Add prompt and/or completion tokens for one model. Negative values are dropped. */
export function llmTokens(
  provider: unknown,
  model: unknown,
  promptTokens: unknown,
  completionTokens: unknown,
): void {
  const labels = { provider: normalizeProvider(provider), model: normalizeModel(model) };
  const prompt = numberOf(promptTokens);
  const completion = numberOf(completionTokens);
  if (prompt !== undefined && prompt > 0) {
    llmTokensCounter.inc({ ...labels, direction: 'prompt' }, prompt);
  }
  if (completion !== undefined && completion > 0) {
    llmTokensCounter.inc({ ...labels, direction: 'completion' }, completion);
  }
}

/** Add USD spend for one model. Negative/non-numeric costs are dropped, never thrown. */
export function llmCost(provider: unknown, model: unknown, costUsd: unknown): void {
  const cost = numberOf(costUsd);
  if (cost === undefined || cost <= 0) return;
  llmCostCounter.inc({ provider: normalizeProvider(provider), model: normalizeModel(model) }, cost);
}

/**
 * Record the LLM evidence carried by one bridge 'done' message.
 *
 * `perModel` is the bridge's per-model usage aggregate — one row per model
 * that played, the same rows the adapter INSERTs into token_usage (:787) and
 * the collector averages for latency (legacy-usage-collector.js:256). From
 * those rows this records:
 *   - mafia_llm_request_total{outcome="completed"} by each row's apiCalls
 *     (the engine's own turn count for that model),
 *   - mafia_llm_request_duration_seconds by the row's average latency,
 *   - mafia_llm_tokens_total (prompt/completion split) and
 *     mafia_llm_cost_usd_total by the row's token and cost totals.
 *
 * `perPlayer` rows are the SAME calls re-keyed by player (the adapter writes
 * them to token_usage too, :886). They are recorded for tokens and cost only
 * — counting requests or latency from both would double-count the same call
 * — so sum(mafia_llm_cost_usd_total) matches sum(token_usage.cost) for the
 * rows this process wrote (spec 6.2 cross-check).
 */
export function recordLlmUsage(perModel: unknown, perPlayer?: unknown): void {
  const modelRows = Array.isArray(perModel) ? (perModel as LlmUsageRow[]) : [];
  for (const row of modelRows) {
    if (!isPersistableUsageRow(row)) continue;
    const calls = countOf(row.apiCalls);
    if (calls > 0) llmRequest(row.provider, row.model, 'completed', calls);
    const latencyMs = numberOf(row.latencyMs);
    if (latencyMs !== undefined && latencyMs > 0) {
      llmRequestDuration(row.provider, row.model, latencyMs / 1000);
    }
    llmTokens(row.provider, row.model, row.promptTokens, row.completionTokens);
    llmCost(row.provider, row.model, row.cost);
  }

  const playerRows = Array.isArray(perPlayer) ? (perPlayer as LlmUsageRow[]) : [];
  for (const row of playerRows) {
    if (!isPersistableUsageRow(row)) continue;
    llmTokens(row.provider, row.model, row.promptTokens, row.completionTokens);
    llmCost(row.provider, row.model, row.cost);
  }
}

/** One aggregated (provider, model) group as it comes back out of token_usage. */
export interface LlmUsageSeedGroupRow {
  provider?: unknown;
  model?: unknown;
  rows?: unknown;
  promptTokens?: unknown;
  completionTokens?: unknown;
  cost?: unknown;
}

/** One series in the CLOSED label set after raw groups have been folded in. */
export interface LlmUsageSeedSeries {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
}

/** Result of folding raw token_usage groups into the bounded label set. */
export interface LlmUsageSeedAggregate {
  /** Distinct raw (provider, model) groups read. */
  groups: number;
  /** token_usage rows behind those groups. */
  rows: number;
  /** Series in the bounded label set that received a non-zero amount. */
  series: LlmUsageSeedSeries[];
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

/**
 * Fold raw token_usage groups into the SAME closed label sets the live
 * recorders use (spec 3.2 cardinality policy).
 *
 * Pure: no counters are touched, so a test can call it repeatedly. Raw
 * cardinality is whatever the database holds — thousands of model spellings,
 * legacy '[object Object]' rows, prefixed/bare duplicates — and the OUTPUT is
 * bounded by providers x (allow-list + 'other'), because every group goes
 * through normalizeProvider/normalizeModel exactly like a live usage row does.
 *
 * Negative/non-numeric amounts are dropped rather than subtracted, matching
 * llmCost/llmTokens (a counter cannot go down).
 */
export function aggregateLlmUsageGroups(rows: unknown): LlmUsageSeedAggregate {
  const list = Array.isArray(rows) ? (rows as LlmUsageSeedGroupRow[]) : [];
  const byLabels = new Map<string, LlmUsageSeedSeries>();
  let groupCount = 0;
  let rowCount = 0;

  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    groupCount += 1;
    rowCount += countOf(row.rows);
    const provider = normalizeProvider(row.provider);
    const model = normalizeModel(row.model);
    const key = `${provider}\u0000${model}`;
    const series = byLabels.get(key) ?? {
      provider,
      model,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
    };
    const prompt = numberOf(row.promptTokens);
    const completion = numberOf(row.completionTokens);
    const cost = numberOf(row.cost);
    if (prompt !== undefined && prompt > 0) series.promptTokens += prompt;
    if (completion !== undefined && completion > 0) series.completionTokens += completion;
    if (cost !== undefined && cost > 0) series.cost += cost;
    byLabels.set(key, series);
  }

  const series = Array.from(byLabels.values()).filter(
    (s) => s.promptTokens > 0 || s.completionTokens > 0 || s.cost > 0,
  );
  return {
    groups: groupCount,
    rows: rowCount,
    series,
    promptTokens: series.reduce((sum, s) => sum + s.promptTokens, 0),
    completionTokens: series.reduce((sum, s) => sum + s.completionTokens, 0),
    costUsd: series.reduce((sum, s) => sum + s.cost, 0),
  };
}

/** Minimal slice of better-sqlite3 the boot-time seed needs (driver-agnostic). */
export interface MetricsSeedDatabase {
  prepare(sql: string): { all(...params: unknown[]): unknown };
}

/**
 * The boot-time read behind the cumulative LLM counters (exported so a test
 * can assert the shape, like IN_PROGRESS_GAMES_SQL).
 *
 * GROUP BY keeps it one pass over token_usage (a real table, ~25k rows live)
 * and returns at most one row per raw (provider, model) pair.
 */
export const LLM_USAGE_SEED_SQL = `SELECT
   provider,
   model,
   COUNT(*) AS rows,
   SUM(COALESCE(prompt_tokens, 0)) AS promptTokens,
   SUM(COALESCE(completion_tokens, 0)) AS completionTokens,
   SUM(COALESCE(cost, 0)) AS cost
 FROM token_usage
 GROUP BY provider, model`;

/** Set once the seed has run, so a second call cannot double-count. */
let llmUsageSeeded = false;

/** True once seedLlmUsageFromDatabase has applied (exported for the boot log). */
export function llmUsageSeedApplied(): boolean {
  return llmUsageSeeded;
}

/**
 * Seed the CUMULATIVE LLM counters from durable token_usage rows (spec 3.2).
 *
 * Why this exists: `mafia_llm_cost_usd_total` answers "what have we spent,
 * cumulatively, per model" and `token_usage` is the durable record of exactly
 * that. A counter that starts at zero on every process start answers
 * "what has THIS process spent", which is a different question — and it makes
 * the spec 6.2 cross-check (`sum(metric)` vs `SELECT sum(cost) FROM
 * token_usage`) unsatisfiable on any stack that has history: the live DB
 * carried $95 of spend while the freshly booted counter read 0.000.
 *
 * Contract:
 *   - Runs ONCE per process, at boot, before any game can be accepted, so the
 *     counter is (history at boot) + (rows written since) = the durable total.
 *   - Idempotent: a second call returns null and touches nothing (a double
 *     seed would silently double the spend figure).
 *   - Never throws: a wedged DB must not stop the server from booting; the
 *     counters simply keep their pre-registered zeros and the error is logged.
 *   - Only tokens and cost are seeded. Request counts, latencies, retries and
 *     budget stops are per-OBSERVATION evidence with no durable per-call row
 *     to replay (api_calls mixes per-model, per-player and per-failure rows,
 *     so counting it would double-count); they stay process-lifetime, which
 *     docs/observability-spec.md 3.2 states explicitly.
 */
export function seedLlmUsageFromDatabase(db: MetricsSeedDatabase): LlmUsageSeedAggregate | null {
  if (llmUsageSeeded) return null;
  try {
    const aggregate = aggregateLlmUsageGroups(db.prepare(LLM_USAGE_SEED_SQL).all());
    for (const series of aggregate.series) {
      const labels = { provider: series.provider, model: series.model };
      if (series.promptTokens > 0) {
        llmTokensCounter.inc({ ...labels, direction: 'prompt' }, series.promptTokens);
      }
      if (series.completionTokens > 0) {
        llmTokensCounter.inc({ ...labels, direction: 'completion' }, series.completionTokens);
      }
      if (series.cost > 0) {
        llmCostCounter.inc(labels, series.cost);
      }
    }
    llmUsageSeeded = true;
    return aggregate;
  } catch (error) {
    console.error(
      `[metrics] llm usage seed failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Record the failed-request evidence for a game whose LLM request stream died
 * with its child process (non-zero exit, bridge 'gameError', spawn failure).
 *
 * The engine's per-call attribution is gone once the child is dead — the
 * usage collector only runs on the 'done' message — so this records ONE
 * failed request per participating model. That is a documented FLOOR (never
 * an invented per-call split), and it is the honest alternative to
 * api_calls.status_code, which is hard-coded 200 at
 * legacy-game-adapter.ts:774 (spec 2.3).
 */
export function recordFailedGameRequests(models: unknown): void {
  const list = Array.isArray(models) ? (models as Array<{ provider?: unknown; model?: unknown }>) : [];
  const recorded = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const provider = normalizeProvider(entry.provider);
    const model = normalizeModel(entry.model);
    const key = `${provider}/${model}`;
    if (recorded.has(key)) continue;
    recorded.add(key);
    llmRequest(provider, model, 'failed', 1);
  }
  if (recorded.size === 0) {
    // Nothing configured (e.g. a bare game on the engine default): one
    // failed request on the closed 'unknown'/'other' series, never invented
    // model names.
    llmRequest('unknown', OTHER_MODEL_LABEL, 'failed', 1);
  }
}

/** Count one budget-exhausted game stop for a provider (game-engine.js:4891). */
export function llmBudgetExhausted(provider: unknown): void {
  llmBudgetExhaustedCounter.inc({ provider: normalizeProvider(provider) }, 1);
}

/** Count one retry for a provider and a closed-set cause (game-engine.js:5030). */
export function llmRetry(provider: unknown, reason: unknown): void {
  const safeReason: LlmRetryReason = (LLM_RETRY_REASONS as readonly string[]).includes(reason as string)
    ? (reason as LlmRetryReason)
    : 'unknown';
  llmRetryCounter.inc({ provider: normalizeProvider(provider), reason: safeReason }, 1);
}

/** A signal parsed out of one line of the legacy child's stderr. */
export type ChildLogSignal = { kind: 'budget' } | { kind: 'retry'; reason: LlmRetryReason };

const BUDGET_LOG_SIGNATURE = /\[COST\] Budget limit reached/i;

/**
 * The engine retries (and budget-stops) only into its own stderr — the
 * bridge forces structured logging off so stdout stays a clean JSON event
 * stream (legacy-bridge.js:42-43). These signatures are the exact messages
 * game-engine.js emits at :4891 and :5030/:5138/:5183.
 */
const RETRY_LOG_SIGNATURES: ReadonlyArray<{ pattern: RegExp; reason: LlmRetryReason }> = [
  { pattern: /rejected response_format.*retrying/i, reason: 'response_format' },
  { pattern: /JSON parse failed for .*retrying/i, reason: 'parse_error' },
  { pattern: /Network error for .*retrying/i, reason: 'network_error' },
];

/** Classify one child stderr line into a closed-set signal (null for everything else). */
export function classifyChildLogLine(line: unknown): ChildLogSignal | null {
  if (typeof line !== 'string' || !line) return null;
  if (BUDGET_LOG_SIGNATURE.test(line)) return { kind: 'budget' };
  for (const signature of RETRY_LOG_SIGNATURES) {
    if (signature.pattern.test(line)) return { kind: 'retry', reason: signature.reason };
  }
  return null;
}

/** Longest partial line kept per game; a runaway line never grows unbounded. */
const MAX_PARTIAL_LINE_CHARS = 8192;

/**
 * Line-buffered reader for the bridge child's stderr.
 *
 * stderr arrives in arbitrary chunks, so a signature can straddle two 'data'
 * events; the buffer keeps the trailing partial line per game and classifies
 * only complete ones. forget(gameId) is called at the terminal transition so
 * a long-lived server does not retain per-game buffers.
 */
export class ChildLogObserver {
  private readonly buffers = new Map<string, string>();

  push(gameId: string, chunk: unknown): ChildLogSignal[] {
    if (typeof gameId !== 'string' || !gameId || typeof chunk !== 'string' || !chunk) return [];
    const pending = (this.buffers.get(gameId) ?? '') + chunk;
    const lines = pending.split('\n');
    const tail = lines.pop() ?? '';
    this.buffers.set(
      gameId,
      tail.length > MAX_PARTIAL_LINE_CHARS ? tail.slice(-MAX_PARTIAL_LINE_CHARS) : tail,
    );
    const signals: ChildLogSignal[] = [];
    for (const line of lines) {
      const signal = classifyChildLogLine(line);
      if (signal) signals.push(signal);
    }
    return signals;
  }

  forget(gameId: string): void {
    this.buffers.delete(gameId);
  }
}

// ===========================================================================
// OBS-003 — Tier 2: storage, HTTP and orphan liveness (spec section 3.3)
// ===========================================================================

/**
 * The six — and only six — tables mafia_storage_rows may ever label.
 *
 * The allow-list is closed at the module, and the label value is interpolated
 * from THIS array (never from a caller or a request): an unknown table can
 * neither create a series nor reach the SQL. A missing table on a legacy
 * schema keeps its last-good value instead of throwing.
 */
export const STORAGE_TABLES = [
  'games',
  'players',
  'events',
  'api_calls',
  'token_usage',
  'benchmark_runs',
] as const;
export type StorageTable = (typeof STORAGE_TABLES)[number];

/**
 * How often the storage snapshot is recomputed. Counting `events` (~200k rows
 * on the live DB) is a real table scan, so it happens on THIS interval ONLY —
 * never on scrape and never on a request path. 30 s matches the benchmark
 * gauge refresh the server already runs.
 */
export const STORAGE_GAUGE_REFRESH_MS = 30_000;

/*
 * mafia_game_in_progress has no staleness window of its own (OBS-006).
 *
 * OBS-003 gave the gauge a 5 minute `ORPHAN_GAME_STALE_MS` window that outranked
 * the live-owner set: a game whose bridge child had just been killed still read
 * as "owned" while its last event was fresh, so the alarm under-reported exactly
 * the failure it exists for. The orphan verdict now comes from
 * `classifyGameLiveness` (services/game-liveness.ts) — owner first, activity
 * recency never wins — which is the SAME predicate GameLifecycleReconciler
 * applies to decide what it may retire. The single written definition lives in
 * docs/observability-spec.md §3.3.
 */

/** Closed {check} set for mafia_healthcheck_failed_total (spec 3.3). */
export const HEALTHCHECK_NAMES = ['db_write', 'legacy_adapter', 'spawn_capacity'] as const;
export type HealthcheckName = (typeof HEALTHCHECK_NAMES)[number];
const HEALTHCHECK_NAME_SET: ReadonlySet<string> = new Set(HEALTHCHECK_NAMES);

/**
 * Closed {method} set for the HTTP families. Anything else (a custom verb, a
 * lowercase spelling) collapses to HTTP_METHOD_OTHER rather than minting a
 * series per spelling.
 */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethodLabel = (typeof HTTP_METHODS)[number];
export const HTTP_METHOD_OTHER = 'OTHER';
const HTTP_METHOD_SET: ReadonlySet<string> = new Set(HTTP_METHODS);
const HTTP_METHOD_LABELS: readonly string[] = [...HTTP_METHODS, HTTP_METHOD_OTHER];

/** Closed {status_class} set (spec 3.3). */
export const HTTP_STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx'] as const;
export type HttpStatusClass = (typeof HTTP_STATUS_CLASSES)[number];

/** Requests that matched no route collapse onto this single series. */
export const UNMATCHED_ROUTE_LABEL = 'unmatched';
/** Overflow bucket: a new route pattern past the pair cap lands here. */
export const OTHER_ROUTE_LABEL = 'other';

/**
 * Hard cap on distinct (route, method) pairs the HTTP families may create.
 *
 * This is what makes the label set BOUNDED rather than "bounded in practice":
 * the route label is the Express pattern (never the concrete path), so the
 * only unbounded axis left is "how many routes does this app have". Past the
 * cap, a new pair is recorded under route="other", which costs at most one
 * series per method. Arithmetic (see the OBS-003 commit message):
 *   40 tracked pairs + 1 overflow pair per method (8) = 48 pairs
 *   counter:   48 x 4 status classes          = 192 series
 *   histogram: 48 (one instrument per pair)   =  48 series
 *   storage: 1 + 6, orphan: 1, healthcheck: 3 =  11 series
 *                                           total 251 < 300
 */
export const MAX_HTTP_ROUTE_METHOD_PAIRS = 40;

const storageBytesGauge: Gauge<string> = new client.Gauge({
  name: 'mafia_storage_bytes',
  help: 'Bytes of the SQLite file this server is actually using.',
  registers: [registry],
});

const storageRowsGauge: Gauge<string> = new client.Gauge({
  name: 'mafia_storage_rows',
  help: 'Rows per allow-listed table, so growth is attributable.',
  labelNames: ['table'],
  registers: [registry],
});

const httpRequestsCounter: Counter<string> = new client.Counter({
  name: 'mafia_http_requests_total',
  help: 'Requests by matched route pattern, method and status class.',
  labelNames: ['route', 'method', 'status_class'],
  registers: [registry],
});

const httpDurationHistogram: Histogram<string> = new client.Histogram({
  name: 'mafia_http_request_duration_seconds',
  help: 'Request latency by matched route pattern and method.',
  labelNames: ['route', 'method'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

const gameInProgressGauge: Gauge<string> = new client.Gauge({
  name: 'mafia_game_in_progress',
  help: 'IN_PROGRESS game rows with no live owner (orphans; must stay 0).',
  registers: [registry],
});

const healthcheckFailedCounter: Counter<string> = new client.Counter({
  name: 'mafia_healthcheck_failed_total',
  help: 'Real failure sites that /health does not report, by check.',
  labelNames: ['check'],
  registers: [registry],
});

/**
 * Pre-register every closed OBS-003 series at zero (module load), so a fresh
 * process is scrapable before the first request and before the first storage
 * refresh. The HTTP families pre-register their one truly closed label value,
 * `route="unmatched"`: the routed values are the app's own static route
 * table (bounded by MAX_HTTP_ROUTE_METHOD_PAIRS), not request data.
 */
storageBytesGauge.set(0);
for (const table of STORAGE_TABLES) {
  storageRowsGauge.set({ table }, 0);
}
gameInProgressGauge.set(0);
for (const check of HEALTHCHECK_NAMES) {
  healthcheckFailedCounter.inc({ check }, 0);
}
for (const method of HTTP_METHOD_LABELS) {
  httpDurationHistogram.zero({ route: UNMATCHED_ROUTE_LABEL, method });
  for (const statusClass of HTTP_STATUS_CLASSES) {
    httpRequestsCounter.inc(
      { route: UNMATCHED_ROUTE_LABEL, method, status_class: statusClass },
      0,
    );
  }
}

/** Count one failure at a real site that /health does not reflect. Unknown checks are dropped. */
export function healthcheckFailed(check: HealthcheckName): void {
  if (!HEALTHCHECK_NAME_SET.has(check)) return;
  healthcheckFailedCounter.inc({ check }, 1);
}

/** Coerce an HTTP method into the closed {method} set. */
export function normalizeHttpMethod(method: unknown): string {
  if (typeof method !== 'string') return HTTP_METHOD_OTHER;
  const upper = method.trim().toUpperCase();
  return HTTP_METHOD_SET.has(upper) ? upper : HTTP_METHOD_OTHER;
}

/**
 * Map a real terminal status code onto the closed {status_class} set.
 *
 * res.statusCode at 'finish' is always a final 2xx-5xx code; the fallback
 * (a 1xx/0/NaN that should be impossible) counts as 5xx so an anomalous
 * terminal status raises an alert instead of hiding in 2xx.
 */
export function statusClassOf(statusCode: unknown): HttpStatusClass {
  const code = typeof statusCode === 'number' ? statusCode : Number(statusCode);
  if (!Number.isFinite(code)) return '5xx';
  if (code >= 500) return '5xx';
  if (code >= 400) return '4xx';
  if (code >= 300) return '3xx';
  if (code >= 200) return '2xx';
  return '5xx';
}

/** The slice of an Express request the route label needs (kept structural for tests). */
export interface HttpRouteCarrier {
  baseUrl?: unknown;
  path?: unknown;
  route?: { path?: unknown } | undefined;
}

/**
 * Resolve the {route} label from the MATCHED Express route.
 *
 * Express populates `req.route` only when a route pattern matched, and its
 * `path` is the pattern as declared (`/api/v1/games/:gameId`) — never the
 * concrete URL. The mount prefix lives on `req.baseUrl`. Anything that cannot
 * be resolved (the 404 catch-all, an auth rejection before routing, a RegExp
 * route) becomes the single `unmatched` series, so a game id can never become
 * a label.
 */
export function routeLabelFor(req: HttpRouteCarrier): string {
  const declared = req?.route?.path;
  const path = Array.isArray(declared) ? declared[0] : declared;
  if (typeof path !== 'string' || !path) return UNMATCHED_ROUTE_LABEL;
  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  const pattern = `${prefix}${path.startsWith('/') ? path : `/${path}`}`;
  return pattern.startsWith('/') ? pattern : `/${pattern}`;
}

/** (route, method) pairs already minted, for the MAX_HTTP_ROUTE_METHOD_PAIRS bound. */
const instrumentedHttpPairs = new Set<string>();

/** Bound a route+method pair, collapsing overflow onto route="other". */
function boundedRouteLabel(route: string, method: string): string {
  const key = `${route}\u0000${method}`;
  if (instrumentedHttpPairs.has(key)) return route;
  if (instrumentedHttpPairs.size >= MAX_HTTP_ROUTE_METHOD_PAIRS) return OTHER_ROUTE_LABEL;
  instrumentedHttpPairs.add(key);
  return route;
}

/**
 * Record one finished HTTP request. Never throws: instrumentation must not be
 * able to fail a request that already succeeded.
 */
export function recordHttpRequest(
  route: unknown,
  method: unknown,
  statusCode: unknown,
  durationSeconds: unknown,
): void {
  try {
    const safeRoute = typeof route === 'string' && route ? route : UNMATCHED_ROUTE_LABEL;
    const safeMethod = normalizeHttpMethod(method);
    const labels = { route: boundedRouteLabel(safeRoute, safeMethod), method: safeMethod };
    httpRequestsCounter.inc({ ...labels, status_class: statusClassOf(statusCode) }, 1);
    const seconds = numberOf(durationSeconds);
    if (seconds !== undefined && seconds >= 0) httpDurationHistogram.observe(labels, seconds);
  } catch (error) {
    console.error(
      `[metrics] http recording failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** True for the scrape endpoint itself, which must never be instrumented. */
export function isMetricsPath(path: unknown): boolean {
  if (typeof path !== 'string') return false;
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return normalized === '/metrics';
}

/**
 * Express middleware behind the two HTTP families (spec 3.3).
 *
 * Mounted AFTER the /metrics route (so the scrape is never counted) and after
 * auth (an auth rejection is not an endpoint error), BEFORE the routers so
 * `req.route` is populated by the time 'finish' fires. `status_class` comes
 * from the real `res.statusCode` at finish — the response status, not the
 * handler's intent.
 */
export function httpMetricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      if (isMetricsPath(req.path)) return;
      recordHttpRequest(
        routeLabelFor(req),
        req.method,
        res.statusCode,
        Number(process.hrtime.bigint() - startedAt) / 1e9,
      );
    });
    next();
  };
}

/** The slice of better-sqlite3 the storage/OBS-003 gauges need. */
export interface MetricsStorageDatabase {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown;
  };
}

/** One IN_PROGRESS row plus the evidence the orphan rule reads (no events join). */
interface InProgressGameRow {
  id?: unknown;
  created_at?: unknown;
  started_at?: unknown;
  player_count?: unknown;
}

/** What one storage refresh observed. */
export interface StorageGaugeSnapshot {
  /** Size in bytes of the SQLite file the server resolved (last good value on error). */
  bytes: number;
  /** Row count per allow-listed table. */
  rows: Record<StorageTable, number>;
  /** IN_PROGRESS rows with no live owner (see classifyGameLiveness). */
  inProgressOrphans: number;
}

export interface StorageGaugesOptions {
  db: MetricsStorageDatabase;
  /** The DB file the server resolved (same DB_PATH resolution); enables the exact stat. */
  dbPath?: string;
  /** Injectable clock for tests. */
  now?: number;
  /** Override the registration grace (defaults to GAME_REGISTRATION_GRACE_MS). */
  registrationGraceMs?: number;
  /** The process's live-owner set — the SAME callback GameLifecycleReconciler uses. */
  liveGameIds?: () => ReadonlySet<string>;
}

/** Last good values, retained when a refresh fails (a wedged DB must not zero the gauges). */
const lastStorageRows = new Map<StorageTable, number>();
let lastOrphanCount = 0;
let lastKnownBytes = 0;

/**
 * Measure the SQLite file size.
 *
 * Preferred: statSync of the resolved DB path — byte-identical to
 * `stat -c %s`, which is what the acceptance command compares against (a WAL
 * file is not part of that number, so it is not added here either).
 * Fallback (no path, or the file is not created yet): page_count * page_size
 * from the live connection.
 */
function measureStorageBytes(db: MetricsStorageDatabase, dbPath?: string): number | null {
  if (typeof dbPath === 'string' && dbPath && dbPath !== ':memory:') {
    try {
      const stat = fs.statSync(dbPath);
      if (stat.isFile()) return stat.size;
    } catch {
      // File not created yet / path unreadable: fall back to the pragmas.
    }
  }
  try {
    const pageCount = numberOf(
      (db.prepare('PRAGMA page_count').get() as { page_count?: unknown } | undefined)?.page_count,
    );
    const pageSize = numberOf(
      (db.prepare('PRAGMA page_size').get() as { page_size?: unknown } | undefined)?.page_size,
    );
    if (pageCount !== undefined && pageSize !== undefined) return pageCount * pageSize;
  } catch {
    // Fall through: no measurement is better than an invented one.
  }
  return null;
}

/** True for a finite number (the timestamp shape the orphan rule needs). */
function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The maintenance query behind mafia_game_in_progress (exported so a test can
 * assert its query plan).
 *
 * OBS-006: no `LEFT JOIN events`, no GROUP BY, no per-game events subquery. It
 * is one index seek on `idx_games_status` plus one covered player count per
 * IN_PROGRESS row (`idx_players_game`) — nothing proportional to the size of
 * `events`, which is the table that actually grows.
 */
export const IN_PROGRESS_GAMES_SQL = `SELECT
   g.id,
   g.created_at,
   g.started_at,
   (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id) AS player_count
 FROM games g
 WHERE g.status = 'IN_PROGRESS'`;

/**
 * Count IN_PROGRESS games with no live owner (see classifyGameLiveness).
 *
 * The predicate is shared with GameLifecycleReconciler, so the alarm and the
 * retirement seam cannot disagree: owned ⇒ live, never-started ghost ⇒ counted
 * immediately, otherwise a row is an orphan the moment the registration grace
 * (seconds) elapses — activity recency does not buy it an exception.
 */
function countOrphanedGames(db: MetricsStorageDatabase, options: StorageGaugesOptions): number {
  const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
  let live: ReadonlySet<string> = new Set<string>();
  try {
    live = options.liveGameIds ? options.liveGameIds() : new Set<string>();
  } catch {
    // A dying registry is not evidence of an orphan; treat as "no owner info"
    // by keeping the empty set (the classification rule still applies).
  }

  const rows = db.prepare(IN_PROGRESS_GAMES_SQL).all() as InProgressGameRow[];

  let orphans = 0;
  for (const raw of Array.isArray(rows) ? rows : []) {
    const row: GameLivenessRow = {
      id: String(raw.id),
      createdAt: isTimestamp(raw.created_at) ? raw.created_at : null,
      startedAt: isTimestamp(raw.started_at) ? raw.started_at : null,
      playerCount: countOf(raw.player_count),
    };
    const verdict = classifyGameLiveness(row, {
      liveGameIds: live,
      now,
      registrationGraceMs: options.registrationGraceMs,
    });
    if (isOrphanVerdict(verdict)) orphans += 1;
  }
  return orphans;
}

/**
 * Refresh mafia_storage_bytes / mafia_storage_rows / mafia_game_in_progress
 * (spec 3.3). Called by the server on STORAGE_GAUGE_REFRESH_MS and at boot —
 * never per scrape, because the row counts are real table scans.
 *
 * Never throws (spec section 4: /metrics must answer even when the DB is
 * wedged) and retains last-good values per series on failure, so a transient
 * DB error cannot make the gauges lie in the other direction either.
 *
 * OBS-006: the orphan count costs one seek on idx_games_status plus a covered
 * player count per IN_PROGRESS row (idx_players_game). It does NOT join,
 * GROUP BY or aggregate `events` — that table grows without bound and the
 * refresh runs every STORAGE_GAUGE_REFRESH_MS.
 */
export function refreshStorageGauges(options: StorageGaugesOptions): StorageGaugeSnapshot | null {
  try {
    const { db } = options;
    const bytes = measureStorageBytes(db, options.dbPath);
    if (bytes !== null) lastKnownBytes = bytes;
    storageBytesGauge.set(lastKnownBytes);

    const rows = {} as Record<StorageTable, number>;
    for (const table of STORAGE_TABLES) {
      try {
        // `table` comes from STORAGE_TABLES (a module constant), never from input.
        const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
          | { count?: unknown }
          | undefined;
        lastStorageRows.set(table, countOf(row?.count));
      } catch {
        // Missing table / locked DB: keep the last good value for this table.
      }
      const value = lastStorageRows.get(table) ?? 0;
      rows[table] = value;
      storageRowsGauge.set({ table }, value);
    }

    try {
      lastOrphanCount = countOrphanedGames(db, options);
    } catch {
      // Keep the last good orphan count rather than reporting a fake 0.
    }
    gameInProgressGauge.set(lastOrphanCount);

    return { bytes: lastKnownBytes, rows, inProgressOrphans: lastOrphanCount };
  } catch (error) {
    console.error(
      `[metrics] storage gauge refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

