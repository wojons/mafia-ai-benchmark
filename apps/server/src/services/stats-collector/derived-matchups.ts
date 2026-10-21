/**
 * DF-MAFIA-AI-BENCHMARK-40 — head-to-head matchups derived from benchmark_games.
 *
 * Nothing in the tree ever INSERTs into model_matchups (grep is reads-only:
 * matchups.ts / models.ts), so a 4361-game store held 0 matchup rows while
 * 91 ENDED games really did pit two models against each other. The pairing
 * evidence itself IS persisted in benchmark_games (written by
 * benchmark-runner.ts at launch and completed by the terminal-event
 * subscription), so both head-to-head surfaces derive their rows from
 * benchmark_games for any pairing the persisted table carries no row for.
 *
 * Winner semantics — the SAME as benchmark-runner.ts getRunReport()
 * (the module-level pairing report, ~lines 490-530): benchmark_games
 * .winner / .team_winner hold a SIDE name ('MAFIA' | 'TOWN', written by
 * the terminal-event subscription). The winner MODEL is the model whose
 * players' side won, read from the real per-player rows (players.is_mafia
 * joined to the side winner; players.won is the fallback when the side
 * column carries no side name). The fixed role split is never used.
 *
 * Never fabricate a number: a pairing with zero completed valid games
 * produces no row at all.
 */

import type { GameRepository } from '../../db/repository.js';
import { GameRepository as GameRepositoryClass } from '../../db/repository.js';
import { normalizeModelKey } from './models.js';

/** One head-to-head row in the shape both consumers map to. */
export interface MatchupRow {
  modelA: string;
  modelB: string;
  gamesPlayed: number;
  modelAWins: number;
  modelBWins: number;
  ties: number;
}

/**
 * Local copy of BenchmarkRunner.parseModelSpec (module-private there, kept
 * in sync per that file's convention for the reverse-direction local
 * copies): 'provider/model' | 'provider:model' — the first slash wins when
 * it precedes any colon; a bare model name gets the CUSTOM passthrough
 * (and is dropped from head-to-head surfaces by the DF-36 ghost filter
 * downstream, exactly like the persisted-table path).
 */
function parseModelSpec(spec: string): [string, string] {
  const colonIdx = spec.indexOf(':');
  const slashIdx = spec.indexOf('/');
  if (slashIdx !== -1 && (colonIdx === -1 || slashIdx < colonIdx)) {
    return [spec.slice(0, slashIdx), spec.slice(slashIdx + 1)];
  }
  if (colonIdx !== -1) {
    return [spec.slice(0, colonIdx), spec.slice(colonIdx + 1)];
  }
  return ['CUSTOM', spec];
}

/** benchmark_games.winner / .team_winner hold a SIDE name or nothing. */
function asSideName(value: unknown): 'MAFIA' | 'TOWN' | null {
  if (value === 'MAFIA' || value === 'TOWN') return value;
  return null;
}

/**
 * Derive head-to-head rows from COMPLETED, valid benchmark_games for every
 * pairing (normalized provider/model of model_a and model_b). Row counts:
 *
 *   - gamesPlayed = completed valid games of the pairing (valid=1,
 *     error IS NULL, completed_at NOT NULL) — per contract.
 *   - modelAWins / modelBWins = games whose winner model is the pairing's
 *     A / B side, attributed through real players rows. Games that are
 *     degenerate or mock (DF-18/DF-12 — the same exclusions
 *     isUsableRunGame applies in the run report), carry no decidable side
 *     winner, have no player attribution, or were won by a model outside
 *     the pairing contribute NO win.
 *   - ties = the honest remainder (gamesPlayed - modelAWins -
 *     modelBWins): completed games with no attributable model win —
 *     undecidable winner, missing players rows, degenerate/mock games, or
 *     a winner outside the pairing. Never fabricated from guesses.
 */
export function deriveMatchupsFromBenchmarkGames(
  gameRepository: GameRepository,
): MatchupRow[] {
  let db;
  try {
    db = gameRepository.getDatabase();
  } catch {
    return [];
  }
  if (!db) return [];

  let gameRows: Array<{
    game_id: string;
    model_a: string;
    model_b: string;
    winner: string | null;
    team_winner: string | null;
    degenerate: number;
    mock: number;
  }>;
  let playerRows: Array<{
    game_id: string;
    provider: string;
    model: string;
    mafia_present: number | null;
    mafia_won_rows: number | null;
    town_won_rows: number | null;
  }>;
  try {
    // Completed, valid games only; the LEFT JOIN keeps a benchmark_games
    // row readable even when its parent games row is gone, and the shared
    // degenerate/mock predicates (g-aliased, the same SQL the aggregates
    // AND isUsableRunGame use) gate win attribution below.
    gameRows = db
      .prepare(
        `SELECT bg.game_id AS game_id,
                bg.model_a AS model_a,
                bg.model_b AS model_b,
                bg.winner AS winner,
                bg.team_winner AS team_winner,
                COALESCE((${GameRepositoryClass.DEGENERATE_GAME_SQL}), 0) AS degenerate,
                COALESCE((${GameRepositoryClass.MOCK_GAME_SQL}), 0) AS mock
           FROM benchmark_games bg
           LEFT JOIN games g ON g.id = bg.game_id
          WHERE bg.valid = 1
            AND bg.error IS NULL
            AND bg.completed_at IS NOT NULL`,
      )
      .all() as typeof gameRows;
    if (gameRows.length === 0) return [];

    // One pass over the players rows: per (game, raw provider/model) the
    // mafia-side presence (modelSidesForGame semantics) plus the per-side
    // won-row counts (the run report's players-fallback semantics). Rows
    // are normalized in TypeScript below via the canonical
    // normalizeModelKey helper — the same helper every model aggregation
    // in this service uses.
    playerRows = db
      .prepare(
        `SELECT p.game_id AS game_id,
                p.provider AS provider,
                p.model AS model,
                MAX(p.is_mafia) AS mafia_present,
                SUM(CASE WHEN p.is_mafia = 1 AND p.won = 1 THEN 1 ELSE 0 END)
                    AS mafia_won_rows,
                SUM(CASE WHEN p.is_mafia = 0 AND p.won = 1 THEN 1 ELSE 0 END)
                    AS town_won_rows
           FROM players p
          WHERE p.provider IS NOT NULL AND p.model IS NOT NULL
          GROUP BY p.game_id, p.provider, p.model`,
      )
      .all() as typeof playerRows;
  } catch {
    // benchmark tables not present in this store — no derived rows.
    return [];
  }

  // Per game: normalized model key -> isMafiaSide (first spelling wins for
  // OR-merged presence), and per-side won-row counts for the fallback.
  const sidesByGame = new Map<string, Map<string, boolean>>();
  const wonByGame = new Map<string, { mafia: number; town: number }>();
  for (const row of playerRows) {
    if (!row.provider || !row.model) continue;
    const norm = normalizeModelKey(row.provider, row.model);
    const key = `${norm.provider}/${norm.model}`;
    let sides = sidesByGame.get(row.game_id);
    if (!sides) {
      sides = new Map<string, boolean>();
      sidesByGame.set(row.game_id, sides);
    }
    const present = row.mafia_present === 1;
    sides.set(key, (sides.get(key) ?? false) || present);
    const won = wonByGame.get(row.game_id) ?? { mafia: 0, town: 0 };
    won.mafia += row.mafia_won_rows ?? 0;
    won.town += row.town_won_rows ?? 0;
    wonByGame.set(row.game_id, won);
  }

  interface PairAgg {
    aKey: string;
    bKey: string;
    gamesPlayed: number;
    aWins: number;
    bWins: number;
  }
  const pairings = new Map<string, PairAgg>();

  for (const g of gameRows) {
    // Canonical pairing keys via parseModelSpec + normalizeModelKey — the
    // same key shapes the rest of this service aggregates on. One real
    // model stays one key (slash prefixes collapse); a bare model name
    // maps to the CUSTOM passthrough and is ghost-filtered downstream.
    const [provA, specA] = parseModelSpec(String(g.model_a ?? ''));
    const [provB, specB] = parseModelSpec(String(g.model_b ?? ''));
    if (!specA || !specB) continue;
    const normA = normalizeModelKey(provA, specA);
    const normB = normalizeModelKey(provB, specB);
    if (!normA.model || !normB.model) continue;
    const aKey = `${normA.provider}/${normA.model}`;
    const bKey = `${normB.provider}/${normB.model}`;
    const pairKey = `${aKey}|${bKey}`;

    let agg = pairings.get(pairKey);
    if (!agg) {
      agg = { aKey, bKey, gamesPlayed: 0, aWins: 0, bWins: 0 };
      pairings.set(pairKey, agg);
    }
    agg.gamesPlayed += 1;

    // Winner side: benchmark_games.winner first, then team_winner, then the
    // players.won fallback (exactly one side with won rows) — the same
    // precedence getRunReport applies to its side winner.
    let teamWinner = asSideName(g.winner) ?? asSideName(g.team_winner);
    if (!teamWinner) {
      const won = wonByGame.get(g.game_id);
      if (won) {
        const mafiaWon = won.mafia > 0;
        const townWon = won.town > 0;
        // Exactly one side wins a real game; both (or none) means the
        // players rows cannot attribute the game — no winner here.
        if (mafiaWon !== townWon) teamWinner = mafiaWon ? 'MAFIA' : 'TOWN';
      }
    }
    if (!teamWinner) continue;

    // Winner model: the model whose players' side won, from REAL
    // attribution (never the fixed role split). Deterministic key order.
    const sides = sidesByGame.get(g.game_id);
    let winnerKey: string | null = null;
    if (sides && sides.size > 0) {
      const winnerSideIsMafia = teamWinner === 'MAFIA';
      for (const key of [...sides.keys()].sort()) {
        if (sides.get(key) === winnerSideIsMafia) {
          winnerKey = key;
          break;
        }
      }
    }
    if (!winnerKey) continue;

    // Degenerate (DF-18) / mock (DF-12) games are not real win evidence —
    // the same usable-game gate the run report's per-pairing wins apply.
    if (g.degenerate !== 0 || g.mock !== 0) continue;

    const winnerLower = winnerKey.toLowerCase();
    if (winnerLower === agg.aKey.toLowerCase()) agg.aWins += 1;
    else if (winnerLower === agg.bKey.toLowerCase()) agg.bWins += 1;
    // A winner outside the pairing stays unattributable (tie remainder).
  }

  return [...pairings.values()].map((agg) => ({
    modelA: agg.aKey,
    modelB: agg.bKey,
    gamesPlayed: agg.gamesPlayed,
    modelAWins: agg.aWins,
    modelBWins: agg.bWins,
    // Honest remainder: completed games with no attributable model win.
    ties: agg.gamesPlayed - agg.aWins - agg.bWins,
  }));
}