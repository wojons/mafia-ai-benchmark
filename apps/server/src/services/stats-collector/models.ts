/**
 * Model performance and comparison methods for StatsCollector.
 *
 * Extracted from the monolithic stats-collector.ts to reduce file size.
 */

import type { GameRepository } from '../../db/repository.js';
import { getGameWinnerFromEvents } from './wins.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

/** Roles that belong to the TOWN team. */
const TOWN_ROLES = new Set([
  'TOWN',
  'SHERIFF',
  'DOCTOR',
  'VILLAGER',
  'VIGILANTE',
  'JESTER',
  'DETECTIVE',
  'BODYGUARD',
]);

/**
 * SQL expression selecting the NORMALIZED model string for a table alias
 * (MAF-GAP-036). Some rows carry the provider prefix inside the model
 * column (provider='openai', model='openai/gpt-4o-mini') while others do
 * not (provider='openai', model='gpt-4o-mini'). Both are the same real
 * model, so the prefix is stripped before aggregation (LIKE is
 * case-insensitive for ASCII in SQLite, matching normalizeModelKey below).
 */
function normalizedModelSql(alias: string): string {
  return `CASE WHEN ${alias}.model LIKE ${alias}.provider || '/%' THEN substr(${alias}.model, length(${alias}.provider) + 2) ELSE ${alias}.model END`;
}

/**
 * Normalize a provider/model pair for aggregation (MAF-GAP-036): strip a
 * leading '<provider>/' prefix from the model string when present
 * (case-insensitive), so provider-prefixed and plain model spellings
 * merge into ONE row instead of producing duplicate/contradictory rows.
 * The provider is returned unchanged.
 */
export function normalizeModelKey(
  provider: string,
  model: string,
): { provider: string; model: string } {
  if (!provider || !model) return { provider, model };
  const prefix = `${provider}/`;
  if (
    model.length > prefix.length &&
    model.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()
  ) {
    return { provider, model: model.slice(prefix.length) };
  }
  return { provider, model };
}

/**
 * Derive honest per-model rows from real per-game model assignments
 * (player_model_assignments joined to ended games). Wins come ONLY from
 * real per-player rows (players.won = 1) — game-level winners are never
 * attributed to assignments (MAF-GAP-036). Returns [] when no
 * assignments exist — empty is honest, fabricated is not.
 *
 * avgTokens/avgCost/avgLatency are filled from the real token_usage and
 * api_calls rows the legacy adapter persists at game completion
 * (MAF-GAP-018): per-game token/cost totals averaged over the games the
 * model actually played, and mean per-call latency. Models with no
 * recorded usage keep honest zeros.
 */
function getModelComparisonFromAssignments(
  gameRepository: GameRepository,
): Array<{
  provider: string;
  model: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgTokens: number;
  avgCost: number;
  avgLatency: number;
}> {
  const db = gameRepository.getDatabase();
  const rows = db.prepare(`
    SELECT pma.provider, pma.model, pma.game_id, pma.role
    FROM player_model_assignments pma
    JOIN games g ON g.id = pma.game_id
    WHERE g.status = 'ENDED'
  `).all() as Array<{
    provider: string;
    model: string;
    game_id: string;
    role: string | null;
  }>;

  if (rows.length === 0) return [];

  const byModel = new Map<
    string,
    { provider: string; model: string; games: Set<string>; winGames: Set<string> }
  >();
  for (const row of rows) {
    if (!row.provider || !row.model) continue;
    const norm = normalizeModelKey(row.provider, row.model);
    const key = `${norm.provider}/${norm.model}`;
    let entry = byModel.get(key);
    if (!entry) {
      entry = {
        provider: norm.provider,
        model: norm.model,
        games: new Set(),
        winGames: new Set(),
      };
      byModel.set(key, entry);
    }
    entry.games.add(row.game_id);
  }

  // Wins come ONLY from real per-player rows (players.won = 1) — never
  // from game-level winners (MAF-GAP-036). The previous sideWon
  // attribution credited every role-group on the winning side, which
  // fabricated the 'CUSTOM/openai' 127/127 winRate=1.0 row.
  // MAF-GAP-039 adds honest side attribution at the getModelComparison
  // merge level instead: players.is_mafia joined to the real game winner
  // (per-player participation, never fake 'ALL'-player assignment rows).
  try {
    const pExpr = normalizedModelSql('p');
    const wonRows = db.prepare(`
      SELECT p.game_id,
             p.provider,
             ${pExpr} as model
      FROM players p
      WHERE p.provider IS NOT NULL AND p.model IS NOT NULL
        AND p.won = 1
      GROUP BY p.game_id, p.provider, ${pExpr}
    `).all() as Array<{
      game_id: string;
      provider: string;
      model: string;
    }>;
    for (const r of wonRows) {
      if (!r.provider || !r.model) continue;
      const norm = normalizeModelKey(r.provider, r.model);
      const entry = byModel.get(`${norm.provider}/${norm.model}`);
      if (entry) entry.winGames.add(r.game_id);
    }
  } catch {
    // players table unavailable — wins stay honest zeros.
  }

  // Real per-game token/cost totals recorded by the legacy adapter from
  // the engine's actual API responses (MAF-GAP-018). Keyed by model, one
  // entry per game, so the average is per-game usage.
  const usageByModel = new Map<
    string,
    Array<{ gameId: string; tokens: number; cost: number }>
  >();
  try {
    const usageRows = db.prepare(`
      SELECT provider, model, game_id,
             SUM(total_tokens) as tokens, COALESCE(SUM(cost), 0) as cost
      FROM token_usage
      GROUP BY provider, model, game_id
    `).all() as Array<{
      provider: string;
      model: string;
      game_id: string;
      tokens: number;
      cost: number;
    }>;
    for (const row of usageRows) {
      if (!row.provider || !row.model) continue;
      const norm = normalizeModelKey(row.provider, row.model);
      const key = `${norm.provider}/${norm.model}`;
      let list = usageByModel.get(key);
      if (!list) {
        list = [];
        usageByModel.set(key, list);
      }
      list.push({ gameId: row.game_id, tokens: row.tokens || 0, cost: row.cost || 0 });
    }
  } catch {
    // token_usage unavailable — keep honest zeros below.
  }

  // Real mean per-call latency per model from recorded api_calls.
  const latencyByModel = new Map<string, number>();
  try {
    const latencyRows = db.prepare(`
      SELECT provider, model, AVG(latency) as avg_latency
      FROM api_calls
      WHERE latency >= 50
      GROUP BY provider, model
    `).all() as Array<{
      provider: string;
      model: string;
      avg_latency: number;
    }>;
    for (const row of latencyRows) {
      if (!row.provider || !row.model) continue;
      const norm = normalizeModelKey(row.provider, row.model);
      latencyByModel.set(`${norm.provider}/${norm.model}`, row.avg_latency || 0);
    }
  } catch {
    // api_calls unavailable — keep honest zeros below.
  }

  return Array.from(byModel.values()).map((e) => {
    const key = `${e.provider}/${e.model}`;
    // Only count usage from games this model actually played.
    const played = (usageByModel.get(key) || []).filter((u) => e.games.has(u.gameId));
    const avgTokens = played.length > 0
      ? played.reduce((sum, u) => sum + u.tokens, 0) / played.length
      : 0;
    const avgCost = played.length > 0
      ? played.reduce((sum, u) => sum + u.cost, 0) / played.length
      : 0;
    return {
      provider: e.provider,
      model: e.model,
      gamesPlayed: e.games.size,
      wins: e.winGames.size,
      winRate: e.games.size > 0 ? e.winGames.size / e.games.size : 0,
      avgTokens,
      avgCost,
      avgLatency: latencyByModel.get(key) || 0,
    };
  });
}

/**
 * MAF-GAP-039: per-model side-attributed win games.
 *
 * A model "wins" a game when the side it played on won that game. The side
 * comes from REAL per-player participation rows (players.is_mafia) joined
 * to the REAL game-level winner — games.winner first, falling back to the
 * GAME_OVER-phase event winner (getGameWinnerFromEvents), which is the
 * same derivation the report summary's win totals use. This is NOT the
 * MAF-GAP-036 sideWon fabrication: only models with actual players rows
 * are attributed (one win per game per model), never fake 'ALL'-player
 * assignment rows, and legacy usage-only games (no players rows, e.g.
 * token_usage player_id='ALL') are never attributed here.
 *
 * Returns a map of normalized model key -> set of game ids the model won.
 */
function getSideAttributedWinGames(
  gameRepository: GameRepository,
): Map<string, Set<string>> {
  const winGamesByModel = new Map<string, Set<string>>();
  let db;
  try {
    db = gameRepository.getDatabase();
  } catch {
    return winGamesByModel;
  }
  if (!db) return winGamesByModel;
  try {
    const rows = db.prepare(`
      SELECT p.game_id, p.provider,
             ${normalizedModelSql('p')} as model,
             p.is_mafia, g.winner
      FROM players p
      JOIN games g ON g.id = p.game_id
      WHERE g.status = 'ENDED'
        AND p.provider IS NOT NULL AND p.model IS NOT NULL
    `).all() as Array<{
      game_id: string;
      provider: string;
      model: string;
      is_mafia: number | null;
      winner: string | null;
    }>;
    // games.winner is NULL for many legacy rows — the winner lives in the
    // GAME_OVER event. Cache per game so the event lookup runs at most once.
    const winnerCache = new Map<string, 'MAFIA' | 'TOWN' | null>();
    for (const row of rows) {
      if (!row.provider || !row.model) continue;
      let winner: 'MAFIA' | 'TOWN' | null = null;
      if (row.winner === 'MAFIA' || row.winner === 'TOWN') {
        winner = row.winner;
      } else {
        if (!winnerCache.has(row.game_id)) {
          winnerCache.set(
            row.game_id,
            getGameWinnerFromEvents(gameRepository, row.game_id),
          );
        }
        winner = winnerCache.get(row.game_id) ?? null;
      }
      if (winner !== 'MAFIA' && winner !== 'TOWN') continue;
      // Player-side win: is_mafia === 1 means the player is on the MAFIA
      // team, so their side won iff MAFIA won (and vice versa for TOWN).
      const sideWon =
        row.is_mafia === 1 ? winner === 'MAFIA' : winner === 'TOWN';
      if (!sideWon) continue;
      const norm = normalizeModelKey(row.provider, row.model);
      const key = `${norm.provider}/${norm.model}`;
      let set = winGamesByModel.get(key);
      if (!set) {
        set = new Set();
        winGamesByModel.set(key, set);
      }
      set.add(row.game_id);
    }
  } catch {
    // players/games unavailable — no side attribution (honest zeros).
  }
  return winGamesByModel;
}

/**
 * Derive honest per-model rows directly from recorded token_usage for
 * ended games that have NO player_model_assignments rows (the default
 * POST /api/v1/games legacy path, MAF-GAP-018). The usage data is real
 * (recorded from actual API responses), but role/side attribution is
 * unknown, so wins stay 0 — we never guess which side the model played.
 * Keys already covered by the players table or assignments are skipped.
 */
function getModelComparisonFromUsage(
  gameRepository: GameRepository,
  excludeKeys: Set<string>,
): Array<{
  provider: string;
  model: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgTokens: number;
  avgCost: number;
  avgLatency: number;
}> {
  const db = gameRepository.getDatabase();
  const rows = db.prepare(`
    SELECT tu.provider, tu.model,
           COUNT(DISTINCT tu.game_id) as games,
           SUM(tu.total_tokens) as tokens,
           COALESCE(SUM(tu.cost), 0) as cost
    FROM token_usage tu
    JOIN games g ON g.id = tu.game_id
    WHERE g.status = 'ENDED'
    GROUP BY tu.provider, tu.model
  `).all() as Array<{
    provider: string;
    model: string;
    games: number;
    tokens: number;
    cost: number;
  }>;

  const latencyByModel = new Map<string, number>();
  try {
    const latencyRows = db.prepare(`
      SELECT provider, model, AVG(latency) as avg_latency
      FROM api_calls
      WHERE latency >= 50
      GROUP BY provider, model
    `).all() as Array<{ provider: string; model: string; avg_latency: number }>;
    for (const row of latencyRows) {
      if (!row.provider || !row.model) continue;
      const norm = normalizeModelKey(row.provider, row.model);
      latencyByModel.set(`${norm.provider}/${norm.model}`, row.avg_latency || 0);
    }
  } catch {
    // api_calls unavailable — keep honest zeros below.
  }

  const out = [];
  for (const row of rows) {
    if (!row.provider || !row.model) continue;
    const key = `${row.provider}/${row.model}`;
    if (excludeKeys.has(key)) continue;
    out.push({
      provider: row.provider,
      model: row.model,
      gamesPlayed: row.games,
      wins: 0,
      winRate: 0,
      avgTokens: row.games > 0 ? row.tokens / row.games : 0,
      avgCost: row.games > 0 ? row.cost / row.games : 0,
      avgLatency: latencyByModel.get(key) || 0,
    });
  }
  return out;
}

/**
 * Get model comparison data. Merges three honest sources, keyed by
 * provider/model (MAF-GAP-018):
 *   1. players/token_usage tables (new engine path),
 *   2. player_model_assignments + recorded usage (legacy benchmark path),
 *   3. recorded token_usage for ended games with no assignments (legacy
 *      default path — usage is real, wins unattributable so kept 0).
 * NEVER fabricates a provider/model that did not play — returns [] when
 * no real data exists (MAF-GAP-012). On key collision the row with the
 * most games wins and wins take the max (MAF-GAP-036).
 *
 * Wins semantics (MAF-GAP-039): a model's wins are the games its side won,
 * attributed from REAL per-player rows — players.won = 1 counts, plus
 * side attribution (players.is_mafia vs the game winner from games.winner
 * or the GAME_OVER event, the same derivation the summary uses). Rows
 * without side data (legacy usage-only games, player_id='ALL') keep
 * wins 0 — that is the documented, honest floor, not a contradiction.
 */
export function getModelComparison(
  gameRepository: GameRepository,
): Array<{
  provider: string;
  model: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgTokens: number;
  avgCost: number;
  avgLatency: number;
}> {
  const merged = new Map<
    string,
    {
      provider: string;
      model: string;
      gamesPlayed: number;
      wins: number;
      winRate: number;
      avgTokens: number;
      avgCost: number;
      avgLatency: number;
    }
  >();
  const addRows = (
    rows: Array<{
      provider: string;
      model: string;
      gamesPlayed: number;
      wins: number;
      winRate: number;
      avgTokens: number;
      avgCost: number;
      avgLatency: number;
    }>,
  ) => {
    for (const row of rows) {
      if (!row.provider || !row.model) continue;
      const norm = normalizeModelKey(row.provider, row.model);
      const key = `${norm.provider}/${norm.model}`;
      const normalized = { ...row, provider: norm.provider, model: norm.model };
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, normalized);
      } else {
        // MAF-GAP-036: after key normalization the same model can arrive
        // from multiple sources (players / assignments / token_usage).
        // Keep the row with the most games (most complete) — legacy games
        // exist ONLY in token_usage ('ALL'-player rows), so the earlier
        // source must not shadow hundreds of real games. Wins may only
        // come from real players.won rows, so take the max (never fabricate).
        if ((normalized.gamesPlayed || 0) > (existing.gamesPlayed || 0)) {
          merged.set(key, {
            ...normalized,
            wins: Math.max(existing.wins || 0, normalized.wins || 0),
          });
        } else {
          merged.set(key, {
            ...existing,
            wins: Math.max(existing.wins || 0, normalized.wins || 0),
          });
        }
      }
    }
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dbStats: any[] = [];
    try {
      dbStats = gameRepository.getModelStats();
    } catch {
      dbStats = [];
    }
    addRows(dbStats);
    addRows(getModelComparisonFromAssignments(gameRepository));
    // Pass NO exclusions: after key normalization (MAF-GAP-036) the same
    // model can legitimately appear in multiple sources (e.g. assignments
    // with 1 game vs token_usage with 495). addRows' merge-max keeps the
    // most complete row instead of letting the earlier source shadow it.
    addRows(getModelComparisonFromUsage(gameRepository, new Set()));

    // MAF-GAP-039: fold in side-attributed wins from real game-level
    // winners joined to per-game model participation (players.is_mafia).
    // This keeps the per-model rows consistent with the summary's winner
    // derivation without fabricating anything: usage-only rows have no
    // players rows, so they keep their honest 0 wins.
    const sideWinGames = getSideAttributedWinGames(gameRepository);
    if (sideWinGames.size > 0) {
      for (const [key, row] of merged) {
        const winSet = sideWinGames.get(key);
        if (winSet && winSet.size > 0) {
          row.wins = Math.min(
            Math.max(row.wins || 0, winSet.size),
            row.gamesPlayed || 0,
          );
          row.winRate =
            row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0;
        }
      }
    }

    return Array.from(merged.values()).sort(
      (a, b) => b.gamesPlayed - a.gamesPlayed,
    );
  } catch (e) {
    console.error(
      'StatsCollector.getModelComparison: failed to compute model comparison data',
      e,
    );
    return [];
  }
}

/**
 * Honest fallback model rows for the benchmark report when the players
 * table has no role-attributed rows (legacy games, MAF-GAP-036).
 *
 * Wins come ONLY from players.won per row; usage-derived rows keep wins
 * 0 because role/side attribution is unknowable. The assignment path's
 * game-level-winner attribution (sideWon on ended games) is deliberately
 * NOT used here — it attributes wins to fake 'ALL' player rows and
 * fabricated the 'CUSTOM/openai' 126/126 winRate=1.0 row. All keys use
 * the normalized model string so provider-prefixed rows merge into a
 * single row.
 */
function getHonestReportFallbackModels(
  gameRepository: GameRepository,
): Array<{
  provider: string;
  model: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgTokens: number;
  avgCost: number;
  avgLatency: number;
}> {
  const db = gameRepository.getDatabase();
  const rows: Array<{
    provider: string;
    model: string;
    gamesPlayed: number;
    wins: number;
    winRate: number;
    avgTokens: number;
    avgCost: number;
    avgLatency: number;
  }> = [];
  const covered = new Set<string>();
  const pExpr = normalizedModelSql('p');

  // 1. players-table rows (any role) — wins from players.won per row.
  try {
    const playerRows = db.prepare(`
      SELECT p.provider,
             ${pExpr} as model,
             COUNT(DISTINCT p.game_id) as games_played,
             SUM(CASE WHEN p.won = 1 THEN 1 ELSE 0 END) as wins,
             COALESCE(AVG(p.tokens_used), 0) as avg_tokens
      FROM players p
      WHERE p.provider IS NOT NULL AND p.model IS NOT NULL
      GROUP BY p.provider, ${pExpr}
    `).all() as Array<{
      provider: string;
      model: string;
      games_played: number;
      wins: number;
      avg_tokens: number;
    }>;
    for (const r of playerRows) {
      if (!r.provider || !r.model) continue;
      covered.add(`${r.provider}/${r.model}`);
      rows.push({
        provider: r.provider,
        model: r.model,
        gamesPlayed: r.games_played,
        wins: r.wins,
        winRate: r.games_played > 0 ? r.wins / r.games_played : 0,
        avgTokens: r.avg_tokens || 0,
        avgCost: 0,
        avgLatency: 0,
      });
    }
  } catch {
    // players table unavailable — usage-derived rows below still work.
  }

  // 2. real recorded usage for ended games (wins stay 0 — unattributable).
  try {
    const tuExpr = normalizedModelSql('tu');
    const usageRows = db.prepare(`
      SELECT tu.provider,
             ${tuExpr} as model,
             COUNT(DISTINCT tu.game_id) as games_played,
             SUM(tu.total_tokens) as tokens,
             COALESCE(SUM(tu.cost), 0) as cost
      FROM token_usage tu
      JOIN games g ON g.id = tu.game_id
      WHERE g.status = 'ENDED'
        AND tu.provider IS NOT NULL AND tu.model IS NOT NULL
      GROUP BY tu.provider, ${tuExpr}
    `).all() as Array<{
      provider: string;
      model: string;
      games_played: number;
      tokens: number;
      cost: number;
    }>;
    for (const r of usageRows) {
      if (!r.provider || !r.model) continue;
      const key = `${r.provider}/${r.model}`;
      if (covered.has(key)) continue;
      rows.push({
        provider: r.provider,
        model: r.model,
        gamesPlayed: r.games_played,
        wins: 0,
        winRate: 0,
        avgTokens: r.games_played > 0 ? r.tokens / r.games_played : 0,
        avgCost: r.games_played > 0 ? r.cost / r.games_played : 0,
        avgLatency: 0,
      });
    }
  } catch {
    // token_usage unavailable — players-derived rows only.
  }

  return rows.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
}

/**
 * Get comprehensive model comparison report.
 * When the players/token_usage tables are empty (legacy games), derives
 * model and trend data from game events.
 */
export function getCompareReport(
  gameRepository: GameRepository,
  modelFilter?: string[],
): {
  models: Array<{
    provider: string;
    model: string;
    gamesPlayed: number;
    wins: number;
    winRate: number;
    avgTokensPerGame: number;
    avgCostPerGame: number;
    avgLatency: number;
    avgRolePerformance: number;
    rolePerformance: Record<
      string,
      {
        gamesPlayed: number;
        wins: number;
        winRate: number;
      }
    >;
  }>;
  headToHead: Array<{
    modelA: string;
    modelB: string;
    gamesPlayed: number;
    modelAWins: number;
    modelBWins: number;
    ties: number;
  }>;
  trends: Array<{
    model: string;
    games: Array<{
      gameId: string;
      won: boolean;
      role: string;
      tokensUsed: number;
      createdAt: string;
    }>;
    cumulativeWinRate: number[];
  }>;
} {
  const db = gameRepository.getDatabase();

  const modelList =
    modelFilter && modelFilter.length > 0 ? modelFilter : null;

  // ===== Per-model aggregate stats =====
  // MAF-GAP-036: aggregate on the NORMALIZED model string — rows that carry
  // the provider prefix inside the model column and rows that don't are the
  // same real model and must merge into ONE row.
  const modelExpr = normalizedModelSql('p');
  let modelQuery = `
      SELECT 
        p.provider,
        ${modelExpr} as model,
        COUNT(DISTINCT p.game_id) as games_played,
        SUM(CASE WHEN p.won = 1 THEN 1 ELSE 0 END) as wins,
        COALESCE(AVG(p.tokens_used), 0) as avg_tokens,
        COALESCE(AVG(p.role_performance), 0) as avg_role_perf
      FROM players p
      WHERE p.provider IS NOT NULL AND p.model IS NOT NULL
        AND p.role != 'UNASSIGNED'
    `;
  const modelParams: string[] = [];

  if (modelList) {
    const placeholders = modelList.map(() => '?').join(',');
    modelQuery += ` AND (p.model IN (${placeholders}) OR ${modelExpr} IN (${placeholders}))`;
    modelParams.push(...modelList, ...modelList);
  }

  modelQuery += ` GROUP BY p.provider, ${modelExpr} ORDER BY games_played DESC`;

  const modelRows = db
    .prepare(modelQuery)
    .all(...modelParams) as Record<string, unknown>[];

  // ===== Per-model role-specific performance =====
  let roleQueryBody = `
        p.provider,
        ${modelExpr} as model,
        p.role,
        COUNT(DISTINCT p.game_id) as games_played,
        SUM(CASE WHEN p.won = 1 THEN 1 ELSE 0 END) as wins
      FROM players p
      WHERE p.provider IS NOT NULL AND p.model IS NOT NULL
        AND p.role != 'UNASSIGNED'
    `;
  const roleParams: string[] = [];

  if (modelList) {
    const placeholders = modelList.map(() => '?').join(',');
    roleQueryBody += ` AND (p.model IN (${placeholders}) OR ${modelExpr} IN (${placeholders}))`;
    roleParams.push(...modelList, ...modelList);
  }

  const roleQuery = `SELECT ${roleQueryBody} GROUP BY p.provider, ${modelExpr}, p.role`;
  const roleRows = db
    .prepare(roleQuery)
    .all(...roleParams) as Record<string, unknown>[];

  const rolePerfMap = new Map<
    string,
    Record<string, { gamesPlayed: number; wins: number; winRate: number }>
  >();
  for (const row of roleRows) {
    const key = `${row.provider}/${row.model}`;
    if (!rolePerfMap.has(key)) {
      rolePerfMap.set(key, {});
    }
    const gp = row.games_played as number;
    const w = row.wins as number;
    rolePerfMap.get(key)![row.role as string] = {
      gamesPlayed: gp,
      wins: w,
      winRate: gp > 0 ? w / gp : 0,
    };
  }

  // ===== Avg cost per model (normalized key, MAF-GAP-036) =====
  const tuModelExpr = normalizedModelSql('tu');
  let costQuery = `
      SELECT 
        tu.provider,
        tu.model_n,
        COALESCE(AVG(cost_sum), 0) as avg_cost_per_game
      FROM (
        SELECT tu.provider,
               ${tuModelExpr} as model_n,
               tu.game_id,
               SUM(tu.cost) as cost_sum
        FROM token_usage tu
        WHERE tu.provider IS NOT NULL AND tu.model IS NOT NULL
    `;
  const costParams: string[] = [];
  if (modelList) {
    const placeholders = modelList.map(() => '?').join(',');
    costQuery += ` AND (tu.model IN (${placeholders}) OR ${tuModelExpr} IN (${placeholders}))`;
    costParams.push(...modelList, ...modelList);
  }
  costQuery += ` GROUP BY tu.provider, model_n, tu.game_id) tu GROUP BY tu.provider, tu.model_n`;
  const costRows = db
    .prepare(costQuery)
    .all(...costParams) as Record<string, unknown>[];

  const costMap = new Map<string, number>();
  for (const row of costRows) {
    costMap.set(`${row.provider}/${row.model_n}`, row.avg_cost_per_game as number);
  }

  // ===== Avg latency per model (normalized key, MAF-GAP-036) =====
  const acModelExpr = normalizedModelSql('ac');
  let latencyQuery = `
      SELECT 
        ac.provider,
        ${acModelExpr} as model,
        COALESCE(AVG(ac.latency), 0) as avg_latency
      FROM api_calls ac
      WHERE ac.provider IS NOT NULL AND ac.model IS NOT NULL
        AND ac.latency >= 50
    `;
  const latencyParams: string[] = [];
  if (modelList) {
    const placeholders = modelList.map(() => '?').join(',');
    latencyQuery += ` AND (ac.model IN (${placeholders}) OR ${acModelExpr} IN (${placeholders}))`;
    latencyParams.push(...modelList, ...modelList);
  }
  latencyQuery += ` GROUP BY ac.provider, ${acModelExpr}`;
  const latencyRows = db
    .prepare(latencyQuery)
    .all(...latencyParams) as Record<string, unknown>[];

  const latencyMap = new Map<string, number>();
  for (const row of latencyRows) {
    latencyMap.set(`${row.provider}/${row.model}`, row.avg_latency as number);
  }

  const models = modelRows.map((row) => {
    const key = `${row.provider}/${row.model}`;
    const gp = row.games_played as number;
    const w = row.wins as number;
    return {
      provider: row.provider as string,
      model: row.model as string,
      gamesPlayed: gp,
      wins: w,
      winRate: gp > 0 ? w / gp : 0,
      avgTokensPerGame: Math.round((row.avg_tokens as number) || 0),
      avgCostPerGame: Math.round((costMap.get(key) || 0) * 10000) / 10000,
      avgLatency: Math.round(latencyMap.get(key) || 0),
      avgRolePerformance:
        Math.round(((row.avg_role_perf as number) || 0) * 100) / 100,
      rolePerformance: rolePerfMap.get(key) || {},
    };
  });

  // ===== Head-to-head =====
  let h2hQuery = 'SELECT * FROM model_matchups WHERE 1=1';
  const h2hParams: string[] = [];
  if (modelList) {
    const aPlaceholders = modelList.map(() => '?').join(',');
    const bPlaceholders = modelList.map(() => '?').join(',');
    h2hQuery += ` AND (model_a IN (${aPlaceholders}) OR model_b IN (${bPlaceholders}))`;
    h2hParams.push(...modelList, ...modelList);
  }
  h2hQuery += ' ORDER BY games_played DESC LIMIT 50';

  const h2hRows = db
    .prepare(h2hQuery)
    .all(...h2hParams) as Record<string, unknown>[];

  const headToHead = h2hRows.map((row) => ({
    modelA: `${row.model_a_provider || ''}/${row.model_a || ''}`,
    modelB: `${row.model_b_provider || ''}/${row.model_b || ''}`,
    gamesPlayed: row.games_played as number,
    modelAWins: row.model_a_wins as number,
    modelBWins: row.model_b_wins as number,
    ties: row.ties as number,
  }));

  // ===== Trends (game-by-game data) =====
  let trendQuery = `
      SELECT 
        p.provider,
        ${modelExpr} as model,
        p.game_id,
        p.role,
        p.won,
        p.tokens_used,
        g.created_at
      FROM players p
      JOIN games g ON g.id = p.game_id
      WHERE p.provider IS NOT NULL AND p.model IS NOT NULL
        AND p.role != 'UNASSIGNED'
    `;
  const trendParams: string[] = [];
  if (modelList) {
    const placeholders = modelList.map(() => '?').join(',');
    trendQuery += ` AND (p.model IN (${placeholders}) OR ${modelExpr} IN (${placeholders}))`;
    trendParams.push(...modelList, ...modelList);
  }
  trendQuery += ` ORDER BY ${modelExpr}, g.created_at ASC`;

  const trendRows = db
    .prepare(trendQuery)
    .all(...trendParams) as Record<string, unknown>[];

  // Fallback: if no player-level trend data (legacy games — players carry
  // role 'UNASSIGNED'), derive honest per-model rows from the players table
  // and real recorded usage only (MAF-GAP-036). Wins may ONLY come from
  // players.won per row (or stay 0 when unattributable) — the previous
  // assignment-derived, game-level-winner attribution (sideWon on ended
  // games) fabricated wins for fake 'ALL' player rows and must not be used.
  if (trendRows.length === 0) {
    const fallbackModels: AnyRecord[] =
      models.length > 0
        ? (models as AnyRecord[])
        : getHonestReportFallbackModels(gameRepository);

    const t: AnyRecord[] = [];
    for (const m of fallbackModels) {
      if (modelList && !modelList.includes(m.model)) continue;
      t.push(m);
    }
    const fallbackModels2 = t.length > 0 ? t : fallbackModels;

    const fallbackTrends: Array<{
      model: string;
      games: Array<{
        gameId: string;
        won: boolean;
        role: string;
        tokensUsed: number;
        createdAt: string;
      }>;
      cumulativeWinRate: number[];
    }> = [];

    // Per-game, per-model wins from real players.won rows only — the report
    // must never attribute a win from the game-level winner to a fake
    // 'ALL' player (MAF-GAP-036).
    const wonByGameModel = new Map<string, boolean>();
    try {
      const wonRows = db.prepare(`
        SELECT p.game_id,
               p.provider,
               ${modelExpr} as model,
               SUM(CASE WHEN p.won = 1 THEN 1 ELSE 0 END) as wins
        FROM players p
        WHERE p.provider IS NOT NULL AND p.model IS NOT NULL
          AND p.won = 1
        GROUP BY p.game_id, p.provider, ${modelExpr}
      `).all() as Array<{
        game_id: string;
        provider: string;
        model: string;
        wins: number;
      }>;
      for (const r of wonRows) {
        wonByGameModel.set(
          `${r.game_id}|${r.provider}/${r.model}`,
          (r.wins || 0) > 0,
        );
      }
    } catch {
      // players table unavailable — every fallback entry stays a loss
      // (honest: no fabricated wins).
    }

    // Per-model game entries derived from real assignments; the won flag
    // comes from players.won per row, never from game-level winners.
    const assignmentRows = db.prepare(`
      SELECT pma.provider, pma.model, pma.game_id, pma.role, g.created_at
      FROM player_model_assignments pma
      JOIN games g ON g.id = pma.game_id
      WHERE g.status = 'ENDED'
    `).all() as Array<{
      provider: string;
      model: string;
      game_id: string;
      role: string | null;
      created_at: number;
    }>;
    const entriesByModel = new Map<
      string,
      Array<{ gameId: string; won: boolean; role: string; tokensUsed: number; createdAt: string }>
    >();
    for (const row of assignmentRows) {
      if (!row.provider || !row.model) continue;
      const norm = normalizeModelKey(row.provider, row.model);
      const key = `${norm.provider}/${norm.model}`;
      if (!entriesByModel.has(key)) entriesByModel.set(key, []);
      entriesByModel.get(key)!.push({
        gameId: row.game_id,
        won: wonByGameModel.get(`${row.game_id}|${key}`) === true,
        role: row.role || 'UNASSIGNED',
        tokensUsed: 0,
        createdAt: new Date(row.created_at).toISOString(),
      });
    }

    for (const fm of fallbackModels2) {
      if (modelList && !modelList.includes(fm.model)) continue;

      const gameEntries = entriesByModel.get(`${fm.provider}/${fm.model}`) || [];

      const cumulativeWinRate: number[] = [];
      let cumulativeWins = 0;
      for (let i = 0; i < gameEntries.length; i++) {
        if (gameEntries[i].won) cumulativeWins++;
        cumulativeWinRate.push(
          Math.round((cumulativeWins / (i + 1)) * 10000) / 10000,
        );
      }
      fallbackTrends.push({
        model: `${fm.provider}/${fm.model}`,
        games: gameEntries,
        cumulativeWinRate,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const normalizedModels: any = fallbackModels2.map((m: AnyRecord) => {
      const key = `${m.provider}/${m.model}`;
      return {
        provider: m.provider,
        model: m.model,
        gamesPlayed: m.gamesPlayed,
        wins: m.wins,
        winRate: m.winRate,
        avgTokensPerGame: m.avgTokensPerGame ?? m.avgTokens ?? 0,
        avgCostPerGame: m.avgCostPerGame ?? m.avgCost ?? costMap.get(key) ?? 0,
        avgLatency: m.avgLatency ?? latencyMap.get(key) ?? 0,
        avgRolePerformance: m.avgRolePerformance ?? 0,
        rolePerformance: m.rolePerformance ?? {},
      };
    });
    return {
      models: normalizedModels,
      headToHead,
      trends: fallbackTrends,
    };
  }

  const trendMap = new Map<
    string,
    Array<{
      gameId: string;
      won: boolean;
      role: string;
      tokensUsed: number;
      createdAt: string;
    }>
  >();

  for (const row of trendRows) {
    const modelKey = `${row.provider}/${row.model}`;
    if (!trendMap.has(modelKey)) {
      trendMap.set(modelKey, []);
    }
    trendMap.get(modelKey)!.push({
      gameId: row.game_id as string,
      won: Boolean(row.won),
      role: row.role as string,
      tokensUsed: (row.tokens_used as number) || 0,
      createdAt: new Date(row.created_at as number).toISOString(),
    });
  }

  const trends = Array.from(trendMap.entries()).map(([model, games]) => {
    const cumulativeWinRate: number[] = [];
    let cumulativeWins = 0;
    for (let i = 0; i < games.length; i++) {
      if (games[i].won) cumulativeWins++;
      cumulativeWinRate.push(
        Math.round((cumulativeWins / (i + 1)) * 10000) / 10000,
      );
    }
    return { model, games, cumulativeWinRate };
  });

  return { models, headToHead, trends };
}

/**
 * Generate recommendations based on statistics
 */
export function generateRecommendations(
  modelComparison: Array<{
    provider: string;
    model: string;
    winRate: number;
    avgCost: number;
  }>,
): string[] {
  const recommendations: string[] = [];

  if (modelComparison.length === 0) return recommendations;

  const bestWinRate = modelComparison.reduce(
    (best, m) => (m.winRate > (best?.winRate || 0) ? m : best),
    null as (typeof modelComparison)[0] | null,
  );

  if (bestWinRate) {
    recommendations.push(
      `Best win rate: ${bestWinRate.provider}/${bestWinRate.model} (${(bestWinRate.winRate * 100).toFixed(1)}%)`,
    );
  }

  const bestValue = modelComparison.reduce(
    (best, m) => {
      const value = m.winRate / (m.avgCost || 1);
      const bestCurrent = best ? best.winRate / (best.avgCost || 1) : 0;
      return value > bestCurrent ? m : best;
    },
    null as (typeof modelComparison)[0] | null,
  );

  if (bestValue) {
    recommendations.push(
      `Best value: ${bestValue.provider}/${bestValue.model} (win rate per dollar)`,
    );
  }

  return recommendations;
}
