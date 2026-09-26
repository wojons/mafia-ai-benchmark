/**
 * Mock-game classification helpers (DF-MAFIA-AI-BENCHMARK-12).
 *
 * A mock game is one where EVERY provider call fell back to the engine's
 * canned-mock responses (game-engine.js getMockResponse — e.g. an invalid
 * or placeholder API key). Unlike degenerate games (DF-18, zero non-empty
 * SAYS), mock games carry real-looking SAYS/VOTE/ACTION events — the mock
 * phrases pass the say-quality gate — so the event signature cannot catch
 * them. The honest signal is the usage data the bridge reports at done:
 * zero real tokens across the whole game. The legacy adapter flags that at
 * write time (games.config.$.mock = 1).
 *
 * The canonical predicate lives in ONE place: the SQL expression
 * GameRepository.MOCK_GAME_SQL (db/repository.ts). Every aggregate that
 * excludes mock games (repository getGameStats, model comparison, report)
 * uses that same expression so the surfaces cannot drift. This module only
 * adapts it to the JS side (id sets / counts), mirroring degenerate.ts.
 */

import type { GameRepository } from '../../db/repository.js';
import { GameRepository as GameRepositoryClass } from '../../db/repository.js';

/**
 * Ids of ENDED games classified as mock by the shared predicate.
 * Empty when nothing is mock — never fabricated.
 */
export function getMockGameIds(gameRepository: GameRepository): string[] {
  try {
    const db = gameRepository.getDatabase();
    const rows = db.prepare(
      `SELECT g.id FROM games g
       WHERE g.status = 'ENDED'
         AND COALESCE((${GameRepositoryClass.MOCK_GAME_SQL}), 0) = 1`,
    ).all() as Array<{ id: string }>;
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * Count of mock games — same predicate, COUNT over games.
 */
export function getMockGameCounts(gameRepository: GameRepository): number {
  try {
    const db = gameRepository.getDatabase();
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM games g
       WHERE g.status = 'ENDED'
         AND COALESCE((${GameRepositoryClass.MOCK_GAME_SQL}), 0) = 1`,
    ).get() as { count: number };
    return row.count;
  } catch {
    return 0;
  }
}