/**
 * Shared model-identity normalization for the benchmark aggregates.
 *
 * DF-MAFIA-AI-BENCHMARK-55: a dated snapshot id a provider returned for a
 * limited window survived every earlier identity pass as its own 1-game
 * series — live probe 2026-11-23: GET /api/v1/benchmark/compare served
 * compare.models[2] = { model 'gpt-4o-2024-08-06', gamesPlayed 1,
 * winRate 1, avgTokensPerGame 10324, avgCostPerGame 0.0372 } as a SEPARATE
 * competitor beside 'gpt-4o', report.recommendations crowned it
 * 'Best win rate: OPENAI/gpt-4o-2024-08-06 (100.0%)' on that single game,
 * and the leaderboard rendered its avg-token/avg-cost cells empty.
 *
 * This module is a LEAF: it imports nothing from db/ or services/, so both
 * the SQL grouping expressions (db/repository.ts, stats-collector/models.ts)
 * and the TypeScript row normalizer can share ONE alias table and can never
 * drift apart.
 */

/**
 * Dated snapshot id -> canonical engine family id. Lookup is by the
 * LOWERCASED model string; the replacement value is the canonical spelling.
 *
 * The map is deliberately EXACT — there is no `-YYYY-MM-DD` suffix pattern
 * rule. A snapshot id is only collapsed when it is KNOWN to be the same
 * engine as its canonical id; a pattern rule would also merge future
 * snapshot ids a benchmark may legitimately want to compare per snapshot.
 * When the next dated alias surfaces on the leaderboard, add it here
 * (lowercase key) — the SQL grouping and the TS normalizer pick it up
 * together because both are generated from this one table.
 */
export const MODEL_FAMILY_ALIASES: Readonly<Record<string, string>> = {
  'gpt-4o-2024-08-06': 'gpt-4o',
};

/**
 * True when a model string is a dated alias of a canonical engine family
 * (case-insensitive). Exported for tests and diagnostics.
 */
export function isDatedModelAlias(model: unknown): boolean {
  return (
    typeof model === 'string' &&
    Object.prototype.hasOwnProperty.call(MODEL_FAMILY_ALIASES, model.toLowerCase())
  );
}

/**
 * TypeScript-side collapse: a dated snapshot id becomes its canonical
 * engine family id; every other string (including ids that merely LOOK
 * like snapshots but are not in the table) is returned unchanged.
 */
export function canonicalizeModelFamily(model: string): string {
  if (!model) return model;
  return MODEL_FAMILY_ALIASES[model.toLowerCase()] ?? model;
}

/**
 * SQL fragment mapping a model-string expression through the alias table,
 * for GROUP BY / equality keys. `modelExpr` must be a SQL expression
 * producing the (already provider-prefix-stripped) model id — e.g. the
 * normalizedModelSql CASE output. Generated from MODEL_FAMILY_ALIASES so
 * the SQL grouping collapses exactly the ids the TS normalizer collapses.
 */
export function canonicalModelSql(modelExpr: string): string {
  const cases = Object.entries(MODEL_FAMILY_ALIASES).map(
    ([alias, canonical]) =>
      `WHEN lower(${modelExpr}) = '${alias}' THEN '${canonical}'`,
  );
  if (cases.length === 0) return modelExpr;
  return `CASE ${cases.join(' ')} ELSE ${modelExpr} END`;
}
