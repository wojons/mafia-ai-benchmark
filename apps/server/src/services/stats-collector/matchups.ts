/**
 * Matchup analysis methods for StatsCollector.
 *
 * Extracted from the monolithic stats-collector.ts to reduce file size.
 */

import type { GameRepository } from '../../db/repository.js';
import {
  deriveMatchupsFromBenchmarkGames,
  type MatchupRow,
} from './derived-matchups.js';

/**
 * Get head-to-head matchups.
 *
 * DF-MAFIA-AI-BENCHMARK-40: nothing in the tree ever INSERTs into
 * model_matchups, so this read used to return [] on every live store even
 * though benchmark_games persists real pairings. When the persisted table
 * carries no row for a pairing benchmark_games DOES describe, the row is
 * DERIVED from benchmark_games (see derived-matchups.ts for the winner
 * semantics — they mirror benchmark-runner.ts getRunReport()).
 *
 * NO DOUBLE COUNTING — persisted-precedence: if model_matchups holds a row
 * for a pairing, the persisted row is authoritative (kept verbatim,
 * ranked by its own games_played) and the derived row for that same
 * pairing key is dropped. Only pairings absent from the table fall
 * through to derivation. A pairing present in BOTH sources is therefore
 * counted exactly once.
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

  const persisted: MatchupRow[] = rows.map((row) => ({
    modelA: `${row.model_a_provider}/${row.model_a}`,
    modelB: `${row.model_b_provider}/${row.model_b}`,
    gamesPlayed: row.games_played as number,
    modelAWins: row.model_a_wins as number,
    modelBWins: row.model_b_wins as number,
    ties: row.ties as number,
  }));

  // The persisted LIMIT 20 slice defines which pairings the table claims;
  // derivation only fills pairings OUTSIDE that persisted set.
  const persistedKeys = new Set(
    persisted.map((r) => persistedPairingKey(r.modelA, r.modelB)),
  );
  const derived = deriveMatchupsFromBenchmarkGames(gameRepository).filter(
    (r) => !persistedKeys.has(persistedPairingKey(r.modelA, r.modelB)),
  );

  return [...persisted, ...derived]
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
    .slice(0, 20);
}

/** Case-insensitive canonical pairing key for the dedup check. */
function persistedPairingKey(modelA: string, modelB: string): string {
  return `${modelA.toLowerCase()}|${modelB.toLowerCase()}`;
}