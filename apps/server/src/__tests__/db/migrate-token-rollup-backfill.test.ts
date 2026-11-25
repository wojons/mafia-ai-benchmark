import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseMigrator } from '../../db/migrate.js';

/**
 * MAF-INIT-001 backfill: the live corpus carried NULL on every row of
 * games.total_tokens / games.total_cost while token_usage and
 * players.tokens_used held real data. initialize() backfills ENDED games
 * whose rollup is still NULL:
 *   - token_usage rows exist  -> tokens AND cost from token_usage;
 *   - else players.tokens_used > 0 exists -> tokens only (cost stays NULL —
 *     a players-only fallback never invents a cost).
 * Idempotent: only still-NULL rows are touched; re-runs are no-ops.
 */
describe('DatabaseMigrator — MAF-INIT-001 game token rollup backfill', () => {
  let migrator: DatabaseMigrator;

  beforeEach(() => {
    migrator = new DatabaseMigrator(':memory:');
    migrator.initialize();
  });

  afterEach(() => {
    migrator.close();
  });

  function seedGame(id: string, status = 'ENDED'): void {
    migrator.getDatabase()
      .prepare(`INSERT INTO games (id, status, config) VALUES (?, ?, '{}')`)
      .run(id, status);
  }

  function seedTokenUsage(id: string, gameId: string, totalTokens: number, cost: number | null): void {
    migrator.getDatabase()
      .prepare(`INSERT INTO token_usage
                (id, game_id, player_id, turn_number, provider, model, prompt_tokens, completion_tokens, total_tokens, cost, timestamp)
                VALUES (?, ?, 'ALL', 0, 'openai', 'gpt-4o-mini', 0, 0, ?, ?, unixepoch())`)
      .run(id, gameId, totalTokens, cost);
  }

  function seedPlayer(id: string, gameId: string, tokensUsed: number): void {
    migrator.getDatabase()
      .prepare(`INSERT INTO players (id, game_id, name, role, join_order, tokens_used, provider, model)
                VALUES (?, ?, 'p', 'VILLAGER', 1, ?, 'openai', 'gpt-4o-mini')`)
      .run(id, gameId, tokensUsed);
  }

  function rollupOf(id: string): { total_tokens: number | null; total_cost: number | null } {
    return migrator.getDatabase()
      .prepare('SELECT total_tokens, total_cost FROM games WHERE id = ?')
      .get(id) as { total_tokens: number | null; total_cost: number | null };
  }

  it('backfills tokens AND cost from token_usage rows on an ENDED game', () => {
    seedGame('g-tu');
    seedTokenUsage('tu-1', 'g-tu', 1000, 0.01);
    seedTokenUsage('tu-2', 'g-tu', 500, 0.005);
    migrator.initialize();
    expect(rollupOf('g-tu')).toEqual({ total_tokens: 1500, total_cost: 0.015 });
  });

  it('backfills tokens only (cost stays NULL) when only players.tokens_used exists', () => {
    seedGame('g-pl');
    seedPlayer('p-1', 'g-pl', 400);
    seedPlayer('p-2', 'g-pl', 60);
    migrator.initialize();
    expect(rollupOf('g-pl')).toEqual({ total_tokens: 460, total_cost: null });
  });

  it('leaves a game with no derivable usage NULL (never a fabricated 0)', () => {
    seedGame('g-none');
    migrator.initialize();
    expect(rollupOf('g-none')).toEqual({ total_tokens: null, total_cost: null });
  });

  it('leaves a game whose players carry only zero tokens NULL', () => {
    seedGame('g-zerop');
    seedPlayer('p-z', 'g-zerop', 0);
    migrator.initialize();
    expect(rollupOf('g-zerop')).toEqual({ total_tokens: null, total_cost: null });
  });

  it('skips non-ENDED games', () => {
    seedGame('g-live', 'IN_PROGRESS');
    seedTokenUsage('tu-live', 'g-live', 999, 0.9);
    migrator.initialize();
    expect(rollupOf('g-live')).toEqual({ total_tokens: null, total_cost: null });
  });

  it('never overwrites a game that already has a rollup (idempotent, write path wins)', () => {
    seedGame('g-own');
    seedTokenUsage('tu-own', 'g-own', 10, 0.001);
    migrator.initialize(); // backfills 10 / 0.001
    expect(rollupOf('g-own')).toEqual({ total_tokens: 10, total_cost: 0.001 });
    // A second run must not touch the row (still-NULL filter), and a
    // foreign non-NULL value (as the write path would leave) is preserved.
    migrator.getDatabase()
      .prepare(`UPDATE games SET total_tokens = 777, total_cost = 0.7 WHERE id = 'g-own'`)
      .run();
    seedGame('g-new');
    seedTokenUsage('tu-new', 'g-new', 5, 0.0005);
    migrator.initialize();
    expect(rollupOf('g-own')).toEqual({ total_tokens: 777, total_cost: 0.7 });
    expect(rollupOf('g-new')).toEqual({ total_tokens: 5, total_cost: 0.0005 });
  });
});
