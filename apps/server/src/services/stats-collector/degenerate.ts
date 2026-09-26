/**
 * Degenerate-game classification helpers (DF-MAFIA-AI-BENCHMARK-18).
 *
 * A degenerate game is one where the LLM never actually played: the legacy
 * engine's canned-mock fallback (game-engine.js ~714, MAF-GAP-042 salvage
 * path) substitutes mock responses when the LLM output fails to parse, and
 * the say-quality gate suppresses repeat/canned broadcasts — the resulting
 * event stream has ZERO non-empty player SAYS and the whole game completes
 * in seconds. Those games previously flowed into mafiaWins/townWins and
 * per-model win rates unmarked, corrupting the benchmark.
 *
 * Detection predicate (documented threshold, DF-18):
 *   - the game is ENDED, AND
 *   - (games.config.$.degenerate == 1  ← write-time flag from the legacy
 *     adapter, OR) zero AGENT_SAYS_BROADCASTED events carry a non-empty
 *     says/statement/message across the WHOLE game (min 3 broadcast events
 *     so a game with no dialogue events at all — e.g. usage-only legacy
 *     rows — is NOT flagged on missing data), AND duration < 120 s.
 *
 * The 120 s duration gate: real multiplayer LLM games take minutes (the
 * live-verified degenerate evidence game completed in 81 s; healthy games
 * in the same fleet run 3-10 min). Games longer than that with all-empty
 * SAYS are a different failure class (broadcast plumbing, e.g. the sampled
 * 04fb5d4d rendering bug) and keep their wins — flagging them is DF-12's
 * scope, not this row's.
 *
 * The canonical predicate lives in ONE place: the SQL expression
 * GameRepository.DEGENERATE_GAME_SQL (db/repository.ts). Every aggregate
 * that excludes degenerate games (repository getGameStats, model
 * comparison, report) uses that same expression so the surfaces cannot
 * drift. This module only adapts it to the JS side (id sets / counts).
 */

import type { GameRepository } from '../../db/repository.js';
import { GameRepository as GameRepositoryClass } from '../../db/repository.js';

/**
 * Ids of ENDED games classified as degenerate by the shared predicate.
 * Read-time fallback: works for historical games that were never flagged
 * at write time (the event signature is recomputed from the events table).
 * Empty when nothing is degenerate — never fabricated.
 */
export function getDegenerateGameIds(gameRepository: GameRepository): string[] {
  try {
    const db = gameRepository.getDatabase();
    const rows = db.prepare(
      `SELECT g.id FROM games g
       WHERE g.status = 'ENDED'
         AND COALESCE((${GameRepositoryClass.DEGENERATE_GAME_SQL}), 0) = 1`,
    ).all() as Array<{ id: string }>;
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * Count of degenerate games — same predicate, COUNT over games.
 */
export function getDegenerateGameCounts(gameRepository: GameRepository): number {
  try {
    const db = gameRepository.getDatabase();
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM games g
       WHERE g.status = 'ENDED'
         AND COALESCE((${GameRepositoryClass.DEGENERATE_GAME_SQL}), 0) = 1`,
    ).get() as { count: number };
    return row.count;
  } catch {
    return 0;
  }
}