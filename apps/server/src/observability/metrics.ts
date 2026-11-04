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

import client, { type Counter, type Gauge, type Histogram, type Registry } from 'prom-client';

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

