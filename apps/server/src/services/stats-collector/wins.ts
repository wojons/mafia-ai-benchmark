/**
 * Win/loss aggregation methods for StatsCollector.
 *
 * Extracted from the monolithic stats-collector.ts to reduce file size.
 */

import type { GameRepository } from '../../db/repository.js';

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
 * Falls back to the games table when event-derived data is unavailable.
 */
export function getAggregatedWins(
  gameRepository: GameRepository,
): { mafiaWins: number; townWins: number } {
  try {
    let mafiaWins = 0;
    let townWins = 0;

    const games = gameRepository.listGames({ limit: 1000, offset: 0 });
    for (const g of games) {
      if (g.status !== 'ENDED') continue;
      const winner = getGameWinnerFromEvents(gameRepository, g.id);
      if (winner === 'MAFIA') mafiaWins++;
      else if (winner === 'TOWN') townWins++;
    }

    if (mafiaWins === 0 && townWins === 0) {
      const dbStats = gameRepository.getGameStats();
      return { mafiaWins: dbStats.mafiaWins, townWins: dbStats.townWins };
    }

    return { mafiaWins, townWins };
  } catch {
    const dbStats = gameRepository.getGameStats();
    return { mafiaWins: dbStats.mafiaWins, townWins: dbStats.townWins };
  }
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
