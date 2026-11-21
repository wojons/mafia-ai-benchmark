/**
 * Win/loss aggregation methods for StatsCollector.
 *
 * Extracted from the monolithic stats-collector.ts to reduce file size.
 */

import type { GameRepository } from '../../db/repository.js';
import { GameRepository as GameRepositoryClass } from '../../db/repository.js';

/**
 * Win totals over the completed benchmark population.
 *
 * `mafiaWins + townWins` counts only games that carry a decided side, so on a
 * database where every included completed game is decided the two sides
 * reconcile exactly with `StatsCollector.getGameStats().completedGames`.
 */
export interface AggregatedWins {
  mafiaWins: number;
  townWins: number;
}

/**
 * Derive winner from game events for legacy games that store
 * the winner in a GAME_OVER-phase event (typically GAME_STARTED type with phase GAME_OVER).
 */
export function getGameWinnerFromEvents(
  gameRepository: GameRepository,
  gameId: string,
): 'MAFIA' | 'TOWN' | null {
  try {
    const events = gameRepository.getEvents(gameId);
    const gameOverEvent = events.find(
      (e) => e.metadata.phase === 'GAME_OVER' && (e.data as Record<string, unknown>)?.winner,
    );
    if (gameOverEvent?.data) {
      const winner = (gameOverEvent.data as Record<string, unknown>).winner;
      if (winner === 'MAFIA' || winner === 'TOWN') return winner;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Dashboard win totals from ONE population, computed in SQL
 * (DF-MAFIA-AI-BENCHMARK-41).
 *
 * The dashboard used to mix a population PER SIDE: it took `/api/v1/dashboard`'s
 * wins from this function's event walk over the newest `listGames({ limit:
 * 1000 })` window and fell back to the raw game-stats aggregate per side, so
 * `wins.mafia + wins.town` could not reconcile with the completed count the
 * SAME response served (live: 88 + 916 = 1004 wins beside completed 4402,
 * town under-reported by 3398 because the window — and the event stream —
 * never covered the whole store).
 *
 * Both sides now come from ONE statement over ONE population: every `games`
 * row with `status = 'ENDED'` that is neither mock nor degenerate — the same
 * WHERE family `StatsCollector.getGameStats()` uses for `completedGames`. The
 * winner per game is the `games.winner` column, with the legacy GAME_OVER
 * event as the PER-GAME fallback, so a database whose column is incomplete
 * (MAF-GAP-060) still resolves each game the same way `getWinnerEventCounts`
 * does — column-first, one outcome per game, never a second population.
 *
 * No row cap, no per-game event loading, and the CASE arms count only the two
 * real sides: a row whose winner is undecidable is not attributed to either
 * side (it stays visible in the status census, never inside a win count).
 */
export function getAggregatedWins(
  gameRepository: GameRepository,
): AggregatedWins {
  const db = gameRepository.getDatabase();
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN w.winner = 'MAFIA' THEN 1 ELSE 0 END), 0) AS mafia_wins,
         COALESCE(SUM(CASE WHEN w.winner = 'TOWN' THEN 1 ELSE 0 END), 0) AS town_wins
       FROM (
         SELECT COALESCE(
           g.winner,
           (
             SELECT json_extract(e.data, '$.winner')
             FROM events e
             WHERE e.game_id = g.id
               AND e.phase = 'GAME_OVER'
               AND json_extract(e.data, '$.winner') IN ('MAFIA', 'TOWN')
             ORDER BY e.sequence
             LIMIT 1
           )
         ) AS winner
         FROM games g
         WHERE g.status = 'ENDED'
           AND COALESCE((${GameRepositoryClass.DEGENERATE_GAME_SQL}), 0) = 0
           AND COALESCE((${GameRepositoryClass.MOCK_GAME_SQL}), 0) = 0
       ) w`,
    )
    .get() as { mafia_wins: number; town_wins: number };

  return { mafiaWins: row.mafia_wins, townWins: row.town_wins };
}

/**
 * Compute game duration from first and last event timestamps.
 */
export function computeDurationFromEvents(
  events: Array<{ timestamp: Date }>,
): number | null {
  if (events.length < 2) return null;
  const first = events[0].timestamp.getTime();
  const last = events[events.length - 1].timestamp.getTime();
  return last - first;
}
