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
