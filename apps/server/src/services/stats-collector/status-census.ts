/**
 * DF-MAFIA-AI-BENCHMARK-41 — status census for the dashboard breakdown.
 *
 * `/api/v1/dashboard` used to serve `statusBreakdown` as
 * `{ ENDED: completedGames, IN_PROGRESS: activeGames, CANCELLED: 0 }`: the
 * CANCELLED arm was a hardcoded literal and the other two were re-used
 * aggregates, so the breakdown summed to 4403 against its own `totals.total`
 * 5092 and lied about how many games were actually cancelled (the live store
 * held 206 CANCELLED rows at the time).
 *
 * A `statusBreakdown` is a breakdown BY STATUS, so every key is now counted
 * from `games.status` in one GROUP BY pass: the same rows `totals.total`
 * counts, each game in exactly one bucket. `ENDED` is therefore the literal
 * ENDED census (which includes the mock/degenerate rows the benchmark
 * population excludes — those stay visible in `/api/v1/stats` via
 * `mockGames`/`degenerateGames`, and `totals.completed` keeps its
 * benchmark-population meaning).
 *
 * Statuses the fixed dashboard shape cannot name (SETUP, PAUSED, anything
 * unexpected) are deliberately NOT folded into one of the three buckets —
 * folding them would misreport a game as ended or cancelled. Such a row is
 * counted in `totals.total` only, so the three buckets sum to `total` exactly
 * when no game holds one of those transient statuses (the live store holds
 * none).
 */

import type { GameRepository } from '../../db/repository.js';

/** The three statuses the dashboard response names, in their wire spelling. */
export interface StatusCensus {
  ENDED: number;
  IN_PROGRESS: number;
  CANCELLED: number;
}

/**
 * Count `games` rows per status (one GROUP BY, whole store, no row cap).
 *
 * Read it AFTER `StatsCollector.getGameStats()` when a lifecycle reconciler
 * is wired: that call demotes stale IN_PROGRESS rows to CANCELLED first, so
 * the census describes the same population every other dashboard field does.
 */
export function getStatusCensus(gameRepository: GameRepository): StatusCensus {
  const rows = gameRepository
    .getDatabase()
    .prepare('SELECT status AS status, COUNT(*) AS count FROM games GROUP BY status')
    .all() as Array<{ status: string; count: number }>;

  const census: StatusCensus = { ENDED: 0, IN_PROGRESS: 0, CANCELLED: 0 };
  for (const row of rows) {
    if (row.status === 'ENDED') census.ENDED = row.count;
    else if (row.status === 'IN_PROGRESS') census.IN_PROGRESS = row.count;
    else if (row.status === 'CANCELLED') census.CANCELLED = row.count;
  }
  return census;
}
