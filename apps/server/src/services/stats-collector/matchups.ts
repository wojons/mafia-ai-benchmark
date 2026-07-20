/**
 * Matchup analysis methods for StatsCollector.
 *
 * Extracted from the monolithic stats-collector.ts to reduce file size.
 */

import type { GameRepository } from '../../db/repository.js';

/**
 * Get head-to-head matchups
 */
export function getMatchups(
  gameRepository: GameRepository,
): Array<{
  modelA: string;
  modelB: string;
  gamesPlayed: number;
  modelAWins: number;
  modelBWins: number;
  ties: number;
}> {
  const rows = gameRepository
    .getDatabase()
    .prepare(
      `SELECT * FROM model_matchups ORDER BY games_played DESC LIMIT 20`,
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    modelA: `${row.model_a_provider}/${row.model_a}`,
    modelB: `${row.model_b_provider}/${row.model_b}`,
    gamesPlayed: row.games_played as number,
    modelAWins: row.model_a_wins as number,
    modelBWins: row.model_b_wins as number,
    ties: row.ties as number,
  }));
}
