/**
 * Integrity-format — corpus integrity counts for the MAF-INIT-001 gate.
 *
 * `computeIntegrityCounts(db)` runs ONE statement over a game SQLite
 * database (never the live server, never docker) and returns the six gate
 * counts:
 *
 *   total          every games row, any status
 *   ended          status = 'ENDED'
 *   cancelled      status = 'CANCELLED'
 *   single_model   every player attributed, exactly one (provider, model)
 *   mixed_model    every player attributed, ≥ 2 (provider, model) pairs
 *   unattributed   any player row missing provider/model (or no player rows)
 *   with_cost      games.total_cost IS NOT NULL (populated by MAF-INIT-001)
 *
 * Attribution classification is per GAME: a game with at least one player
 * row that lacks a non-empty provider/model is 'unattributed' — the
 * historical 18/200 corpus shape. A game with zero player rows is counted
 * as unattributed too (no attribution exists to read). The MAF-INIT-001
 * write-path enforcement makes the unattributed case impossible for NEW
 * games; this report is how the corpus proves where it stands.
 */

export interface IntegrityCounts {
  total: number;
  ended: number;
  cancelled: number;
  single_model: number;
  mixed_model: number;
  unattributed: number;
  with_cost: number;
}

interface RawRow {
  total: number | null;
  ended: number | null;
  cancelled: number | null;
  single_model: number | null;
  mixed_model: number | null;
  unattributed: number | null;
  with_cost: number | null;
}

/** The single statement behind computeIntegrityCounts — exported so a test
 * can EXPLAIN it against the real DB instead of a drifted copy. */
export const INTEGRITY_COUNTS_SQL = `
  WITH attribution AS (
    SELECT
      g.id AS gid,
      COUNT(p.id) AS player_rows,
      SUM(CASE
        WHEN p.provider IS NULL OR trim(p.provider) = ''
          OR p.model IS NULL OR trim(p.model) = ''
        THEN 1 ELSE 0 END) AS unattributed_rows,
      COUNT(DISTINCT CASE
        WHEN p.provider IS NOT NULL AND trim(p.provider) != ''
          AND p.model IS NOT NULL AND trim(p.model) != ''
        THEN p.provider || char(0) || p.model END) AS distinct_pairs
    FROM games g
    LEFT JOIN players p ON p.game_id = g.id
    GROUP BY g.id
  )
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN g.status = 'ENDED' THEN 1 ELSE 0 END) AS ended,
    SUM(CASE WHEN g.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
    SUM(CASE WHEN a.player_rows > 0 AND a.unattributed_rows = 0 AND a.distinct_pairs = 1
      THEN 1 ELSE 0 END) AS single_model,
    SUM(CASE WHEN a.player_rows > 0 AND a.unattributed_rows = 0 AND a.distinct_pairs > 1
      THEN 1 ELSE 0 END) AS mixed_model,
    SUM(CASE WHEN a.player_rows = 0 OR a.unattributed_rows > 0
      THEN 1 ELSE 0 END) AS unattributed,
    SUM(CASE WHEN g.total_cost IS NOT NULL THEN 1 ELSE 0 END) AS with_cost
  FROM games g
  LEFT JOIN attribution a ON a.gid = g.id
`;

/** Minimal read interface (the better-sqlite3 Database shape we use). */
export interface IntegritableDb {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}

/** Compute the six gate counts over any readable game database. */
export function computeIntegrityCounts(db: IntegritableDb): IntegrityCounts {
  const row = db.prepare(INTEGRITY_COUNTS_SQL).get() as RawRow;
  // An EMPTY games table makes every SUM NULL — a zero is the honest count.
  return {
    total: row.total ?? 0,
    ended: row.ended ?? 0,
    cancelled: row.cancelled ?? 0,
    single_model: row.single_model ?? 0,
    mixed_model: row.mixed_model ?? 0,
    unattributed: row.unattributed ?? 0,
    with_cost: row.with_cost ?? 0,
  };
}

/** Fixed key order, one JSON line — the machine-readable artifact. */
export function serializeIntegrityJson(counts: IntegrityCounts): string {
  return JSON.stringify(counts) + '\n';
}

/** Human-readable rendering of the same counts (fixed order, aligned). */
export function renderIntegrityTable(counts: IntegrityCounts): string {
  const width = Math.max(
    ...Object.keys(counts).map((k) => k.length),
  );
  const lines: string[] = [];
  lines.push('Corpus integrity report (MAF-INIT-001)');
  lines.push('');
  lines.push(`  ${'total'.padEnd(width)}  ${counts.total}`);
  lines.push(`  ${'ENDED'.padEnd(width)}  ${counts.ended}`);
  lines.push(`  ${'CANCELLED'.padEnd(width)}  ${counts.cancelled}`);
  lines.push(`  ${'single-model'.padEnd(width)}  ${counts.single_model}`);
  lines.push(`  ${'mixed-model'.padEnd(width)}  ${counts.mixed_model}`);
  lines.push(`  ${'unattributed'.padEnd(width)}  ${counts.unattributed}`);
  lines.push(`  ${'with-cost'.padEnd(width)}  ${counts.with_cost}`);
  lines.push('');
  lines.push(
    '  Attribution: single/mixed/unattributed partition the corpus; ' +
      'with-cost counts rows with a populated games.total_cost.',
  );
  if (counts.unattributed > 0) {
    lines.push(
      `  ⚠️  ${counts.unattributed} unattributed game(s) — labeled provenance=unknown in run records; never leaderboard-published material.`,
    );
  }
  return lines.join('\n');
}
